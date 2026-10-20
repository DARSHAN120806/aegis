# Operations and recovery

## Health and diagnostics

`/health/live` reports process state only. `/health/ready` checks migration version 2, a worker heartbeat no older than 90 seconds, PostgreSQL, Redis, private bucket access, an authenticated Gateway evaluation and ClamAV PING. A failed identity/event reader or scanner blocks readiness. A healthy process alone is not a valid ledger service.

Logs are JSON with correlation IDs, HTTP method/path/status, mode or operation ID/attempt/status/error type. Do not log bearer headers, enrollment output, raw files, profile values, private keys, complete environment or SDK metadata. Compose rotates logs at 10 MiB × 5 files per hardened application service. Forward production logs to an access-controlled external collector with retention and alerting. `/metrics` exposes request/denial counters to Admin/Auditor; counters are per-process and reset on restart. Use your metrics collector to aggregate replicas rather than interpreting a single counter as durable audit.

Inspect `operations` by status and age, recent `checkpoints.worker`, queue attempts, event cursor and bridge dependency errors. Alert on `uncertain`, `attention`, `invalid`, `rejected`, stalled projection, scanner signature age, KMS denial, evidence mismatch, certificate expiry and repeated CA revocation failure. Avoid selecting command bodies or endorsed envelopes into broadly accessible dashboards.

## Ambiguous transactions

Do not create a new operation when submission times out. Persisted endorsed bytes preserve the Fabric transaction ID. Let the worker consume events before retrying the same bytes. `confirmed` is a valid peer commit still waiting for projection; `committed` includes projection. A definitive invalid commit may reflect MVCC conflict and did not mutate valid ledger state. A rejected endorsement did not submit. `attention` means automatic attempts reached ten and requires operator review.

For attention: inspect operation/tx, query peer commit status and ledger operation state using a trusted organization identity, restore event connectivity and allow the event consumer to reconcile. Only when the ledger definitively proves the original operation did not commit should an operator authorize a new request. Never edit ownership directly in PostgreSQL or delete an operation to make the UI green.

## Backups

Use `BACKUP_DIR=/encrypted/backup bash scripts/backup.sh`. The script writes a custom-format PostgreSQL dump with restrictive file permissions through `pg_dump`; it does not print credentials. Encrypt and replicate backups separately from the database disk and test access controls. Back up bucket versions/KMS metadata, the encrypted wallet volume **and its independently stored key**, profile encryption key, VC signing keys/public-key history, CA databases/registrar MSP, channel config/MSP/CRLs, peer block stores and ordering-service data according to each organization's operator procedures. A database dump is not a ledger or object backup.

Before restoration, stop API/worker, choose an isolated EMPTY database and set `RESTORE_ACK=isolated-database`, `RESTORE_FILE=/secure/backup.dump`; run `bash scripts/restore.sh`. It uses `pg_restore --single-transaction --exit-on-error` without silently dropping an existing database. Reapply application role/default privileges for the recovered owner and verify both migration checksums and append-only triggers. Restore wallet/object versions and KMS access before restarting traffic.

## Ledger recovery and rebuilding projections

Recover Fabric using organization-managed peer/orderer/CA backups or rebuild a peer from the intact ordering service. CouchDB is a rebuildable world-state index; preserve block history and keys. Do not overwrite a healthy peer's ledger with a mismatched database snapshot. Consult the deployed Fabric version's documented snapshot/join/recovery procedures.

Business projections can be rebuilt into a **new isolated PostgreSQL database** by applying migrations and replaying events from block zero with an empty receipt/checkpoint set. Preserve original evidence, profile, operation and notification data independently. Do not delete append-only receipts in production; swap to the verified rebuilt database during an agreed maintenance window. Compare final asset/identity counts, sampled records and pending transfers against current ledger evaluations before reopening ingress.

Redis holds ephemeral challenges/sessions/limits; losing it invalidates sessions and consumes no authoritative business history. There is intentionally no persistent Redis session replay after disaster recovery. Do not restore old sessions from a backup into a new security epoch.

## Lifecycle and upgrades

CA revocation follows terminal ledger revocation. Monitor `ca_revoked` and `crl_update_required` in operation results. The bridge retains generated CRLs at `/wallet/crls/<MSP>.pem`. Generate and publish CA CRLs through organization-approved channel MSP config updates; registrar permission failure never reactivates an identity. Stage/approve/activate replacement keys through the application, and retain two independent administrators per organization.

For app releases: validate lockfiles, run CI, scan images, record digests, back up, apply additive migrations with owner credentials, deploy API/UI, then restart the singleton worker and validate readiness/live smoke. Chaincode upgrades need bilateral lifecycle approvals and a new sequence. Keep older VC public verification keys for still-valid credentials. Never rotate wallet/profile encryption keys without re-encrypting retained ciphertext and testing restoration.

API/UI may scale horizontally. Keep a single elected worker and single wallet bridge with a durable volume in this deployment. The worker's advisory lock is session-scoped; do not use a transaction-pooling proxy for that connection. To increase ledger throughput, measure endorsement/commit/event time and introduce explicit partitions/checkpoint ownership before adding workers. Do not blindly multiply replicas.

## Storage retention and orphan handling

Enable private bucket versioning, KMS, encrypted disk backups and agreed object-lock/retention externally. Compare bucket inventories to committed evidence indexes, outbox operations and ledger anchors. An upload can leave an orphan if S3 succeeds and the SQL transaction fails; quarantine unknown keys through a reviewed retention window, then remove using storage-admin credentials. Keep the API credential free of object-delete/bucket-policy permissions. Scanner failure blocks new uploads; old valid downloads still require ledger and byte integrity checks.

RPO/RTO, HA consensus, signature freshness alerts, restore drills and independent WORM retention are organizational acceptance requirements. No recovery or failover rehearsal is claimed in this delivery.
