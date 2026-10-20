import uuid

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.database import Session
from app.models import Record

HASH = "a" * 64


def send(client, auth, action, subject="asset-1", persona="admin", key=None, **extra):
    headers = auth(persona)
    headers["Idempotency-Key"] = key or str(uuid.uuid4())
    return client.post("/api/commands", headers=headers, json={"action": action, "subject": subject, **extra})


def test_golden_journey(client, auth):
    assert send(client, auth, "identity.create", "did:aegis:alice").status_code == 200
    assert (
        send(
            client, auth, "credential.issue", "credential-1", owner="did:aegis:alice", metadata_hash=HASH
        ).status_code
        == 200
    )
    assert send(client, auth, "asset.mint", metadata_hash=HASH).status_code == 200
    assert send(client, auth, "asset.assign", owner="did:aegis:user").status_code == 200
    assert (
        send(client, auth, "asset.mint", "forbidden", persona="user", metadata_hash=HASH).status_code == 403
    )
    assert (
        send(client, auth, "asset.transfer.request", persona="user", owner="did:aegis:recipient").status_code
        == 200
    )
    result = send(client, auth, "asset.transfer.approve", persona="manager")
    assert result.status_code == 200
    assert result.json()["body"]["owner"] == "did:aegis:user"
    result = send(client, auth, "asset.transfer.accept", persona="recipient")
    assert len(result.json()["body"]["history"]) == 5
    verified = client.post("/api/assets/asset-1/verify", headers=auth(), json={"metadata_hash": HASH})
    assert verified.json()["valid"] is True
    logs = client.get("/api/audit", headers=auth("auditor")).json()
    assert any(e["outcome"] == "denied" for e in logs)


def test_organization_isolation(client, auth):
    send(client, auth, "asset.mint", metadata_hash=HASH)
    assert client.get("/api/records/asset", headers=auth("org2admin")).json() == []
    assert (
        send(client, auth, "asset.assign", persona="org2admin", owner="did:aegis:org2admin").status_code
        == 403
    )
    assert send(client, auth, "asset.assign", owner="did:aegis:org2admin").status_code == 422


def test_replay_and_uniqueness(client, auth):
    first = send(client, auth, "asset.mint", metadata_hash=HASH, key="same-key-123")
    replay = send(client, auth, "asset.mint", metadata_hash=HASH, key="same-key-123")
    assert first.json() == replay.json()
    assert send(client, auth, "asset.mint", metadata_hash="b" * 64, key="same-key-123").status_code == 409
    assert send(client, auth, "asset.mint", metadata_hash=HASH).status_code == 409


def test_revocation_invalidates_existing_token(client, auth):
    old = auth("user")
    assert send(client, auth, "identity.revoke", "did:aegis:user").status_code == 200
    assert client.get("/api/me", headers=old).status_code == 403
    assert client.post("/api/demo/session", json={"persona": "user"}).status_code == 403


def test_transfer_self_approval_and_state(client, auth):
    send(client, auth, "asset.mint", metadata_hash=HASH)
    send(client, auth, "asset.assign", owner="did:aegis:manager")
    send(client, auth, "asset.transfer.request", persona="manager", owner="did:aegis:recipient")
    assert send(client, auth, "asset.transfer.approve", persona="manager").status_code == 403
    assert send(client, auth, "asset.archive").status_code == 409
    assert send(client, auth, "asset.transfer.approve").status_code == 200
    assert send(client, auth, "asset.transfer.accept", persona="recipient").status_code == 200
    assert send(client, auth, "asset.transfer.approve").status_code == 409
    assert send(client, auth, "asset.archive").status_code == 200
    assert (
        client.post("/api/assets/asset-1/verify", headers=auth(), json={"metadata_hash": HASH}).json()[
            "valid"
        ]
        is False
    )


def test_token_tampering_and_required_auth(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer fake"}).status_code == 401


def test_validation_and_privilege_escalation(client, auth):
    assert send(client, auth, "asset.mint", metadata_hash="wrong").status_code == 422
    assert (
        client.post(
            "/api/commands",
            headers={**auth(), "Idempotency-Key": "validation"},
            json={"action": "identity.create", "subject": "evil", "roles": ["Admin"]},
        ).status_code
        == 422
    )
    assert client.get("/api/audit", headers=auth("user")).status_code == 403


def test_secret_and_production_fail_closed():
    with pytest.raises(ValidationError):
        Settings(mode="production", signing_secret="short")
    with pytest.raises(ValidationError):
        Settings(mode="production", signing_secret="x" * 40, database_url="sqlite://")


def test_replay_after_role_revocation(client, auth):
    h = auth("manager")
    assert (
        send(client, auth, "asset.mint", persona="manager", metadata_hash=HASH, key="role-replay").status_code
        == 200
    )
    with Session() as db:
        user = db.get(Record, "did:aegis:manager")
        user.body = {**user.body, "roles": ["User"]}
        db.commit()
    response = client.post(
        "/api/commands",
        headers={**h, "Idempotency-Key": "role-replay"},
        json={"action": "asset.mint", "subject": "asset-1", "metadata_hash": HASH},
    )
    assert response.status_code == 403


def test_revoked_attempt_has_audit_event(client, auth):
    old = auth("user")
    send(client, auth, "identity.revoke", "did:aegis:user")
    assert client.get("/api/me", headers=old).status_code == 403
    events = client.get("/api/audit", headers=auth("auditor")).json()
    assert any(e["actor"] == "did:aegis:user" and e["action"] == "http.authorization.denied" for e in events)


def test_expired_jwt_rejected(client):
    from datetime import UTC, datetime, timedelta

    import jwt

    from app.config import settings

    value = jwt.encode(
        {
            "sub": "did:aegis:user",
            "iss": "aegis",
            "aud": "aegis-api",
            "iat": datetime.now(UTC) - timedelta(minutes=20),
            "exp": datetime.now(UTC) - timedelta(minutes=1),
        },
        settings().signing_secret,
        algorithm="HS256",
    )
    assert client.get("/api/me", headers={"Authorization": "Bearer " + value}).status_code == 401


def test_production_routes_refuse_demo_and_business_traffic(client, auth, monkeypatch):
    from app.main import config

    old = auth()
    monkeypatch.setattr(config, "mode", "production")
    assert client.post("/api/demo/session", json={"persona": "admin"}).status_code == 404
    assert client.get("/health/ready").status_code == 503
    assert client.get("/api/me", headers=old).status_code == 503
