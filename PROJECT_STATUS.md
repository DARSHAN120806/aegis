# AEGIS delivery status — 20 October 2026

**Production-oriented source delivery; live deployment is not certified.** The extracted `aegis/` checkpoint was inspected and modified directly. No ZIP file or Git metadata was present in the supplied workspace. No external deployment, CI run, live Fabric transaction or infrastructure test was claimed.

## Implemented inventory

| Subsystem | Delivered implementation | Validation boundary |
|---|---|---|
| Authentication / sessions | CA-issued P-256 possession challenge; single use/expiry; Redis sessions; short JWT/binding/current-ledger checks; logout | Real crypto/unit tests; live CA/Redis unverified |
| Identity lifecycle / profile | Enroll first, admin certificate binding; suspend/terminal revoke; staged approved key rotation/recovery; AES-GCM own profile | API/crypto and chaincode tests; actual CA replacement/CRL distribution unverified |
| Organization / policy | Two trusted MSPs; tenant scoping; independent role approvals; versioned bounded transfer-expiry policy; owner/recipient/MSP attributes | Chaincode/API negative tests; live network governance unverified |
| Assets / transfers | Global IDs, authorized mint/allocate/archive, independent source approval, recipient acceptance, cancellation/expiry, cross-MSP ownership | Demo HTTP/UI plus 12 chaincode units; peer endorsement/MVCC not exercised live |
| Credentials | Ed25519 VC JWT issue/download/private storage, exact document digest, live status/issuer/subject verification and revocation | Crypto libraries/type checks; real ledger/S3 issuance unverified |
| Evidence | Bounded MIME/magic validation, fail-closed ClamAV, SHA-256/S3 checksum/KMS, indexed outbox anchor, ledger/index/byte verification, attachment retrieval | Validation units; real ClamAV/S3/KMS unverified |
| Provenance / verification | Actual record timeline, issuer/asset/owner relationship view, QR verification links, deterministic integrity/lifecycle fraud warnings | Desktop/mobile demo browser evidence; production history/CA authority unverified |
| Durable delivery / audit | PostgreSQL outbox, endorsed bytes/tx persistence, commit status and uncertain-state handling, checkpointed events, receipt deduplication, atomic projection and in-app notifications, append-only SQL triggers | Outbox/projection units and SDK serialization; real crashes/recovery/DDL unverified |
| UI / operations | Preserved AEGIS design, production certificate/enrollment and security desk, registries/filter/pagination, real counts, states/errors/confirmation, health/metrics/log correlation | TypeScript build, formatting, 3 Playwright tests, screenshots |
| Deployment / maintenance | Separate demo/production Compose, Dockerfiles, CA/Fabric lifecycle scripts, collection policy, migration runner, private bucket provisioning, least-privilege envs, Kubernetes app manifests, backup/restore and CI | Parsed/generated/compiled; no Docker engine or cluster available |

## Executed evidence

- Backend: **29 tests passed**, Ruff lint/format passed; one upstream Starlette/httpx deprecation warning remains.
- Chaincode: TypeScript build and **12 unit tests passed**, including a regression reproducing Fabric's lack of read-your-writes in getState. Metadata generation succeeded and excludes the internal event helper.
- Gateway bridge: syntax and **2 unit tests passed** using official SDK serialization and real wallet encryption.
- Frontend: TypeScript/Vite build and Prettier passed; **3 Playwright tests passed**, including real demo journey, QR rendering, mobile overflow/sign-out, authorization denial and destructive confirmation persistence.
- **46 automated tests passed in total.** The HTTP golden journey also passed.
- Python and frontend/chaincode/bridge dependency audits reported no known vulnerabilities. The vulnerable legacy CA Node SDK was removed in favor of the official CA CLI.
- Five YAML files and twenty Python source files passed syntax parsing; installed Python requirements are consistent. Shell entrypoints, Dockerfiles and SQL migrations have LF line endings.
- Exact return codes/logs: `docs/validation/checks.json` and adjacent logs. A late formatting failure was fixed and its successful rerun is explicitly recorded.

## External release blockers and honest limits

This Windows host has no Docker/Compose daemon, Fabric peer/orderer/CA binaries, PostgreSQL/Redis/S3/KMS/ClamAV services, enrollment material, public TLS/DNS or Kubernetes cluster. Therefore live adapters are implemented and wired but their interoperability/deployment/recovery is **not verified** here. Run the supplied actual-dependency and complete production smoke scripts on a provisioned host before rollout. Image pulls/builds, PostgreSQL DDL/privileges, Redis TLS, SSE-KMS/KES, malware signature updates, Fabric consensus/events/CA CRLs, failure injection, backup restore and Kubernetes admission remain mandatory acceptance work.

The Fabric wrapper uses the official development test-network. HA peers/orderers, channel MSP/CRL updates, organization admission beyond the two configured MSPs, KMS/secret-manager provisioning and image-digest/container scanning are operator-controlled prerequisites. CA revocation is a durable follow-up to terminal ledger revocation; generated CRLs must still be published through channel governance. Do not confuse a healthy process or passing mocks with these release gates.

Deliberate product boundaries: a fixed permission vocabulary with approved roles and bounded policy settings; in-app notifications rather than email/SMS; an authenticated relationship view rather than a generalized graph engine; no standalone Merkle/SPV overlay, statistical fraud model, registered public DID method, third-party VC interoperability certification, refresh-token system or noncustodial/HSM signer. Hashes and signatures make specific cryptographic claims, not claims about document truth. Source-org private evidence is not automatically shared on ownership transfer. All administrative recovery requires independent authority; there is no hidden all-admins-lost bypass.

## Reproduce / operate

Local setup and native demo: README.md. Full infrastructure procedure: docs/DEPLOYMENT.md. Validate source with `python scripts/validate.py --browser --audit`. Validate a real production stack with `python scripts/integration_smoke.py --url https://YOUR_HOST --did YOUR_DID --key /secure/key.pem --ca /secure/ca.crt` after provisioning and bootstrap. See docs/OPERATIONS.md for reconciliation/backup and docs/TROUBLESHOOTING.md for failure states.

This status records the delivered code and observed evidence. It is not a claim that the full production definition of done has been established without the external release gates above.
