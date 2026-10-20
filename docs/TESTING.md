# Testing and acceptance evidence

## Executed locally — 20 October 2026

The validation matrix records process return codes in `docs/validation/checks.json` and individual command logs in that directory. A late Prettier failure was corrected and its targeted successful rerun is recorded; it was not silently counted as a pass. The final backend guards were retested separately. Infrastructure readiness and deployment are not inferred from these checks.

| Check | Observed result | What it proves |
|---|---|---|
| Ruff lint / format | pass | Python application/test syntax, selected static rules and consistent formatting |
| Pytest | **29 passed**, one upstream Starlette/httpx deprecation warning | Demo API regression, real crypto, isolated production boundaries and projection/outbox logic |
| Frontend TypeScript/Vite build | pass | Browser bundle/type compatibility |
| Prettier across UI, chaincode and bridge | pass after targeted formatting rerun | TypeScript/JavaScript/CSS source format |
| Chaincode TypeScript build | pass | Contract compilation |
| Chaincode unit suite | **12 passed** | Binding/MSP/RBAC, uniqueness/replay, transfer acceptance, bilateral tenancy, governance/policy and real-world-state semantics regression |
| Fabric bridge syntax and unit suite | **2 passed** | AES-GCM roundtrip/tamper/DID isolation and official SDK transaction/event serialization |
| Playwright | **3 passed** | Actual demo HTTP→API→SQLite→UI journeys at desktop/mobile, QR rendering, authorization denial and destructive confirmation |
| HTTP golden script | pass | Real local API mint/allocation/denial/request/approve/accept/verify sequence |
| Python/three Node dependency audits | no known reported vulnerabilities | Audited requirement/lockfile dependency databases at execution time, not an independent security certification |
| Fabric metadata generation | pass | Contract metadata resolves; internal `_event` helper is absent from exposed transactions |
| YAML parsing / Python compile | 5 YAML and 20 Python files parsed | Syntax only; does not validate Docker/Kubernetes runtime semantics |
| pip dependency consistency | no broken requirements | Installed validation environment dependency consistency |

There are **46 passing automated tests** across the four suites (29 + 12 + 2 + 3). No numerical line/branch coverage percentage is claimed. Screenshots are generated under `frontend/test-results/` for desktop audit, desktop provenance/QR and 390×844 mobile layout; they were visually inspected. Mobile overflow is also asserted. Keyboard labels/native controls/focus handling are reviewed, but this is not a formal WCAG audit.

## Test architecture and limits

`backend/tests/test_workflows.py` exercises actual FastAPI routing/authorization/business state in the explicitly isolated SQLite demo. `test_production_boundaries.py` exercises generated P-256 signatures, invalid/tampered proofs, browser signature normalization, single-use challenge consumption, encrypted profile/AAD isolation, strict config/schema, malicious MIME declarations, durable outbox deduplication, no speculative projection, receipt deduplication, tenant filtering, transfer acceptance and confirmed/invalid commit-status handling without speculative projection. Redis/Fabric doubles appear only in isolated unit tests and are labelled as such.

`chaincode/test/contracts.test.ts` uses a unit Fabric context, not a running network. It now invokes the Fabric before-transaction hook between logical calls and includes a separate stub where pending writes are **not** visible through getState. This caught a real proposal-state snapshot/bootstrap defect missed by an immediate-write mock. The application helper caches writes only within a proposal; Fabric still validates read sets and commits authoritative state. These tests cannot certify endorsement, peer MVCC validation, event delivery or CA interoperability on a real network.

Bridge tests use actual Gateway SDK serialization and cryptography, with a unit-only transport stub. Browser tests use real local services; they do not substitute fake ledger data or cover production signing/storage/CA flows. A browser test timeout was increased only for the actual ten-step HTTP journey, and the complete workflow subsequently passed.

## Reproduce the feasible matrix

Install lockfiles as in README, run API/UI locally, install Playwright Chromium and install `pip-audit==2.10.1` in the venv.

```bash
python scripts/validate.py --browser --audit
python scripts/demo.py golden
cd chaincode
npx fabric-chaincode-node metadata generate --file ../docs/validation/chaincode-metadata.json
```

The runner works on Windows/POSIX, uses the repository venv, saves stdout/stderr and fails if any selected check fails. On restricted Windows sandboxes, asyncio socketpair creation and browser launches may need loopback permission. The tests were run with that permission after a captured stack trace demonstrated the sandbox restriction; production code was not weakened to work around it.

## Real infrastructure checks supplied, not executed here

The host had no Docker, psql/Redis/MinIO/ClamAV services, Fabric binaries/network/CA enrollment credentials, KMS or Kubernetes cluster. Consequently these checks are **unverified**, not skipped-and-counted-as-passed:

- Docker image builds and Compose runtime/config validation through the Docker CLI.
- PostgreSQL migrations/default privileges/append-only triggers and actual persistence/concurrency.
- Redis network/TLS/rate-limit behavior and outage recovery.
- S3-compatible private bucket policies, KMS encryption, scanner protocol/signature updates and object access.
- Fabric proposal/endorsement/commit/invalid/ambiguous outcomes, peer event checkpoint resume and multi-peer projection recovery.
- Fabric CA enrollment/revocation/CRLs, new-key activation, actual channel MSP/collection lifecycle and cross-organization live transfer.
- Production browser end-to-end flows, container hardening scans, Kubernetes admission, backup restore and HA/disaster recovery.

On an isolated Docker integration host, start the default Compose `integration` profile and run `scripts/integration_dependencies.py` with **explicit** AEGIS_TEST_POSTGRES/REDIS/S3 URLs. This checks actual DB commits, Redis expiry/GETDEL and S3 bytes; it intentionally does not claim production TLS/KMS/Fabric coverage. CI provisions these services and applies/verifies migrations twice. CI configuration was created but its hosted run was not observed.

For the complete real production path, provision DEPLOYMENT.md prerequisites and run:

```bash
python scripts/integration_smoke.py --url https://YOUR_HOST --did YOUR_DID --key /secure/enrolled-key.pem --ca /secure/ca.crt
```

This script fails without real readiness, authenticates using a genuine enrolled key, denies challenge replay, verifies durable idempotent mint, waits for Fabric commit **and** projection, scans/uploads/anchors evidence, verifies downloaded bytes and invalidates the session on logout. Extend organizational acceptance to independently signed source/recipient approvals, revoked certificates, policy changes, dependency failure injection and recovery drills. Never replace these prerequisites with a mock and describe it as a live integration result.
