from functools import lru_cache

import boto3
import httpx
import redis
from botocore.config import Config

from .config import settings


class Fabric:
    """Authenticated TLS bridge using per-user Fabric signing identities."""

    def __init__(self, config):
        self.client = httpx.Client(
            base_url=config.fabric_url,
            headers={"Authorization": f"Bearer {config.fabric_token}"},
            verify=config.fabric_ca_bundle,
            timeout=httpx.Timeout(40, connect=5),
            follow_redirects=False,
        )

    def call(self, route, **body):
        response = self.client.post(route, json=body)
        response.raise_for_status()
        return response.json()

    def evaluate(self, actor, contract, transaction, *arguments):
        return self.call(
            "/evaluate", actor=actor, contract=contract, transaction=transaction, arguments=list(arguments)
        )["result"]


@lru_cache
def fabric():
    return Fabric(settings())


@lru_cache
def cache():
    return redis.Redis.from_url(
        settings().redis_url, socket_connect_timeout=3, socket_timeout=3, decode_responses=True
    )


@lru_cache
def storage():
    c = settings()
    return boto3.client(
        "s3",
        endpoint_url=c.s3_endpoint,
        region_name=c.s3_region,
        aws_access_key_id=c.s3_access_key or None,
        aws_secret_access_key=c.s3_secret_key or None,
        config=Config(
            connect_timeout=3,
            read_timeout=10,
            retries={"max_attempts": 2, "mode": "standard"},
            signature_version="s3v4",
        ),
    )


def rate_limit(address):
    script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n"
    return int(cache().eval(script, 1, f"aegis:rate:{address}")) <= 180


def readiness(db):
    from sqlalchemy import text

    db.execute(text("SELECT version FROM schema_migrations WHERE version=2")).scalar_one()
    import time

    heartbeat = db.execute(text("SELECT block FROM checkpoints WHERE id='worker'")).scalar_one()
    if time.time() - float(heartbeat) > 90:
        raise RuntimeError("Ledger projector heartbeat stale")
    cache().ping()
    storage().head_bucket(Bucket=settings().s3_bucket)
    fabric().call("/health")
    malware_ping()
    return {"postgres": "ready", "redis": "ready", "s3": "ready", "fabric": "ready"}


def malware_ping():
    import socket

    with socket.create_connection((settings().malware_host, settings().malware_port), timeout=5) as stream:
        stream.sendall(b"zPING\0")
        if stream.recv(1024).rstrip(b"\0\n") != b"PONG":
            raise RuntimeError("Malware scanner unavailable")


def scan_evidence(data):
    import socket
    import struct

    with socket.create_connection((settings().malware_host, settings().malware_port), timeout=15) as stream:
        stream.sendall(b"zINSTREAM\0")
        for offset in range(0, len(data), 65536):
            chunk = data[offset : offset + 65536]
            stream.sendall(struct.pack("!I", len(chunk)) + chunk)
        stream.sendall(b"\0\0\0\0")
        response = bytearray()
        while len(response) < 4096:
            chunk = stream.recv(1024)
            if not chunk:
                break
            response.extend(chunk)
            if b"\0" in chunk:
                break
        if bytes(response).rstrip(b"\0\n") != b"stream: OK":
            from fastapi import HTTPException

            raise HTTPException(422, "Evidence rejected by security scanner")
