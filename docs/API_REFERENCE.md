# API reference

FastAPI serves the exact machine-readable schema at `/openapi.json` and interactive descriptions at `/docs`. Endpoints below use JSON unless evidence bytes are specified. Production requires `Authorization: Bearer <session>` on business routes. A session carries subject, expiry, issuer, audience, nonce and certificate binding, not authoritative roles. Roles/status are rechecked on the ledger.

## Authentication and session

| Route | Input | Behavior |
|---|---|---|
| `GET /health/live` | none | Process status and explicit mode. |
| `GET /health/ready` | none | Real DB/migration, worker heartbeat, Redis, S3 bucket, Gateway and scanner checks; 503 if unavailable. Demo reports simulation explicitly. |
| `POST /api/auth/enroll` | `did,msp_id,enrollment_id,secret` | Production only. Enroll a previously registered CA identity over TLS; return certificate, hash and private key once. A replacement is staged pending approval. |
| `POST /api/auth/challenge` | `did` | Production only. 90-second single-use challenge and exact message bytes. |
| `POST /api/auth/session` | `did,challenge,signature,activate=false` | Base64 P-256 ECDSA SHA-256 signature; DER or 64-byte browser P1363 accepted. Optional approved replacement activation. Returns short bearer session. |
| `POST /api/auth/logout` | empty | Invalidate production Redis session. |
| `GET /api/me` | bearer | Current DID, organization, ledger roles and mode. |
| `POST /api/profile` | `display_name` (1–80), `contact` (0–160) | Own encrypted profile only; production. |
| `GET /api/profile` | bearer | Own decrypted profile; no profile directory or public PII. |
| `POST /api/demo/session` | `persona` | Demo only. Fixed fixtures; 404 in production. |
| `POST /api/demo/reset` | empty | Demo administrator only. Never resets production. |

The login message is `AEGIS login v1\n<DID>\n<challenge>` with actual newline characters. Sign exactly the returned `message`; never concatenate an alternate challenge representation. No cookie authentication is used; CSRF tokens are unnecessary for bearer headers, but XSS and stolen keys remain threats.

## Commands and approvals

`POST /api/commands` requires `Idempotency-Key` (8–80 chars). Common schema: `action`, `subject` (1–120 ASCII identifier), optional `owner`, `metadata_hash`, `certificate_hash`, `role`. Extra fields are rejected. Hashes are exactly 64 lowercase hexadecimal characters. Certificate onboarding compares the exact returned PEM bytes; do not reformat PEM line endings.

| Action | Permission / additional input |
|---|---|
| `identity.create` | Admin; CA wallet certificate hash; default User role. |
| `identity.suspend`, `identity.revoke` | Admin; target in same org; self/admin direct mutation prohibited. Revocation terminal. |
| `role.propose` | Active User/Manager/Admin; target (`owner`), fixed role. Non-admin may request for self only. |
| `identity.rotate.propose` | Self or Admin; target and pending enrollment hash. |
| `identity.recover.propose` | Admin; suspended/active non-revoked target and pending hash. |
| `proposal.approve` | Admin distinct from requester and target; proposal ID in subject; unexpired pending proposal. |
| `policy.propose` | Admin; proposal ID and transfer_ttl 60–3600 seconds; separate Admin approves. Existing requests retain their captured expiry. |
| `organization.configure` | Organization Admin; own MSP as subject; stores fixed enforced policy. |
| `asset.mint` | Admin/Manager; unique subject and metadata_hash. |
| `asset.assign` | Admin/Manager; minted asset and active same-org recipient in owner. |
| `asset.transfer.request` | Current owner; active asset and recipient DID in owner. Recipient may belong to Org2. |
| `asset.transfer.approve` | Independent Admin/Manager in source org, distinct from owner and recipient. |
| `asset.transfer.accept` | Named recipient; pending request unexpired; finalization also checks current approver authorization. |
| `asset.transfer.cancel` | Current owner of pending transfer. |
| `asset.archive` | Admin/Manager; no pending transfer; archived is terminal. |
| `credential.issue`, `credential.revoke` | Admin/Manager. Use the signed issuance route for VC documents. |
| `evidence.attach` | Owner or Admin/Manager; parent asset in owner, evidence digest in metadata_hash. Normally queued by upload. |

