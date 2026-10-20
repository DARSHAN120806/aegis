# Clean-machine deployment

## Prerequisites and release gate

Use Linux with Docker Engine/Compose, Python 3.12+, Node 22+, TLS/DNS, sufficient RAM (ClamAV alone needs roughly 3 GiB), persistent encrypted disks and outbound access for dependency/image and antivirus signature updates. Lockfiles were retained and resolved; run `npm ci` and `pip install -r backend/requirements.lock`. The CA CLI image is pinned to the verified official 1.5.22 release. Pin tested image digests in your release manifest after scanning; image tags alone are not immutable supply-chain provenance.

The supplied Fabric test-network path is reproducible development infrastructure, not production consensus provisioning. Production requires organization-approved peers/CouchDB, channel/orderers, CA/TLS CA, endorsement and enrollment. No Docker engine or live service credentials existed in the delivery environment, so the commands below are a deployment procedure, not deployment evidence.

## 1. Build and configure

Run from `aegis/`:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
npm --prefix frontend ci
npm --prefix chaincode ci
npm --prefix fabric-service ci --ignore-scripts
cp .env.production.example .env.production
mkdir -p infra/secrets/{tls,keys,fabric,minio-tls}
chmod 700 infra/secrets
```

Populate `.env.production` using a secret manager. Generate independent high-entropy session/bridge secrets and independent 32-byte hex wallet/profile keys. Generate an Ed25519 private/public PEM signing pair; set its immutable key ID and JSON public-key map. Do not put any secret into `VITE_*` variables. Placeholder signing values are rejected at startup.

Required variables and purpose:

| Variables | Required behavior |
|---|---|
| `AEGIS_MODE`, `AEGIS_DATABASE_URL`, `AEGIS_SIGNING_SECRET`, `AEGIS_ALLOWED_ORIGINS`, `AEGIS_TOKEN_MINUTES` | production; psycopg PostgreSQL URL with verify-full CA; random session secret; exact HTTPS public origins; 1–60 minute session TTL |
| `AEGIS_REDIS_URL` | authenticated `rediss://` including CA verification; challenge/session/limit store |
| `AEGIS_FABRIC_URL`, `AEGIS_FABRIC_TOKEN`, `AEGIS_FABRIC_CA_BUNDLE` | internal HTTPS bridge, independent shared service secret, trusted CA path |
| `AEGIS_S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY/KMS_KEY` | HTTPS private object service, least-privilege application credential or workload role, existing KMS key |
| `AEGIS_CREDENTIAL_PRIVATE_KEY/KEY_ID/PUBLIC_KEYS` | mounted Ed25519 key path, current signing ID, allowlisted public PEMs for current/retired issuers |
| `AEGIS_PROFILE_ENCRYPTION_KEY` | independent 64-hex-character AES-256 key for PostgreSQL profiles |
| `AEGIS_MALWARE_HOST/PORT`, `AEGIS_UPLOAD_MAX_BYTES` | internal ClamAV endpoint; default 3310, maximum evidence 5 MiB by default |
| `POSTGRES_PASSWORD`, `AEGIS_DB_PASSWORD`, `REDIS_PASSWORD` | separate migration-owner/app DB secrets; Redis secret uses alphanumeric, underscore or hyphen characters |
| `MINIO_ROOT_USER/PASSWORD`, `MINIO_KMS_KES_*` | storage admin credential; actual KES endpoint, TLS cert/key/CA and provisioned KMS key |
| `WALLET_KEY`, `FABRIC_EVENT_IDENTITY`, `FABRIC_DOCKER_NETWORK` | AES wallet key, active event-reader DID, existing Fabric Docker network |

Backend production validation requires HTTPS endpoints and a nonempty scanner/profile/signing configuration. It never starts a SQLite substitute. `httpx` is a runtime dependency and is included in the lockfile.

## 2. TLS and secret mounts

Create certificates with SANs matching real names: `postgres`, `redis`, `bridge`, `objects` and the public UI host. Put CA `ca.crt` and service `<service>.crt`/`<service>.key` in `infra/secrets/tls`. MinIO expects `public.crt` and `private.key` in `infra/secrets/minio-tls`. Put `vc-private.pem` and KES client material in `infra/secrets/keys`. Copy `infra/organizations.example.json` to `infra/secrets/fabric/organizations.json`, edit peer/CA DNS and mount each referenced TLS root/registrar MSP at the documented absolute container path.

Private keys must be readable only by the relevant container UID/group. The API uses UID 10001, bridge 1000, UI 101; verify Redis/PostgreSQL image UIDs before setting their key ownership (PostgreSQL Alpine commonly uses UID 70). PostgreSQL rejects group/world-readable server keys. Public roots may be 0644; private keys should be 0400/0600. Use workload-specific secret projections in Kubernetes rather than sharing unrelated keys. Never make an entire secret directory world-readable to fix a startup error.

