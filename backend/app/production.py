"""Production API: certificate possession, durable commands, private evidence and signed credentials."""

import base64
import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jwt
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession

from .adapters import cache, fabric, scan_evidence, storage
from .config import settings
from .database import session
from .events import audit
from .models import Evidence, Notification, Operation, Profile
from .schemas import Command, Strict
from .security import permitted, principal, token

router = APIRouter(prefix="/api")


def production():
    if settings().mode != "production":
        raise HTTPException(404, "Production endpoint disabled in demo")


class ProfileInput(Strict):
    display_name: str = Field(min_length=1, max_length=80)
    contact: str = Field(default="", max_length=160)


@router.post("/profile", dependencies=[Depends(production)])
def update_profile(
    payload: ProfileInput, request: Request, user=Depends(principal), db: DBSession = Depends(session)
):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(bytes.fromhex(settings().profile_encryption_key)).encrypt(
        nonce, payload.model_dump_json().encode(), f"{user.org}:{user.id}".encode()
    )
    value = {"nonce": base64.b64encode(nonce).decode(), "ciphertext": base64.b64encode(encrypted).decode()}
    profile = db.get(Profile, user.id)
    if profile:
        profile.encrypted = value
    else:
        db.add(Profile(id=user.id, org=user.org, encrypted=value))
    audit(db, user, "profile.update", user.id, "stored", request.state.correlation)
    db.commit()
    return {"saved": True}


@router.get("/profile", dependencies=[Depends(production)])
def get_profile(user=Depends(principal), db: DBSession = Depends(session)):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    value = db.get(Profile, user.id)
    if not value or value.org != user.org:
        return {"display_name": "", "contact": ""}
    return json.loads(
        AESGCM(bytes.fromhex(settings().profile_encryption_key)).decrypt(
            base64.b64decode(value.encrypted["nonce"]),
            base64.b64decode(value.encrypted["ciphertext"]),
            f"{user.org}:{user.id}".encode(),
        )
    )


class Challenge(Strict):
    did: str = Field(pattern=r"^[a-zA-Z0-9:._-]{1,120}$")


class LoginProof(Challenge):
    challenge: str = Field(min_length=32, max_length=128)
    signature: str = Field(min_length=64, max_length=1024)
    activate: bool = False


class Enrollment(Challenge):
    msp_id: str = Field(pattern=r"^Org[12]MSP$")
    enrollment_id: str = Field(pattern=r"^[a-zA-Z0-9:._-]{1,120}$")
    secret: str = Field(min_length=1, max_length=256, repr=False)


def verify_possession(certificate, message, signature):
    cert = x509.load_pem_x509_certificate(certificate.encode())
    current = datetime.now(UTC)
    if not cert.not_valid_before_utc <= current < cert.not_valid_after_utc:
        raise ValueError("Certificate expired or not active")
    key = cert.public_key()
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("P-256 enrollment required")  # noqa: TRY004 -- invalid certificate
    raw = base64.b64decode(signature, validate=True)
    # Browser WebCrypto emits IEEE P1363 r||s. Normalize to DER for cryptography.
    if len(raw) == 64:
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

        raw = encode_dss_signature(int.from_bytes(raw[:32]), int.from_bytes(raw[32:]))
    key.verify(raw, message.encode(), ec.ECDSA(hashes.SHA256()))


@router.post("/auth/challenge", dependencies=[Depends(production)])
def challenge(payload: Challenge):
    nonce = secrets.token_urlsafe(32)
    cache().setex(f"aegis:challenge:{nonce}", 90, payload.did)
    return {"challenge": nonce, "message": f"AEGIS login v1\n{payload.did}\n{nonce}", "expires_in": 90}


@router.post("/auth/session", dependencies=[Depends(production)])
def login(payload: LoginProof):
    # GETDEL consumes every attempt, including invalid signatures, atomically.
    if cache().getdel(f"aegis:challenge:{payload.challenge}") != payload.did:
        raise HTTPException(401, "Challenge expired or already used")
    certificate = fabric().call("/certificate", actor=payload.did, pending=payload.activate)["certificate"]
    try:
        verify_possession(
            certificate, f"AEGIS login v1\n{payload.did}\n{payload.challenge}", payload.signature
        )
    except (ValueError, InvalidSignature):
        raise HTTPException(401, "Proof of possession invalid") from None
    if payload.activate:
        fabric().call("/activate", actor=payload.did)
    who = fabric().evaluate(payload.did, "Operations", "WhoAmI")
    if who["id"] != payload.did or who["status"] != "active":
        raise HTTPException(403, "Identity inactive or certificate mismatch")
    return {
        "access_token": token(who["id"], who["binding"]),
        "token_type": "bearer",
        "expires_in": settings().token_minutes * 60,
        "source": "fabric",
    }