Production responds **202**, e.g. `{"operation":"<uuid>","status":"queued","result":null,"tx":null,"source":"fabric"}`. Poll `GET /api/operations/{id}`. Only the actor or own-org auditor/admin can inspect it. States: queued → prepared → submitted → confirmed → committed; uncertain retries exact bytes; invalid/rejected are definitive failures; attention requires reconciliation. Never render a queued request as successful ownership. Demo returns a clearly labelled immediate simulation result instead.

A reused key with changed content is 409. A logical replay with the same actor/key returns the existing operation. Recheck current permissions even on replay. Do not retry an uncertain result with a new key.

## Reads and evidence

`GET /api/records/{kind}` accepts `kind=identity|credential|asset|proposal|organization`, keyset `after`, `limit=1..200` (default 50), ID substring `q`, and exact lifecycle `status`. Results are projection records; a User sees own identity and own credentials. Assets are organization-scoped plus an explicitly addressed pending recipient. `GET /api/dashboard` returns real projection counts, not live global chain totals.

`POST /api/assets/{id}/verify` accepts `metadata_hash`. Production evaluates current Fabric asset/owner state, returns validity, hash match, source and deterministic mismatch signals. A mismatch records an audit warning. This is not offline ledger SPV verification or proof of the truth of a document.

`POST /api/assets/{id}/evidence` accepts raw bytes with exact Content-Type PDF/PNG/JPEG. The API bounds size (5 MiB by default), checks magic, scans via ClamAV, calculates SHA-256, stores with KMS and indexes/queues a ledger commitment. Returned `ledger_anchored=false` remains pending until its operation commits. `GET /api/evidence/{id}` authorizes organization/parent and owner/manager/auditor, rechecks byte size and digest, and forces an attachment download. VC documents additionally require credential visibility.

`POST /api/credentials/issue`: `{id,subject,commitment}` and idempotency header. Returns signed EdDSA credential JWT and pending ledger operation. The document is privately stored and is valid only after ledger issuance; duplicate document IDs return 409 rather than silently replacing a credential. `POST /api/credentials/verify`: `{credential:<JWT>}` verifies allowlisted kid, signature, expiry, issuer/subject bindings and live revocation. `holder_possession_proven=false` is explicit; presentation proof is a separate certificate-login ceremony.

## Audit, notifications and errors

`GET /api/audit?after=<sequence>` returns at most 200 own-org events; Admin/Auditor only. `GET /api/events?after=...` streams authenticated SSE, with 60-second reauthentication bounds and session/status rechecks. `GET /api/notifications` returns the latest 100 addressed in-app notifications. `GET /metrics` is Admin/Auditor-only Prometheus text counters.

Errors: 401 invalid/expired/replayed session proof; 403 unauthorized; 404 tenant-safe absence/disabled demo; 409 conflicting lifecycle, duplicate content or integrity violation; 413 oversized evidence; 415 unsupported type; 422 schema/proof/scan rejection; 429 with Retry-After; 503 failed security dependency. HTTP responses carry correlation IDs; sanitized dependency failures never return CA secrets or SDK internals. Business endorsement rejection is reflected through operation status, not a fabricated successful response.

Example mint admission:

```bash
curl --cacert /secure/ca.crt https://YOUR_HOST/api/commands \
 -H "Authorization: Bearer $AEGIS_SESSION" -H "Idempotency-Key: $REQUEST_ID" \
 -H 'Content-Type: application/json' \
 -d '{"action":"asset.mint","subject":"asset-001","metadata_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
```

The repeated `a` is a schema example, not a real evidence commitment or secret.