API↔PostgreSQL uses TLS verify-full from its URL. API↔Redis/bridge/S3 verifies CA roots. The public UI uses TLS/HSTS. UI↔API HTTP stays within the application network; use service-mesh mTLS or an HTTPS API proxy where that network is not trusted.

## 3. Persistent services, migrations and objects

```bash
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml run --rm volume-init
docker compose --env-file .env.production -f compose.production.yaml up -d postgres redis objects malware
```

The one-shot volume initializer has only CHOWN and acts only on the two named application volumes. The PostgreSQL entrypoint uses narrowly declared filesystem/user-switch capabilities during initialization. No service uses privileged mode or exposes database/cache/object ports. The official ClamAV entrypoint loads signatures and drops daemon privileges; do not add host mounts.

MinIO SSE-KMS **requires a real configured KES/KMS service**. The repository does not bundle an insecure fake KMS. For a managed S3 service, set the endpoint and KMS identity accordingly and omit the local objects service. Initialize the bucket using `scripts/storage_setup.py` from a backend Python environment with temporary storage-admin credentials and `PYTHONPATH=backend`. It configures versioning, block-public-access, default KMS encryption and a TLS-only bucket policy. A native invocation, after exporting temporary `AEGIS_S3_ACCESS_KEY`/`AEGIS_S3_SECRET_KEY` storage-admin credentials from the secret manager, is:

```bash
PYTHONPATH=backend .venv/bin/python -c "from dotenv import load_dotenv; from runpy import run_path; load_dotenv('.env.production'); run_path('scripts/storage_setup.py', run_name='__main__')"
```

Then switch the API to a distinct key limited to HeadBucket/GetObject/PutObject on the evidence bucket and the necessary KMS encrypt/decrypt rights.

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm migrate
```

Migration credentials own DDL. The application role gets SELECT/INSERT/UPDATE and sequence usage by default privileges; no DELETE/DDL grant. SQL triggers reject audit/receipt UPDATE/DELETE. Migrations are ordered, locked and checksum-verified; repeat execution is safe and verifies drift. Do not edit applied migrations.

## 4. Fabric and enrollment

Deploy/validate the channel and contracts per FABRIC_NETWORK.md. Connect the bridge network to the peer/CA network; verify all configured SANs and DNS. Start the bridge, enroll CA-registered administrators, bootstrap each MSP once and provision an active event-reader identity. Have an administrator create newly enrolled normal identities with their returned certificate hashes. Stage and approve replacement certificates before activation; never replace wallet files manually while an operation is uncertain.

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d bridge api worker ui
```

Run the separate worker before expecting readiness. It projects bootstrap events and updates its heartbeat. The UI contains no build-time dependency credentials. API readiness fails until migrations, object bucket, scanner, active Gateway/event identity and a recent worker heartbeat are available.

## 5. Validate and release

Run `scripts/integration_smoke.py` with an enrolled mint-authorized identity and a trusted CA file. It checks readiness, real certificate login, challenge replay denial, idempotent command admission, Fabric commit/projected read, S3 byte integrity and logout. It creates a uniquely named smoke asset rather than modifying existing production assets. Run the browser tests in an isolated demo or a separately prepared production acceptance tenant; the existing Playwright fixture tests intentionally select demo identities.

Also test outage/recovery, cross-org approval, CA revocation/CRL publication, KMS access denial, scanner rejection, backup restoration and traffic limits before real customer data. A process health check or static YAML parse is not a substitute for this release gate.

## Kubernetes

`infra/kubernetes/application.yaml` supplies nonroot API/UI replicas, singleton worker/bridge, wallet PVC, resource bounds, probes, service account without API tokens and API disruption budget. PostgreSQL/Redis/S3/ClamAV/Fabric/KMS remain separately operated services. Create Secrets named `aegis-api` (only AEGIS application variables), `aegis-bridge` (bridge token, wallet key and event DID only), `aegis-service-tls`, `aegis-credential-keys` and `aegis-fabric-config` with the same paths and keys. The Fabric Secret items explicitly project org1/org2 registrar cert/key PEMs into MSP signcerts/keystore paths; supply those named keys plus the four TLS roots and organizations.json. Private key projections use mode 0440 and workload fsGroup. Configure scanner DNS and secret permissions for your CSI provider.

Set image references to your scanned registry digests with Kustomize, apply migrations as a one-shot Job using the owner secret, then `kubectl apply -k infra/kubernetes`. Provide an ingress controller/TLS certificate for the `ui:8080` Service and namespace network policies allowing only UI→API, API/worker→dependencies and bridge→Fabric/CA. No public ingress hostname, cluster provisioner, secret manager or HA Fabric operator is invented in these manifests. Cluster validation was not executed here.
