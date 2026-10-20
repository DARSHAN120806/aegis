# AEGIS — identity and digital ownership

AEGIS combines a React/TypeScript trust workspace, FastAPI, PostgreSQL projections, Redis sessions and rate limits, private S3 evidence, and a certificate-bound Hyperledger Fabric ledger. Production requests use the real configured adapters and fail closed when a critical dependency is unavailable. An explicitly labelled SQLite demo remains available for local evaluation.

**Delivery qualification:** source, tests and deployment configuration are implemented. This machine has no Docker, Fabric binaries or provisioned production infrastructure. A live Fabric/CA/PostgreSQL/Redis/S3/KMS/ClamAV deployment has not been certified. Read [PROJECT_STATUS.md](PROJECT_STATUS.md) before rollout; passing isolated tests is not a production approval.

## Repository and responsibilities

- `frontend/src`: identity login/enrollment, registries, transfer workflow, signed credential issue/verify, encrypted profile, governance, evidence, provenance relationships and QR links, audit and readiness.
- `backend/app`: validated configuration/schemas, certificate proof and sessions, authorization, PostgreSQL models, dependency adapters, private evidence, credential signing and durable worker.
- `chaincode/src`: independent certificate/MSP/role/owner enforcement, identity lifecycle, credential commitments, assets, bilateral transfer, approved roles/recovery and operation replay protection.
- `fabric-service`: internal TLS Gateway/CA bridge; encrypted per-user wallet, endorsed transaction serialization, commit status and checkpointed events.
- `infra`, `compose.production.yaml`, `scripts`: deployments, migrations, storage initialization, enrollment, backup and validation.

## Local demo

Requirements: Python 3.12+, Node 22+ and npm. PowerShell commands below; on POSIX replace `.venv/Scripts/` with `.venv/bin/` and activate with `source .venv/bin/activate`.

```powershell
git clone https://github.com/DARSHAN120806/aegis.git
cd aegis
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements.lock
npm --prefix frontend ci
npm --prefix chaincode ci
npm --prefix fabric-service ci --ignore-scripts
python scripts/setup.py
cd backend
../.venv/Scripts/python -m uvicorn app.main:app --env-file ../.env --host 127.0.0.1 --port 8000
```

In another terminal, `cd aegis/frontend` then `npm run dev`. Open http://127.0.0.1:5173. Choose the demo administrator and run Jury Demo → Reset → Golden Journey. Ten steps include an unauthorized mint denial, independent approval and recipient acceptance. This flow uses the real demo HTTP API; it does not exercise a blockchain.

`docker compose up --build -d` starts the isolated demo on a Docker host after `python scripts/setup.py`. The default Compose file is intentionally separate from production.

## Production deployment

Provision TLS, organization CA/MSP/channel identities, PostgreSQL, Redis, S3 with KMS, ClamAV, signing/encryption keys and secrets. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) exactly; the environment template contains placeholders only.

```bash
cp .env.production.example .env.production
# Populate secrets and infra/secrets using the deployment guide, then:
docker compose --env-file .env.production -f compose.production.yaml run --rm volume-init
docker compose --env-file .env.production -f compose.production.yaml up -d postgres redis objects malware bridge
docker compose --env-file .env.production -f compose.production.yaml run --rm migrate
# Initialize the private bucket and bootstrap enrolled ledger administrators before readiness.
docker compose --env-file .env.production -f compose.production.yaml up --build -d api worker ui
```

The public UI is served over TLS on 443. Database, Redis, storage, bridge and scanner have no published production ports. Fabric peers/CA remain organization-managed. The supplied `fabric-deploy.sh` uses the official **development** test-network; it is not an HA production network.

## Verification

```bash
python scripts/validate.py --browser --audit
python scripts/demo.py golden
# Production infrastructure only; use an enrolled mint-authorized identity:
python scripts/integration_smoke.py --url https://YOUR_HOST --did YOUR_DID --key /secure/key.pem --ca /secure/ca.crt
```

Browser validation requires running local API/UI servers and `cd frontend && npx playwright install chromium`. Auditing requires `pip install pip-audit==2.10.1` in the venv. The validation runner records return codes and logs under `docs/validation/`. [docs/TESTING.md](docs/TESTING.md) distinguishes executed checks from unexecuted integration scripts.

## Maintenance documentation

Start with [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), [API](docs/API_REFERENCE.md), [Fabric](docs/FABRIC_NETWORK.md), [security](docs/SECURITY.md), [data boundaries](docs/DATA_BOUNDARIES.md), [operations](docs/OPERATIONS.md), [user guide](docs/USER_GUIDE.md) and [troubleshooting](docs/TROUBLESHOOTING.md). Design decisions are recorded in `docs/decisions/`. No hosting or production deployment was performed by this delivery.
