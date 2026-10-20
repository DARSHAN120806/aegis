import secrets
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session as DBSession

from .config import settings
from .database import session
from .models import Record

bearer = HTTPBearer(auto_error=False)


def token(subject, binding=None):
    t = datetime.now(UTC)
    sid = secrets.token_urlsafe(32)
    if settings().mode == "production":
        from .adapters import cache

        cache().setex(f"aegis:session:{sid}", settings().token_minutes * 60, subject)
    return jwt.encode(
        {
            "sub": subject,
            "iss": "aegis",
            "aud": "aegis-api",
            "iat": t,
            "exp": t + timedelta(minutes=settings().token_minutes),
            "jti": sid,
            "binding": binding,
        },
        settings().signing_secret,
        algorithm="HS256",
    )


def principal(request: Request, credentials=Depends(bearer), db: DBSession = Depends(session)):
    if not credentials:
        raise HTTPException(401, "Bearer token required")
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings().signing_secret,
            algorithms=["HS256"],
            audience="aegis-api",
            issuer="aegis",
            options={"require": ["sub", "exp", "iat"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid or expired token") from None
    if settings().mode == "production":
        from .adapters import cache, fabric

        try:
            if cache().get(f"aegis:session:{claims.get('jti', '')}") != claims["sub"]:
                raise HTTPException(401, "Session ended")
            identity = fabric().evaluate(claims["sub"], "Operations", "WhoAmI")
        except HTTPException:
            raise
        except Exception:  # noqa: BLE001 -- fail-closed service boundary
            raise HTTPException(503, "Identity dependency unavailable") from None
        if identity["id"] != claims["sub"] or identity["binding"] != claims.get("binding"):
            raise HTTPException(401, "Identity key changed; authenticate again")
        request.state.audit_actor = (identity["id"], identity["org"])
        request.state.token_expiry = claims["exp"]
        request.state.session_id = claims["jti"]
        return SimpleNamespace(id=identity["id"], org=identity["org"], kind="identity", body=identity)
    user = db.get(Record, claims["sub"])
    if user and user.kind == "identity":
        request.state.audit_actor = (user.id, user.org)
        request.state.token_expiry = claims["exp"]
    if not user or user.kind != "identity" or user.body["status"] != "active":
        raise HTTPException(403, "Identity inactive or revoked")
    return user


PERMISSIONS = {
    "Admin": {
        "identity.create",
        "identity.suspend",
        "identity.revoke",
        "credential.issue",
        "credential.revoke",
        "asset.mint",
        "asset.assign",
        "asset.transfer.request",
        "asset.transfer.approve",
        "asset.archive",
        "audit.read",
        "demo.control",
    },
    "Manager": {
        "credential.issue",
        "credential.revoke",
        "asset.mint",
        "asset.assign",
        "asset.transfer.request",
        "asset.transfer.approve",
        "asset.archive",
    },
    "Auditor": {"audit.read"},
    "User": {"asset.transfer.request"},
}


def permitted(user, action):
    if action in {
        "asset.transfer.accept",
        "asset.transfer.cancel",
        "role.propose",
        "identity.rotate.propose",
        "evidence.attach",
    }:
        return any(r in {"User", "Admin", "Manager"} for r in user.body["roles"])
    if action in {"proposal.approve", "organization.configure", "identity.recover.propose", "policy.propose"}:
        return "Admin" in user.body["roles"]
    return any(action in PERMISSIONS.get(role, set()) for role in user.body["roles"])