@router.post("/auth/enroll", dependencies=[Depends(production)])
def enroll(payload: Enrollment):
    # CA registration and DID attributes are performed by organization registrars, never self-assigned.
    return fabric().call(
        "/enroll",
        actor=payload.did,
        mspId=payload.msp_id,
        enrollmentId=payload.enrollment_id,
        secret=payload.secret,
    )


@router.post("/auth/logout")
def logout(request: Request, user=Depends(principal)):
    if settings().mode == "production":
        cache().delete(f"aegis:session:{request.state.session_id}")
    return {"ended": True}


def enqueue(db, user, cmd, key, correlation):
    if not permitted(user, cmd.action):
        raise HTTPException(403, "Permission denied")
    if cmd.action == "policy.propose" and cmd.transfer_ttl is None:
        raise HTTPException(422, "Policy transfer_ttl is required")
    body = cmd.model_dump(exclude_none=True)
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    prior = db.scalar(select(Operation).where(Operation.actor == user.id, Operation.key == key))
    if prior:
        if prior.digest != digest:
            raise HTTPException(409, "Idempotency key reused with different payload")
        return operation_dict(prior)
    if cmd.action == "identity.create":
        if not cmd.certificate_hash:
            raise HTTPException(422, "Enrolled certificate commitment required")
        # Prevent an administrator from binding arbitrary bytes: match an actual CA wallet certificate.
        enrolled = fabric().call("/certificate", actor=cmd.subject)
        if (
            enrolled["mspId"] != user.org
            or hashlib.sha256(enrolled["certificate"].encode()).hexdigest() != cmd.certificate_hash
        ):
            raise HTTPException(422, "Enrollment certificate mismatch")
    if cmd.action in {"identity.rotate.propose", "identity.recover.propose"}:
        enrolled = fabric().call("/certificate", actor=cmd.owner, pending=True)
        if (
            enrolled["mspId"] != user.org
            or hashlib.sha256(enrolled["certificate"].encode()).hexdigest() != cmd.certificate_hash
        ):
            raise HTTPException(422, "Pending enrollment certificate mismatch")
    if cmd.action.startswith("asset.") and cmd.action != "asset.mint":
        item = asset_access(user, cmd.subject)
        if cmd.action in {"asset.transfer.request", "asset.transfer.cancel"} and item.get("owner") != user.id:
            raise HTTPException(403, "Only current owner may request or cancel")
        pending = item.get("pending", {})
        if cmd.action == "asset.transfer.accept" and pending.get("recipient") != user.id:
            raise HTTPException(403, "Only recipient may accept")
        if cmd.action == "asset.transfer.approve" and user.id in {
            pending.get("requester"),
            pending.get("recipient"),
        }:
            raise HTTPException(403, "Independent approver required")
    if cmd.action == "proposal.approve":
        proposal = fabric().evaluate(user.id, "Operations", "Get", "proposal", cmd.subject)
        if user.id in {proposal["requester"], proposal["target"]}:
            raise HTTPException(403, "Independent administrator required")
    if cmd.action in {"asset.mint", "credential.issue"} and not cmd.metadata_hash:
        raise HTTPException(422, "Commitment required")
    if (
        cmd.action
        in {
            "asset.assign",
            "asset.transfer.request",
            "credential.issue",
            "role.propose",
            "identity.rotate.propose",
            "identity.recover.propose",
        }
        and not cmd.owner
    ):
        raise HTTPException(422, "Target identity required")
    op = Operation(id=str(uuid.uuid4()), actor=user.id, org=user.org, key=key, digest=digest, command=body)
    db.add(op)
    audit(db, user, cmd.action, cmd.subject, "queued", correlation)
    db.commit()
    return operation_dict(op)


def operation_dict(op):
    return {
        "operation": op.id,
        "status": op.status,
        "result": op.result,
        "tx": op.prepared.get("tx") if op.prepared else None,
        "ca_revoked": (op.prepared or {}).get("ca_revoked"),
        "crl_update_required": (op.prepared or {}).get("crl_update_required"),
        "source": "fabric",
    }


