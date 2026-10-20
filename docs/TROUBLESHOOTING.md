# Troubleshooting

| Symptom | Diagnosis | Recovery |
|---|---|---|
| Startup validation fails | Missing placeholder replacement, insecure URL, weak key, absent scanner/profile/signing map | Supply the exact production variables in DEPLOYMENT.md; do not change mode to bypass checks. Avoid copying exception/environment output into public logs. |
| Credential startup key error | Signing PEM is not Ed25519 or public map/current kid does not match | Provision matching key pair and readable secret file; retain historical verifier keys. |
| `/health/live` works, `/health/ready` is 503 | Migration missing, stale worker heartbeat, bucket/KMS/CA/Redis/scanner/Gateway unavailable | Inspect sanitized service logs and dependency probes; start worker and fix dependency. Never treat liveness as release acceptance. |
| PostgreSQL TLS fails | Wrong SAN, CA path, URL sslmode or key permissions | Use verify-full and matching service DNS. PostgreSQL requires restrictive key ownership; verify image UID rather than chmod 777. |
| Redis refuses connection | Wrong secret/root, TLS disabled, certificate verification or OOM | Fix authenticated rediss URL/CA and allocated memory. Session loss requires login; do not restore stale sessions. |
| Browser cannot sign PEM | Wrong key format/curve, no secure browser context | Use downloaded P-256 PKCS#8 PEM over HTTPS (localhost is allowed for demo). Never paste a private key into support chat. |
| CA enrollment fails | Secret consumed, wrong affiliation/DID attribute/TLS root, CLI missing | Registrar issues a replacement enrollment. Check official CLI and organization config. Wallet rejects mismatched CA DID attributes and refuses silent replacement. |
| Bootstrap refused | Missing CA `aegis.bootstrap` attribute, DID mismatch or MSP already initialized | Verify registrar-controlled certificate attributes; bootstrap once per MSP only. Do not delete the bootstrap ledger key. |
| Existing session becomes invalid after rotation | Old certificate binding/session no longer matches ledger | Use the replacement key with Activate approved replacement key. This is expected. |
| Lost private key | Cannot prove login with old key | Registrar registers replacement certificate; an independent administrator proposes/approves recovery, then the user proves/activates new key. Revoked identities remain terminal. |
| Queued/confirmed operation never becomes committed | Worker stopped, event identity expired or checkpoint/projection failure | Check worker heartbeat and event stream. Resume from preserved block/transaction checkpoint. Do not update ownership directly. |
| Submit timeout / `uncertain` | Orderer/Gateway response was ambiguous | Reconcile same tx and operation ID; worker retries exact endorsed bytes. A timeout is neither confirmed success nor confirmed failure. |
| `invalid` | Ledger commit rejected, commonly concurrent MVCC change | Review final code/state and obtain a fresh operation only after verifying invalidity. |
| `rejected` | Endorsement refused; authorization/state or peer error | Recheck current identity and lifecycle, diagnose endorsers. No successful ownership is shown. |
| `attention` | Ten failed processing attempts | Operator reviews peer commit/event evidence before authorizing a retry. Preserve operation and endorsed bytes. |
| CA revocation remains pending | Registrar MSP missing/expired or lacks Revoker/GenCRL | Repair registrar, inspect operation `ca_revoked`; publish CRL in channel MSP through governance. Ledger revocation remains in force. |
| Upload 413/415/422 | Oversize, MIME/magic mismatch, scanner rejection | Use permitted actual bytes; do not rename a malicious file to bypass type checks. |
| Upload/read 503 | ClamAV/KMS/S3 unavailable, no committed anchor, ledger unavailable | Restore real dependency. Ensure evidence operation is committed before download. |
| Evidence integrity 409 | Bytes/index no longer match stored/ledger digest | Preserve versions and audit, isolate suspect storage/index writes and compare against the committed ledger anchor. Do not overwrite the digest. |
| Foreign evidence download denied | Source documents stay source-org private after transfer | Use an explicit organizational disclosure process; ownership transfer is not a blanket data grant. |
| No registry results | Wrong organization, role-scoped directory, ID filter or projection lag | Check current session, clear filter, inspect commit status, refresh and page. Never bypass tenant filters. |
| Browser session ends unexpectedly | Short TTL, logout, key rotation, identity lifecycle or Redis restart | Authenticate again with current approved key; investigate unexpected revocation. |
| Production demo endpoint 404 | Intentional mode separation | Use real certificate enrollment/session. Demo identities/reset are not available. |
| Windows pytest hangs in asyncio socketpair | Restricted execution policy may block localhost sockets | Run tests in an environment with loopback permission; do not change production async/security code to work around sandbox policy. |
| Playwright browser executable missing | Chromium was not installed for the current lockfile version | `cd frontend && npx playwright install chromium`; rerun against running API/UI. |
| Golden Journey timeout | Ten steps perform real HTTP calls and reauthentication | Use the existing 45-second completion assertion and inspect actual failures; never replace calls with canned results. |
| Migration checksum mismatch | An applied SQL file was edited or wrong release/database selected | Stop rollout, restore the applied file from the release, create a new migration for changes. Never erase checksum rows. |

Useful commands (from `aegis/`):

```bash
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail=100 api worker bridge
python scripts/validate.py --browser --audit
python scripts/integration_smoke.py --url https://YOUR_HOST --did YOUR_DID --key /secure/key.pem --ca /secure/ca.crt
```

Logs and status IDs support diagnosis without sharing credentials. Review SECURITY.md incident procedures for suspected tampering or privilege compromise. The delivery environment lacked Docker/Fabric: unresolved deployment failures require a capable host and provisioned dependencies, not claims based on unit mocks.
