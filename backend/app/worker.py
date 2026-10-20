"""Durable command outbox and resumable, transaction-deduplicated ledger projection.

Run separately: python -m app.worker. PostgreSQL advisory lock elects one consumer.
"""

import json
import logging
import signal
import time

import httpx
from sqlalchemy import select, text

from .adapters import fabric
from .config import settings
from .database import Session, engine
from .models import Checkpoint, Event, LedgerReceipt, Notification, Operation, Record

log = logging.getLogger("aegis.worker")
running = True


def normalize(body, kind):
    value = dict(body)
    if kind == "asset":
        value["metadata_hash"] = value.pop("metadataHash", value.get("metadata_hash", None))
    if kind == "credential":
        value["owner"] = value.get("subject")
        value["hash"] = value.get("digest")
    return value


def project(db, event):
    tx, block, body = event["tx"], event["block"], event["body"]
    if db.get(LedgerReceipt, tx):
        return
    db.add(LedgerReceipt(tx=tx, block=str(block), body=body))
    if "body" in body and "kind" in body:
        record = db.get(Record, body["subject"])
        value = normalize(body["body"], body["kind"])
        history = list(record.body.get("history", [])) if record and body["kind"] == "asset" else []
        if body["kind"] == "asset":
            history.append(
                {
                    "action": body["action"],
                    "actor": body["actor"],
                    "owner": value.get("owner"),
                    "time": body["time"],
                    "tx": tx,
                    "source": "fabric",
                }
            )
            value["history"] = history[-200:]
        if record:
            record.body, record.org = value, body["org"]
            record.version += 1
        else:
            db.add(Record(id=body["subject"], org=body["org"], kind=body["kind"], body=value))
        if body.get("identity"):
            target = body["identity"]
            existing = db.get(Record, target["id"])
            if existing:
                existing.body = target
                existing.version += 1
            else:
                db.add(Record(id=target["id"], org=target["org"], kind="identity", body=target))
    if body.get("organization"):
        organization = body["organization"]
        projected = db.get(Record, organization["id"])
        if projected:
            projected.body = organization
            projected.version += 1
        else:
            db.add(
                Record(id=organization["id"], org=organization["org"], kind="organization", body=organization)
            )
    db.add(
        Event(
            org=body["org"],
            actor=body["actor"],
            action=body["action"],
            subject=body["subject"],
            outcome="committed",
            correlation=tx,
            source="fabric",
        )
    )
    actors = {body["actor"]}
    if body.get("body", {}).get("pending"):
        actors.add(body["body"]["pending"]["recipient"])
    for actor in actors:
        db.add(
            Notification(
                id=f"{tx}:{actor}",
                org=body.get("body", {}).get("pending", {}).get("recipientOrg", body["org"])
                if actor != body["actor"]
                else body.get("actorOrg", body["org"]),
                actor=actor,
                body={"action": body["action"], "subject": body["subject"], "tx": tx},
            )
        )
    op = db.get(Operation, body.get("operation")) if body.get("operation") else None
    if op and op.actor == body["actor"]:
        op.status, op.result = (
            "committed",
            {
                "id": body["subject"],
                "body": normalize(body.get("body", {}), body.get("kind")),
                "tx": tx,
                "source": "fabric",
            },
        )


def consume():
    with Session() as db:
        checkpoint = db.get(Checkpoint, "aegis")
        start = checkpoint.block if checkpoint else "0"
        events = fabric().call("/events", block=start, afterTx=checkpoint.tx if checkpoint else None)[
            "events"
        ]
        # Restart inclusively at the last block: a bounded batch may end part-way through a block.
        # The bridge returns whole blocks, so duplicate receipts safely cover reconnects.
        for event in events:
            project(db, event)
        if events:
            block = events[-1]["block"]
            if checkpoint:
                checkpoint.block = block
                checkpoint.tx = events[-1]["tx"]
            else:
                db.add(Checkpoint(id="aegis", block=block, tx=events[-1]["tx"]))
        db.commit()