@router.get("/operations/{operation_id}")
def operation(operation_id: str, user=Depends(principal), db: DBSession = Depends(session)):
    op = db.get(Operation, operation_id)
    if not op or op.org != user.org or (op.actor != user.id and not permitted(user, "audit.read")):
        raise HTTPException(404, "Operation not found")
    return operation_dict(op)


@router.get("/notifications")
def notifications(user=Depends(principal), db: DBSession = Depends(session)):
    return [
        {"id": n.id, **n.body}
        for n in db.scalars(
            select(Notification)
            .where(Notification.actor == user.id, Notification.org == user.org)
            .order_by(Notification.created_at.desc())
            .limit(100)
        )
    ]


def asset_access(user, asset):
    return fabric().evaluate(user.id, "Operations", "Get", "asset", asset)


@router.post("/assets/{asset_id}/evidence", dependencies=[Depends(production)])
async def upload(asset_id: str, request: Request, user=Depends(principal), db: DBSession = Depends(session)):
    item = asset_access(user, asset_id)
    if item.get("owner") != user.id and not permitted(user, "asset.mint"):
        raise HTTPException(403, "Owner or issuer permission required")
    content_type = request.headers.get("content-type", "")
    if content_type not in {"application/pdf", "image/png", "image/jpeg"}:
        raise HTTPException(415, "Only PDF, PNG and JPEG evidence accepted")
    data = bytearray()
    async for part in request.stream():
        if len(data) + len(part) > settings().upload_max_bytes:
            raise HTTPException(413, "Evidence too large")
        data.extend(part)
    validate_evidence(bytes(data), content_type)
    scan_evidence(bytes(data))
    eid = str(uuid.uuid4())
    key = f"{user.org}/{eid}"
    digest = hashlib.sha256(data).hexdigest()
    storage().put_object(
        Bucket=settings().s3_bucket,
        Key=key,
        Body=bytes(data),
        ContentType=content_type,
        ServerSideEncryption="aws:kms",
        SSEKMSKeyId=settings().s3_kms_key,
        ChecksumSHA256=base64.b64encode(hashlib.sha256(data).digest()).decode(),
        Metadata={"sha256": digest},
    )
    db.add(
        Evidence(
            id=eid,
            org=user.org,
            actor=user.id,
            asset=asset_id,
            digest=digest,
            object_key=key,
            content_type=content_type,
            size=len(data),
        )
    )
    audit(db, user, "evidence.upload", asset_id, "stored", request.state.correlation)
    result = enqueue(
        db,
        user,
        Command(action="evidence.attach", subject=eid, owner=asset_id, metadata_hash=digest),
        eid,
        request.state.correlation,
    )
    return {"id": eid, "sha256": digest, "size": len(data), "ledger_anchored": False, **result}


def validate_evidence(data, content_type):
    magic = {"application/pdf": b"%PDF-", "image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}
    if not data.startswith(magic[content_type]):
        raise HTTPException(422, "Content does not match declared media type")


@router.get("/evidence/{evidence_id}", dependencies=[Depends(production)])
def download(evidence_id: str, user=Depends(principal), db: DBSession = Depends(session)):
    evidence = db.get(Evidence, evidence_id)
    if not evidence or evidence.org != user.org:
        raise HTTPException(404, "Evidence not found")
    if evidence.content_type == "application/vc+jwt":
        anchor = fabric().evaluate(user.id, "Operations", "Get", "credential", evidence.asset)
    else:
        item = asset_access(user, evidence.asset)
        if (
            item.get("owner") != user.id
            and not permitted(user, "asset.mint")
            and not permitted(user, "audit.read")
        ):
            raise HTTPException(403, "Evidence access requires owner, manager or auditor permission")
        anchor = fabric().evaluate(user.id, "Operations", "Get", "evidence", evidence.id)
    if anchor["digest"] != evidence.digest:
        raise HTTPException(409, "Evidence index does not match ledger commitment")
    result = storage().get_object(Bucket=settings().s3_bucket, Key=evidence.object_key)
    stream = result["Body"]
    try:
        data = stream.read(settings().upload_max_bytes + 1)
    finally:
        stream.close()
    if len(data) != evidence.size or hashlib.sha256(data).hexdigest() != evidence.digest:
        audit(db, user, "evidence.integrity.violation", evidence.asset, "denied", evidence.id)
        db.commit()
        raise HTTPException(409, "Evidence integrity violation")
    return Response(
        data,
        media_type=evidence.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{evidence.id}"',
            "X-Evidence-SHA256": evidence.digest,
        },
    )


