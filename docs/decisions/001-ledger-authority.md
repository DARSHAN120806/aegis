# ADR 001 — Ledger authority and durable admission

Accepted. Fabric is the only production trust/ownership authority. PostgreSQL holds indexes, an operation outbox and non-ledger documents. A command is admitted durably before endorsement/submission; endorsed transaction bytes and ID are persisted before submission. Commit ambiguity is reconciled through exact-transaction retry and checkpointed events. UI success requires projected commitment. This avoids fabricated local fallback and explicitly accepts eventual consistency instead of claiming a distributed transaction.

One advisory-lock worker preserves ordering and constrains throughput. Add partitions only after measured need. Replay keys are retained; do not prune them casually. Test-network deployment is a separate development capability, not HA production provisioning.
