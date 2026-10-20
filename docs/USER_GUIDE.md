# User guide

## Choosing an environment

The topbar always identifies demo simulation or certificate/Fabric mode. Demo identities are fixtures and Jury Demo is shown only in demo mode. Production sessions prove possession of an enrolled key; no seeded identity, reset button or synthetic ledger statistics are available there.

## Enrollment and sign-in

Your organization registrar supplies an enrollment ID, one-use secret and DID. At the production login screen, open **Enroll a registered identity**, enter the organization/ID/secret and download the private key once. Store it securely; it is a PKCS#8 P-256 PEM and is needed for browser proof of possession. Give the returned certificate SHA-256 to an administrator. A normal identity cannot sign in until its certificate has been created on the ledger. Initial administrators are bootstrapped separately by organization operators.

Select the downloaded key file, enter your DID and open the workspace. The browser signs a single-use challenge locally; it never posts the key to the API. The bridge retains a separate encrypted custodial copy for authorized ledger submission. Tokens remain in browser memory, expire quickly and are revoked on sign out. Mobile users can sign out in the topbar.

## Organization administrator

Use Security desk → Governance to create a previously enrolled identity with its certificate hash. New identities receive User. A user may propose a role for themself; an administrator different from requester/target approves the proposal ID. An administrator may also propose changes for other identities, but cannot approve their own proposal. Review the Proposals registry and actual request details before approval. Proposals expire after 15 minutes. Configure your own MSP organization record once. Propose a transfer expiry of 60–3600 seconds through policy.propose; a different administrator approves it and increments the policy version. Existing transfer deadlines do not change. Channel organization onboarding is a separate network-governance action.

Suspend/revoke ordinary identities through Workflow and confirm destructive changes. Revocation is terminal; existing sessions stop authorizing because the ledger state is rechecked. Direct mutation of self/administrative identities is blocked rather than providing an unsafe bypass. Maintain independent administrators and use the documented key recovery process.

## Asset issuer / manager

Mint a globally unique asset ID with the SHA-256 of its actual canonical evidence/metadata bytes. A schema-valid example hash is not real evidence. Allocate a minted asset to an active same-organization identity. Once allocated, changes of ownership use the transfer protocol. An archived asset is no longer active and cannot have a pending transfer.

Issue a signed credential by selecting credential.issue in the workflow: production creates an Ed25519-signed VC JWT, downloads it and queues its exact document digest. Wait for committed status. The subject and issuer must remain valid according to ledger policy. Revoke using credential.revoke when necessary. A raw command commitment is not itself a signed VC document.

## Owner and recipient

The current owner selects asset.transfer.request and the recipient DID. A separate source-org Admin/Manager selects asset.transfer.approve. The named recipient selects asset.transfer.accept; both conditions must be satisfied before ownership moves. The approver cannot be the owner/requester or recipient. Recipient acceptance can precede approval. Requests expire according to the captured organization policy (15 minutes by default); the owner can cancel. Cross-MSP recipients are supported in production and see the explicitly addressed pending asset; final ownership changes the asset organization.

A request returning an operation ID is pending. The UI waits for the commit and event projection. If it reports an uncertain/pending ID, use Security desk → Operations to inspect that **same** ID. Do not submit a new ownership operation to guess whether the first succeeded.

## Evidence, credentials and provenance

In Security desk, supply the asset ID and PDF/PNG/JPEG file (default max 5 MiB). Evidence must pass type/magic and malware checks. The returned hash anchors exact bytes, while the object stays private and KMS encrypted. Retrieve by its evidence ID only after the anchor commits. Downloads recheck authorization, ledger commitment, stored length and SHA-256; failures block the bytes and flag audit. After a cross-org transfer, source private evidence is not automatically disclosed to the destination.

Paste a signed credential JWT into the verifier to check signature, known signing key, issuer/subject, expiry and live revocation. `holder_possession_proven=false` is intentional: document validity and holder authentication are different checks. Use certificate login for authenticated possession; this application is not a universal DID resolver or third-party wallet certification.

Open Provenance, select an asset and inspect its issuer→asset→owner relationships and chronological changes. A QR opens the authenticated verification view for that asset ID; it never embeds an access token or evidence URL. Supply the original metadata hash to verify commitment and active states. A mismatch is a deterministic investigation signal, not proof that a person committed fraud. Hash matches never establish the truth of a document.

## Auditor and private profile

Admin/Auditor can inspect tenant audit events, denials and commit outcomes. Event sequence is an API index, not a block number. Notifications show addressed committed actions; refresh to load them. Health shows actual dependency-readiness responses. Organization totals come from the real operational projection and may lag a ledger transaction until it is projected.

Security desk also provides your private display/contact profile, encrypted off-chain. It does not publish names/contact details into the ledger. Search registries by ID, select records, use Load next records for keyset pagination and Refresh workspace for current state. Permission-limited users receive understandable denials; frontend action visibility is a convenience and never the authorization boundary.

## Demonstration

In demo mode choose Org1 Administrator → Jury Demo → Reset → Golden Journey. Ten steps create a demo identity/credential, mint/allocate an asset, deny a forbidden mint, request/approve/accept a transfer, verify and audit. Pause/Step works between API calls; speed controls presentation spacing only. Reset removes demo fixtures/generated records only. The demo is deliberately not Fabric, production enrollment, production evidence or production governance.
