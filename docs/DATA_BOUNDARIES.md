# Data boundaries and privacy

| Location | Actual data | Excluded data / reason |
|---|---|---|
| Fabric shared channel | Pseudonymous identities, MSP, certificate bindings/status/roles, asset ID/ownership/metadata digest, credential digest/status, proposal decisions and evidence commitments | Profile names/contact, documents, private keys, session tokens and complete signed VC documents |
| Configured collection | `aegisCommitments` membership/endorsement and retention configuration | Current core workflows do not store private documents in PDC; membership is not equivalent to encryption outside peers |
| PostgreSQL | Rebuildable records/receipts; durable command state; audit; notifications; document index; encrypted profiles | Enrollment private keys; plaintext profile fields |
| Redis | Expiring challenges, sessions and limiter counters | Permanent trust records or evidence |
| S3/KMS | Private versioned evidence and signed credential JWT objects | Public access and user-selected object paths |
| Bridge wallet | AES-GCM encrypted enrollment certificate/key bundles; staged replacements | Unencrypted persistent key files |
| Secret manager/mounts | Wallet/profile/session/credential keys, registrar MSP, TLS and dependency credentials | Browser build-time variables and source control |

Business IDs are intentionally globally unique across ledger namespaces to match the existing projection key. Certificate hashes use exact CA PEM bytes; evidence hashes use exact uploaded bytes; signed-credential hashes use exact compact JWT bytes. A canonical JSON command digest is for request replay, not an identity proof.

## Evidence chain

Authorized upload → size/MIME/magic validation → ClamAV → SHA-256 → private KMS object → PostgreSQL index/outbox → ledger evidence digest. Object storage and ledger cannot commit atomically. Upload responses therefore say `ledger_anchored=false` until the operation commits. An S3 success followed by DB failure can leave an orphan object; operators reconcile indexed keys against a versioned bucket inventory. Never delete unknown objects solely because a projector is delayed.

Downloads authorize identity, tenant and parent asset/credential, then read and rehash the stored bytes. A mismatch blocks delivery and creates an audit violation. S3 object versioning/KMS and an independently retained ledger commitment permit later integrity investigation. The application serves attachments rather than inline untrusted PDFs/HTML. Files are not public, and no caller-supplied download URL is fetched.

## Transfers and disclosure

Cross-MSP transfer moves the asset's ledger organization and ownership only after destination acceptance and a distinct source approver. Source-org raw evidence does not automatically become destination-org evidence. Administrators must agree a disclosure process and submit newly authorized evidence if needed; prior audit/receipt history remains in the original organization's retained records. A public QR link contains only a pseudonymous asset identifier and opens authenticated verification, never an evidence URL or bearer token.

## Retention and deletion

Fabric commitments/history are persistent and linkable; do not assume they can be erased by deleting a profile. Profile ciphertext and off-chain evidence can be removed or archived through an owner-controlled retention procedure. The app does not expose bulk deletion of audit, receipts or replay records. S3 retention/object-lock requirements and database WORM exports are organization-specific and must be provisioned before regulated workloads. Backups may continue to contain deleted ciphertext for their retention period.

No custom Merkle overlay is introduced: Fabric validation and authenticated evaluations are the deployed trust mechanism. The API does not claim an offline Merkle inclusion proof, immutable SQL against a database owner, universal identity truth, or document authenticity merely from a matching SHA-256 value.