def process_one():
    with Session() as db:
        op = db.scalar(
            select(Operation)
            .where(Operation.status.in_(["queued", "prepared", "submitted", "uncertain"]))
            .order_by(Operation.created_at)
            .limit(1)
        )
        if not op:
            return
        try:
            if not op.prepared:
                op.prepared = fabric().call("/prepare", actor=op.actor, operation=op.id, command=op.command)
                op.status = "prepared"
                db.commit()  # MUST precede submission: never lose the transaction ID on a crash.
            if not op.prepared.get("commit"):
                submitted = fabric().call("/submit", actor=op.actor, prepared=op.prepared)
                op.prepared = {**op.prepared, **submitted}
                op.status = "submitted"
                db.commit()
            result = fabric().call("/status", actor=op.actor, commit=op.prepared["commit"])
            op.status = "confirmed" if result["successful"] else "invalid"
            op.result = {**(op.prepared.get("result") or {}), **result}
            db.add(
                Event(
                    org=op.org,
                    actor=op.actor,
                    action=op.command["action"],
                    subject=op.command["subject"],
                    outcome=op.status,
                    correlation=op.prepared["tx"],
                    source="fabric",
                )
            )
            db.commit()
        except Exception as error:  # noqa: BLE001 -- sanitize dependency errors
            db.rollback()
            op.attempts += 1
            op.status = (
                "rejected"
                if isinstance(error, httpx.HTTPStatusError) and error.response.status_code == 409
                else ("attention" if op.attempts >= 10 else ("uncertain" if op.prepared else "queued"))
            )
            if op.status in {"rejected", "attention"}:
                db.add(
                    Event(
                        org=op.org,
                        actor=op.actor,
                        action=op.command["action"],
                        subject=op.command["subject"],
                        outcome=op.status,
                        correlation=(op.prepared or {}).get("tx", op.id),
                        source="fabric",
                    )
                )
            db.commit()
            log.error(
                json.dumps(
                    {
                        "operation": op.id,
                        "attempt": op.attempts,
                        "status": op.status,
                        "error_type": type(error).__name__,
                    }
                )
            )


def revoke_certificates():
    with Session() as db:
        for op in db.scalars(
            select(Operation).where(Operation.status == "committed").order_by(Operation.created_at)
        ):
            if op.command["action"] != "identity.revoke" or (op.prepared or {}).get("ca_revoked"):
                continue
            if op.attempts >= 10:
                continue
            try:
                result = fabric().call("/revoke", actor=op.actor, target=op.command["subject"])
                op.prepared = {
                    **(op.prepared or {}),
                    "ca_revoked": True,
                    "crl_update_required": result["channelMspCrlUpdateRequired"],
                }
            except Exception as error:  # noqa: BLE001 -- CA failure must not undo ledger revocation
                op.attempts += 1
                log.error(
                    json.dumps(
                        {"event": "ca.revocation.pending", "operation": op.id, "type": type(error).__name__}
                    )
                )
            db.commit()


def main():
    if settings().mode != "production":
        raise SystemExit("Worker requires production configuration")
    logging.basicConfig(level=logging.INFO)
    with engine.connect() as leader:
        if not leader.execute(text("SELECT pg_try_advisory_lock(1743240981)")).scalar():
            raise SystemExit("Another worker is active")
        try:
            while running:
                try:
                    consume()  # Resolve uncertain submissions from committed events before retrying.
                    process_one()
                    revoke_certificates()
                    with Session() as heartbeat_db:
                        pulse = heartbeat_db.get(Checkpoint, "worker")
                        if pulse:
                            pulse.block = str(time.time())
                        else:
                            heartbeat_db.add(Checkpoint(id="worker", block=str(time.time())))
                        heartbeat_db.commit()
                except Exception as error:  # noqa: BLE001 -- sanitize dependency errors
                    log.error(
                        json.dumps({"event": "worker.dependency.failure", "type": type(error).__name__})
                    )
                time.sleep(2)
        finally:
            leader.execute(text("SELECT pg_advisory_unlock(1743240981)"))


def stop(*_):
    global running
    running = False


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    main()
