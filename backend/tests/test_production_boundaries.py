from datetime import UTC, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from fastapi import HTTPException
from sqlalchemy import select

from app.database import Session
from app.models import LedgerReceipt, Operation, Record
from app.production import enqueue, validate_evidence, verify_possession
from app.schemas import Command
from app.worker import project


def certificate():
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "unit-test")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(minutes=5))
        .sign(key, hashes.SHA256())
    )
    return key, cert.public_bytes(serialization.Encoding.PEM).decode()


def test_certificate_proof_and_tampering():
    import base64

    from cryptography.exceptions import InvalidSignature

    key, pem = certificate()
    message = "AEGIS login v1\ndid:test\nnonce"
    proof = base64.b64encode(key.sign(message.encode(), ec.ECDSA(hashes.SHA256()))).decode()
    verify_possession(pem, message, proof)
    with pytest.raises(InvalidSignature):
        verify_possession(pem, message + "tampered", proof)
    with pytest.raises(ValueError):
        verify_possession(pem, message, "%%%")


def test_browser_signature_normalization():
    import base64

    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

    key, pem = certificate()
    r, s = decode_dss_signature(key.sign(b"challenge", ec.ECDSA(hashes.SHA256())))
    raw = r.to_bytes(32) + s.to_bytes(32)
    verify_possession(pem, "challenge", base64.b64encode(raw).decode())


@pytest.mark.parametrize(
    "data,kind",
    [(b"<script>alert(1)</script>", "application/pdf"), (b"%PDF-1.7", "image/png"), (b"", "image/jpeg")],
)
def test_malicious_upload_declaration_rejected(data, kind):
    with pytest.raises(HTTPException) as error:
        validate_evidence(data, kind)
    assert error.value.status_code == 422


def test_evidence_magic_valid():
    validate_evidence(b"%PDF-1.7\n", "application/pdf")
    validate_evidence(b"\x89PNG\r\n\x1a\nbytes", "image/png")


def test_outbox_atomic_idempotency_and_denial(client):
    with Session() as db:
        admin = db.get(Record, "did:aegis:admin")
        command = Command(action="asset.mint", subject="queued-asset", metadata_hash="a" * 64)
        first = enqueue(db, admin, command, "outbox-key-1", "test")
        assert first["status"] == "queued"
        assert enqueue(db, admin, command, "outbox-key-1", "test") == first
        assert db.get(Record, "queued-asset") is None  # No uncommitted ledger projection.
        with pytest.raises(HTTPException) as error:
            enqueue(
                db,
                admin,
                Command(action="asset.mint", subject="different", metadata_hash="a" * 64),
                "outbox-key-1",
                "test",
            )
        assert error.value.status_code == 409
        user = db.get(Record, "did:aegis:user")
        with pytest.raises(HTTPException) as error:
            enqueue(db, user, command, "outbox-key-2", "test")
        assert error.value.status_code == 403
        db.query(Operation).delete()
        db.commit()


def test_projection_receipt_deduplication(client):
    event = {
        "tx": "test-projection-tx",
        "block": "5",
        "body": {
            "org": "Org1MSP",
            "actor": "did:aegis:admin",
            "action": "asset.mint",
            "subject": "projected",
            "kind": "asset",
            "time": datetime.now(UTC).isoformat(),
            "body": {"id": "projected", "org": "Org1MSP", "metadataHash": "a" * 64, "status": "minted"},
        },
    }
    with Session() as db:
        project(db, event)
        db.commit()
        project(db, event)
        db.commit()
        record = db.get(Record, "projected")
        assert record.body["metadata_hash"] == "a" * 64
        assert len(record.body["history"]) == 1
        assert len(list(db.scalars(select(LedgerReceipt).where(LedgerReceipt.tx == event["tx"])))) == 1


def test_production_config_refuses_insecure_dependencies():
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError, match="malware scanning"):
        Settings(mode="production", signing_secret="x" * 40, database_url="postgresql+psycopg://host/db")

    with pytest.raises(ValidationError, match="must be hex"):
        Settings(
            mode="production",
            signing_secret="x" * 40,
            database_url="postgresql+psycopg://host/db",
            malware_host="scanner",
            profile_encryption_key=" " * 64,
        )


def test_recipient_acceptance_and_independent_approval(client, auth):
    from test_workflows import send

    send(client, auth, "asset.mint", metadata_hash="a" * 64)
    send(client, auth, "asset.assign", owner="did:aegis:user")
    send(client, auth, "asset.transfer.request", persona="user", owner="did:aegis:recipient")
    result = send(client, auth, "asset.transfer.approve", persona="manager")
    assert result.json()["body"]["owner"] == "did:aegis:user"
    assert send(client, auth, "asset.transfer.accept", persona="user").status_code == 403
    result = send(client, auth, "asset.transfer.accept", persona="recipient")
    assert result.json()["body"]["owner"] == "did:aegis:recipient"
    assert send(client, auth, "asset.transfer.accept", persona="recipient").status_code == 403


