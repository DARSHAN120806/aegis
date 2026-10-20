# ADR 002 — Certificate possession and custodial signing

Accepted with explicit custody risk. The CA issues P-256 certificates containing registrar-controlled DID attributes. Browser challenge signatures prove possession; the bridge retains encrypted per-user keys for Gateway submissions. A login bearer never lets the browser choose an MSP/role/signer. Current ledger binding and status are checked on every request. Replacement keys are staged, independently approved and activated by possession proof.

The deprecated CA Node SDK introduced vulnerabilities during dependency inspection; the bridge instead invokes the official pinned CA CLI without a shell, captures output and cleans temporary material. A compromised bridge can sign as stored identities; HSM/noncustodial signing would change that boundary and is not claimed. All administrators must not share one recoverable key.
