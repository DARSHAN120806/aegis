import os
import tempfile

os.environ["AEGIS_MODE"] = "demo"
os.environ["AEGIS_SIGNING_SECRET"] = "test-only-secret-do-not-use-outside-tests-1234"
os.environ["AEGIS_DATABASE_URL"] = "sqlite:///" + tempfile.mktemp(suffix=".db")
import pytest
from fastapi.testclient import TestClient

from app.main import app, limits


@pytest.fixture
def client():
    limits.clear()
    with TestClient(app) as client:
        admin = client.post("/api/demo/session", json={"persona": "admin"}).json()["access_token"]
        client.post("/api/demo/reset", headers={"Authorization": f"Bearer {admin}"})
        yield client


@pytest.fixture
def auth(client):
    def headers(persona="admin"):
        token = client.post("/api/demo/session", json={"persona": persona}).json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return headers