def test_pagination_and_search(client, auth):
    headers = auth()
    page = client.get("/api/records/identity?limit=1", headers=headers).json()
    assert len(page) == 1
    next_page = client.get(
        "/api/records/identity", params={"after": page[0]["id"], "limit": 1}, headers=headers
    ).json()
    assert next_page[0]["id"] > page[0]["id"]
    assert client.get("/api/records/identity?q=org2", headers=headers).json() == []
    assert client.get("/api/records/identity?limit=10000", headers=headers).status_code == 422


def test_demo_never_exposes_production_enrollment(client):
    assert client.post("/api/auth/challenge", json={"did": "did:aegis:admin"}).status_code == 404


def test_profile_encryption_and_tenant_aad(client, monkeypatch):
    from types import SimpleNamespace

    from app.config import settings
    from app.models import Profile
    from app.production import ProfileInput, get_profile, update_profile

    monkeypatch.setattr(settings(), "profile_encryption_key", "a" * 64)
    with Session() as db:
        user = db.get(Record, "did:aegis:user")
        update_profile(
            ProfileInput(display_name="Private name", contact="private contact"),
            SimpleNamespace(state=SimpleNamespace(correlation="unit")),
            user,
            db,
        )
        stored = db.get(Profile, user.id)
        assert "Private name" not in str(stored.encrypted)
        assert get_profile(user, db)["display_name"] == "Private name"
        stranger = SimpleNamespace(id=user.id, org="Org2MSP")
        assert get_profile(stranger, db) == {"display_name": "", "contact": ""}


def test_single_use_challenge_consumed_even_on_bad_signature(monkeypatch):
    from app import production
    from app.production import Challenge, LoginProof, challenge, login

    class IsolatedCache:
        def __init__(self):
            self.values = {}

        def setex(self, k, t, v):
            self.values[k] = v

        def getdel(self, k):
            return self.values.pop(k, None)

    store = IsolatedCache()
    monkeypatch.setattr(production, "cache", lambda: store)

    class IsolatedFabric:
        def call(self, *args, **kwargs):
            return {"certificate": certificate()[1]}

    monkeypatch.setattr(production, "fabric", lambda: IsolatedFabric())
    value = challenge(Challenge(did="did:unit"))
    proof = LoginProof(did="did:unit", challenge=value["challenge"], signature="A" * 88)
    with pytest.raises(HTTPException) as first:
        login(proof)
    assert first.value.status_code == 401
    with pytest.raises(HTTPException) as second:
        login(proof)
    assert second.value.status_code == 401
    assert "already used" in second.value.detail


def test_policy_schema_bounds():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Command(action="policy.propose", subject="policy", transfer_ttl=59)
    assert Command(action="policy.propose", subject="policy", transfer_ttl=120).transfer_ttl == 120


@pytest.mark.parametrize("successful,expected", [(True, "confirmed"), (False, "invalid")])
def test_commit_status_is_audited_without_speculative_projection(client, monkeypatch, successful, expected):
    import uuid

    from app import worker
    from app.models import Event

    operation_id = str(uuid.uuid4())

    class IsolatedFabric:
        def call(self, route, **body):
            if route == "/prepare":
                return {
                    "tx": "unit-tx-" + operation_id,
                    "bytes": "unit-endorsed-bytes",
                    "result": {"id": "unprojected"},
                }
            if route == "/submit":
                return {"commit": "unit-commit-request"}
            if route == "/status":
                return {
                    "tx": "unit-tx-" + operation_id,
                    "successful": successful,
                    "code": 0 if successful else 11,
                    "block": "9",
                }
            raise AssertionError(route)

    monkeypatch.setattr(worker, "fabric", lambda: IsolatedFabric())
    with Session() as db:
        db.add(
            Operation(
                id=operation_id,
                actor="did:aegis:admin",
                org="Org1MSP",
                key=operation_id,
                digest="a" * 64,
                command={"action": "asset.mint", "subject": "unprojected", "metadata_hash": "a" * 64},
            )
        )
        db.commit()
    worker.process_one()
    with Session() as db:
        operation = db.get(Operation, operation_id)
        assert operation.status == expected
        assert operation.prepared["bytes"] == "unit-endorsed-bytes"
        assert db.get(Record, "unprojected") is None
        assert (
            db.scalar(select(Event).where(Event.correlation == "unit-tx-" + operation_id)).outcome == expected
        )
