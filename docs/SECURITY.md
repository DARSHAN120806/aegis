# Security model

## Authority and boundaries

Fabric is the permissioned system of record. Current production identity authorization comes from a certificate-bound ledger evaluation on every API request. The backend independently checks role, tenant and relevant owner/recipient/proposal predicates at admission. Chaincode repeats authorization and validates state at endorsement; Fabric MVCC detects conflicting state at commit. PostgreSQL projections are never sufficient to authorize writes.

The CA registrar controls DID/bootstrap attributes. Only Org1MSP/Org2MSP are accepted. The internal bridge cannot be exposed to untrusted callers: its service token authorizes custodial signing and enrollment operations. Use dedicated network policies, TLS and restrictive secret mounts. Organization peer endorsement is necessary, but does not remove trust in application/session admission.

| Threat | Implemented control | Operational qualification |
|---|---|---|
| Role or MSP spoofing | Ledger roles, CA DID attribute, MSP allowlist and certificate digest; strict schema rejects supplied role grants except proposals | Protect registrar and bootstrap attributes |
| Tenant IDOR | Scoped SQL reads; independently scoped ledger reads/mutations; recipient exception is explicit | Asset transfer moves business tenancy; evidence does not automatically migrate |
| Session theft/replay | P-256 challenge proof, Redis GETDEL, 90-second challenge, short JWT, Redis session ID, current binding/status and logout | XSS or stolen private keys defeat possession; use managed endpoints |
| Double mint/transfer | Global trust IDs, actor/key request uniqueness, ledger operation replay key, pending-state rules, MVCC | Retain replay keys; investigate ambiguous outcomes before new operations |
| Privilege escalation | User-only onboarding; role/key proposals expire and need separate Admin approval; no self/admin direct revoke bypass | Establish at least two administrators; loss of all administrators requires formal network recovery |
| Malicious uploads | Size cap, exact MIME allowlist, magic validation, fail-closed ClamAV, generated object keys, forced attachment | Keep signatures fresh; antivirus cannot prove content harmless |
| Evidence tampering | Upload SHA-256, S3 checksum/KMS/versioning, ledger digest anchor, rehash every download, audit on mismatch | A hash proves byte agreement, not authorship or truth |
| SSRF/path traversal | No user-controlled URLs; fixed organization endpoints; hashed wallet filenames, fixed temporary directories and non-shell CLI invocation | Configuration/secret mounts remain privileged input |
| Injection/serialization | Pydantic extra-forbid, bounded identifiers, SQLAlchemy bound parameters, JSON only; no pickle or eval | Do not add arbitrary contract names, SQL or remote URL fetches |
| Audit alteration | Fabric events/history; SQL append-only triggers and no application DELETE privilege | DB owners can alter triggers; use external WORM retention and independent ledger reconciliation |
| Dependency outage | Strict production validation, bounded network timeouts, readiness probes, no simulated fallback, uncertain/attention states | Exercise live failure injection before rollout |

## Cryptographic design

Login signs the exact domain-separated challenge message with P-256 ECDSA SHA-256. Python accepts DER and normalizes browser 64-byte r||s signatures; it checks certificate validity dates. The certificate is obtained from a CA-enrolled wallet, not an arbitrary request field. Current ledger binding and CA DID attribute establish the intended principal. A SHA-256 certificate digest alone is never accepted as possession.

Bearer JWTs use a configured high-entropy HS256 session secret with issuer/audience/expiry validation; tokens remain in browser memory. No refresh token or cookie authentication exists. Rotating the session signing secret invalidates outstanding JWTs. Logout removes the Redis session. API dependency failure cannot yield an anonymous fallback. CORS is an exact HTTPS allowlist in production; bearer headers avoid ambient-cookie CSRF. The TLS ingress enforces HSTS, restrictive CSP, nosniff and frame denial.

Verifiable credential documents are Ed25519-signed JWTs with a VC envelope, issuer, subject, credential ID, validity and a commitment. Only allowlisted `kid` public keys are accepted. Verification also checks current ledger digest, issuer/subject and revocation/holder identity state. The result explicitly does **not** assert holder presentation possession. The project DID-style identifier is not a registered public DID method; no universal DID resolution or third-party VC interoperability certification is claimed.

Bridge wallets use AES-256-GCM with independent random IVs and DID-associated data. The operator supplies a separate 32-byte wallet key. Profiles use a separate AES-GCM key and `org:DID` AAD. KMS protects S3 payloads; TLS protects CA/Gateway/Redis/S3 communication. API-to-Nginx and API-to-PostgreSQL TLS configuration is documented separately. Database storage encryption, secret storage encryption and physical host protection are deployment responsibilities.

## Key rotation and recovery

Enroll a new CA identity with the same controlled DID attribute; it is stored in a `.pending` encrypted wallet. Propose the pending certificate hash. A different administrator approves it on the ledger. Login with the replacement key and `activate=true`; proof is verified before the bridge checks the new ledger binding and atomically promotes the wallet. Old sessions and old certificates no longer match the ledger. Suspended users can be recovered by an active administrator; revoked identities cannot be resurrected. CA revocation and channel MSP CRL distribution remain separate lifecycle steps.

For VC signing rotation, deploy a new key ID/private key and add its public key to the verifier map; retain old public keys for the validity/retention period. Re-encrypt profile rows and encrypted wallet files before replacing their encryption keys; changing an environment variable without re-encryption makes stored data unreadable. Test rollback and secure backup before rotation.

## Secrets, logs and incident response

Templates contain placeholders only. `.env`, production environment files, wallet files and `infra/secrets/` are excluded. Never publish tokens, CA enrollment output, private keys, database URLs or complete environment dumps. Configuration validation hides input values. Structured logs include correlation/operation IDs and error types, not request bodies or SDK error messages.

On compromise: isolate ingress/bridge, preserve ledger and append-only audit, disable sessions, suspend/revoke affected identities, rotate the relevant secrets, publish CA CRLs through channel governance, inspect all uncertain/committed operations, restore from verified clean backups and run the live smoke tests. A stolen custodian wallet key requires treating all stored enrollment keys as exposed. Do not delete suspicious operations or reset production to hide an incident.

## Residual risks and release gate

No live penetration test, container scan, Fabric consensus failure test, HA recovery exercise or external security assessment was executed here. The application has deterministic integrity/lifecycle fraud signals, not a statistical fraud detector. PDC configuration exists, but raw confidential business documents remain off-chain. Production rollout requires the documented live suite, fresh image scans, verified TLS/KMS/CA permissions, monitored signature updates and an agreed retention/incident policy.
