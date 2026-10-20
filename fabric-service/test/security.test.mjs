import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { encryptWallet, decryptWallet } from "../src/wallet.mjs";
import { connect, signers } from "@hyperledger/fabric-gateway";

test("wallet roundtrip, wrong DID, wrong key and tamper rejection", () => {
  const key = randomBytes(32),
    identity = { certificate: "unit-only", privateKey: "unit-only-secret" };
  const sealed = encryptWallet(identity, key, "did:one");
  assert.deepEqual(decryptWallet(sealed, key, "did:one"), identity);
  assert.throws(() => decryptWallet(sealed, key, "did:two"));
  assert.throws(() => decryptWallet(sealed, randomBytes(32), "did:one"));
  assert.throws(() =>
    decryptWallet(
      { ...sealed, data: Buffer.from("tampered").toString("base64") },
      key,
      "did:one",
    ),
  );
  assert.notEqual(encryptWallet(identity, key, "did:one").iv, sealed.iv);
});

test("official Gateway SDK exposes durable transaction and event request serialization", () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  // Unit-only transport stub: no network call or integration success is claimed.
  const gateway = connect({
    client: {},
    identity: { mspId: "Org1MSP", credentials: Buffer.from("unit-test") },
    signer: signers.newPrivateKeySigner(privateKey),
  });
  const network = gateway.getNetwork("aegis");
  const proposal = network
    .getContract("aegis", "Operations")
    .newProposal("Execute", { arguments: ["op-1", "{}"] });
  assert.ok(proposal.getBytes().length > 0);
  assert.equal(
    gateway.newProposal(proposal.getBytes()).getTransactionId(),
    proposal.getTransactionId(),
  );
  const eventRequest = network.newChaincodeEventsRequest("aegis", {
    checkpoint: { getBlockNumber: () => 2n, getTransactionId: () => "tx-1" },
  });
  assert.ok(eventRequest.getBytes().length > 0);
  gateway.close();
});
