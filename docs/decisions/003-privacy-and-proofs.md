# ADR 003 — Minimal commitments and explicit proof limits

Accepted. Shared-channel state contains pseudonyms and commitments only. Profiles use AES-GCM off-chain, evidence uses scanned private KMS objects and signed VC JWTs remain off-chain with exact-byte ledger digests. QR links contain only asset IDs and require authentication. Source evidence does not automatically cross organizations with an asset transfer.

There is no custom Merkle overlay: Fabric's authenticated peer evaluation and transaction validation are the trust mechanism. A hash does not prove authorship, truth or authorization. A valid VC signature is distinct from holder presentation possession. The project identifier is not a registered interoperable public DID method. Fixed permission vocabulary plus approved role/key changes and bounded versioned transfer-expiry policy avoid a general executable policy language.

Global unique trust IDs are retained to match the existing projection primary key; chaincode rejects collisions across trust namespaces. This is simpler than silently allowing a minted asset to overwrite an identity projection.
