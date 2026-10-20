import hashlib
import json
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select

from .events import audit
from .models import Idempotency, Record
from .security import permitted


class DomainService:
    def __init__(self, db):
        self.db = db

    def deny(self, user, cmd, correlation, detail="Permission denied", code=403):
        audit(self.db, user, cmd.action, cmd.subject, "denied", correlation)
        self.db.commit()
        raise HTTPException(code, detail)

    def execute(self, user, cmd, key, correlation):
        if cmd.action in {
            "role.propose",
            "proposal.approve",
            "identity.recover.propose",
            "identity.rotate.propose",
            "organization.configure",
            "evidence.attach",
            "policy.propose",
        }:
            raise HTTPException(409, "This operation requires configured production dependencies")
        digest = hashlib.sha256(cmd.model_dump_json().encode()).hexdigest()
        prior = self.db.scalar(
            select(Idempotency).where(Idempotency.actor == user.id, Idempotency.key == key)
        )
        if not permitted(user, cmd.action):
            return self.deny(user, cmd, correlation)
        if prior:
            if prior.digest != digest:
                raise HTTPException(409, "Idempotency key reused with different payload")
            return prior.response
        item = self.db.get(Record, cmd.subject)
        if item and item.org != user.org:
            return self.deny(user, cmd, correlation)
        body = json.loads(json.dumps(item.body)) if item else {}
        timestamp = datetime.now(UTC).isoformat()
        kind = cmd.action.split(".")[0]
        if cmd.action == "identity.create":
            if item:
                raise HTTPException(409, "Identity already exists")
            body = {
                "status": "active",
                "roles": ["User"],
                "did": cmd.subject,
                "binding": "demo-only",
                "created": timestamp,
            }
        elif cmd.action == "asset.mint":
            if item:
                raise HTTPException(409, "Asset ID already exists")
            if not cmd.metadata_hash:
                raise HTTPException(422, "Metadata hash required")
            body = {
                "issuer": user.id,
                "owner": None,
                "metadata_hash": cmd.metadata_hash,
                "status": "minted",
                "created": timestamp,
                "history": [],
            }
        elif cmd.action == "credential.issue":
            if item:
                raise HTTPException(409, "Credential ID already exists")
            self.active_owner(cmd.owner, user.org)
            if not cmd.metadata_hash:
                raise HTTPException(422, "Credential commitment hash required")
            body = {
                "owner": cmd.owner,
                "issuer": user.id,
                "hash": cmd.metadata_hash,
                "status": "active",
                "created": timestamp,
            }
        else:
            if not item or item.kind != kind:
                raise HTTPException(404, "Record not found")
            if cmd.action.startswith("identity."):
                if item.id == user.id or "Admin" in body["roles"]:
                    return self.deny(
                        user, cmd, correlation, "Administrative lifecycle requires independent approval"
                    )
                if body["status"] == "revoked":
                    raise HTTPException(409, "Revocation is terminal")
                body["status"] = "suspended" if cmd.action.endswith("suspend") else "revoked"
            elif cmd.action == "credential.revoke":
                if body["status"] != "active":
                    raise HTTPException(409, "Credential already revoked")
                body["status"] = "revoked"
            elif cmd.action == "asset.assign":
                if body["status"] != "minted":
                    raise HTTPException(409, "Only minted assets may be assigned")
                self.active_owner(cmd.owner, user.org)
                body.update(owner=cmd.owner, status="active")
            elif cmd.action == "asset.transfer.request":
                if body["status"] != "active" or body.get("pending"):
                    raise HTTPException(409, "Asset not available for transfer")
                if body["owner"] != user.id:
                    return self.deny(user, cmd, correlation, "Only owner may request transfer")
                self.active_owner(cmd.owner, user.org)
                if cmd.owner == body["owner"]:
                    raise HTTPException(409, "Recipient already owns asset")
                body["pending"] = {
                    "recipient": cmd.owner,
                    "requester": user.id,
                    "expires": (datetime.now(UTC) + timedelta(minutes=15)).isoformat(),
                }
            elif cmd.action == "asset.transfer.approve":
                pending = body.get("pending")
                if body["status"] != "active" or not pending:
                    raise HTTPException(409, "No pending transfer")
                if pending["requester"] == user.id:
                    return self.deny(user, cmd, correlation, "Requester cannot approve own transfer")
                if pending["recipient"] == user.id:
                    return self.deny(user, cmd, correlation, "Recipient cannot independently approve")
                if datetime.fromisoformat(pending["expires"]) <= datetime.now(UTC):
                    raise HTTPException(409, "Transfer approval expired")
                self.active_owner(pending["recipient"], user.org)
                self.active_owner(body["owner"], user.org)
                pending["approver"] = user.id
                if pending.get("accepted"):
                    body["owner"] = pending["recipient"]
                    body.pop("pending")
            elif cmd.action == "asset.transfer.accept":
                pending = body.get("pending")
                if not pending or pending["recipient"] != user.id:
                    return self.deny(user, cmd, correlation, "Only recipient may accept")
                if datetime.fromisoformat(pending["expires"]) <= datetime.now(UTC):
                    raise HTTPException(409, "Transfer expired")
                self.active_owner(pending["requester"], user.org)
                pending["accepted"] = True
                if pending.get("approver"):
                    body["owner"] = user.id
                    body.pop("pending")
            elif cmd.action == "asset.transfer.cancel":
                if body.get("owner") != user.id or not body.get("pending"):
                    return self.deny(user, cmd, correlation, "Only owner may cancel pending transfer")
                body.pop("pending")
            elif cmd.action == "asset.archive":
                if body.get("pending") or body["status"] == "archived":
                    raise HTTPException(409, "Cannot archive pending/already archived asset")
                body["status"] = "archived"
        if kind == "asset":
            body.setdefault("history", []).append(
                {
                    "action": cmd.action,
                    "actor": user.id,
                    "owner": body.get("owner"),
                    "time": timestamp,
                    "source": "simulation",
                }
            )
        if item:
            item.body = body
            item.version += 1
        else:
            item = Record(id=cmd.subject, org=user.org, kind=kind, body=body)
            self.db.add(item)
        result = {
            "id": item.id,
            "org": item.org,
            "kind": kind,
            "body": body,
            "source": "simulation",
            "ledger": "SIMULATED, not Fabric",
        }
        audit(self.db, user, cmd.action, cmd.subject, "allowed", correlation)
        self.db.add(
            Idempotency(actor=user.id, key=key, digest=digest, response=json.loads(json.dumps(result)))
        )
        self.db.commit()
        return result

    def active_owner(self, did, org):
        owner = self.db.get(Record, did) if did else None
        if not owner or owner.kind != "identity" or owner.org != org or owner.body["status"] != "active":
            raise HTTPException(422, "Recipient must be an active identity in this organization")