class CredentialIssue(Strict):
    id: str = Field(pattern=r"^[a-zA-Z0-9:._-]{1,64}$")
    subject: str = Field(pattern=r"^[a-zA-Z0-9:._-]{1,120}$")
    commitment: str = Field(pattern=r"^[a-f0-9]{64}$")


@router.post("/credentials/issue", dependencies=[Depends(production)])
def issue(
    payload: CredentialIssue,
    request: Request,
    idempotency_key: str = Header(..., min_length=8, max_length=80),
    user=Depends(principal),
    db: DBSession = Depends(session),
):
    if not permitted(user, "credential.issue"):
        raise HTTPException(403, "Issuer role required")
    existing = db.get(Evidence, payload.id)
    if existing:
        if existing.org != user.org or existing.actor != user.id:
            raise HTTPException(404, "Credential document not found")
        prior = db.scalar(
            select(Operation).where(Operation.actor == user.id, Operation.key == idempotency_key)
        )
        if not prior or prior.command.get("subject") != payload.id:
            raise HTTPException(409, "Credential ID already issued under another operation")
        data = storage().get_object(Bucket=settings().s3_bucket, Key=existing.object_key)["Body"]
        try:
            signed = data.read(20001).decode()
        finally:
            data.close()
        if hashlib.sha256(signed.encode()).hexdigest() != existing.digest:
            raise HTTPException(409, "Credential document integrity violation")
        # The bytes are authenticated against our stored SHA-256; decode only to compare the replay input.
        claims = jwt.decode(signed, options={"verify_signature": False})
        if (
            claims["sub"] != payload.subject
            or claims["vc"]["credentialSubject"]["commitment"] != payload.commitment
        ):
            raise HTTPException(409, "Idempotency key reused with changed credential content")
        return {"credential": signed, **operation_dict(prior)}
    t = datetime.now(UTC)
    claims = {
        "iss": user.id,
        "sub": payload.subject,
        "jti": payload.id,
        "iat": t,
        "nbf": t,
        "exp": t + timedelta(days=365),
        "vc": {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            "type": ["VerifiableCredential", "AegisCommitmentCredential"],
            "credentialSubject": {"id": payload.subject, "commitment": payload.commitment},
        },
    }
    signed = jwt.encode(
        claims,
        Path(settings().credential_private_key).read_text(),
        algorithm="EdDSA",
        headers={"kid": settings().credential_key_id, "typ": "JWT"},
    )
    digest = hashlib.sha256(signed.encode()).hexdigest()
    key = f"{user.org}/credentials/{payload.id}"
    storage().put_object(
        Bucket=settings().s3_bucket,
        Key=key,
        Body=signed.encode(),
        ContentType="application/vc+jwt",
        ServerSideEncryption="aws:kms",
        SSEKMSKeyId=settings().s3_kms_key,
    )
    db.add(
        Evidence(
            id=payload.id,
            org=user.org,
            actor=user.id,
            asset=payload.id,
            digest=digest,
            object_key=key,
            content_type="application/vc+jwt",
            size=len(signed),
        )
    )
    result = enqueue(
        db,
        user,
        Command(action="credential.issue", subject=payload.id, owner=payload.subject, metadata_hash=digest),
        idempotency_key,
        request.state.correlation,
    )
    return {"credential": signed, **result}


class CredentialVerify(Strict):
    credential: str = Field(min_length=20, max_length=20000)


@router.post("/credentials/verify", dependencies=[Depends(production)])
def verify_credential(payload: CredentialVerify, user=Depends(principal)):
    try:
        header = jwt.get_unverified_header(payload.credential)
        public_key = settings().credential_public_keys[header["kid"]]
        claims = jwt.decode(
            payload.credential,
            public_key,
            algorithms=["EdDSA"],
            options={"require": ["iss", "sub", "jti", "exp", "iat", "nbf"]},
        )
        record = fabric().evaluate(user.id, "Operations", "Get", "credential", claims["jti"])
        state = fabric().evaluate(
            user.id,
            "CredentialRegistry",
            "Verify",
            claims["jti"],
            hashlib.sha256(payload.credential.encode()).hexdigest(),
        )
        valid = state["valid"] and record["issuer"] == claims["iss"] and record["subject"] == claims["sub"]
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(422, "Invalid credential signature, key, or claims") from None
    return {"valid": valid, "source": "fabric", "holder_possession_proven": False}
