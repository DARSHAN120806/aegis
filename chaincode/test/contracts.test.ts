import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Context } from "fabric-contract-api";
import { IdentityRegistry } from "../src/identity";
import { AssetRegistry } from "../src/assets";
import { OwnershipTransfer } from "../src/transfers";
import { CredentialRegistry } from "../src/credentials";
import { caller } from "../src/trust";
let invocation = 0;
function invokeAsFabric<
  T extends { beforeTransaction(ctx: Context): Promise<void> },
>(contract: T): T {
  return new Proxy(contract, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function" || property === "beforeTransaction")
        return value;
      return async (...args: unknown[]) => {
        const context = args[0] as Context;
        const transaction = `test-transaction-${++invocation}`;
        context.stub.getTxID = () => transaction;
        await target.beforeTransaction(context);
        return Reflect.apply(value, target, args);
      };
    },
  });
}
function network() {
  const state = new Map<string, Buffer>();
  let n = 0;
  let clock = 1000;
  const ctx = (did: string, org = "Org1MSP", bootstrap = false): Context =>
    ({
      clientIdentity: {
        getMSPID: () => org,
        getIDBytes: () => Buffer.from(did),
        getAttributeValue: (key: string) =>
          key === "aegis.did"
            ? did
            : key === "aegis.bootstrap" && bootstrap
              ? "true"
              : null,
      },
      stub: {
        getState: async (key: string) => state.get(key) || Buffer.alloc(0),
        putState: async (key: string, value: Buffer) => {
          state.set(key, value);
        },
        getTxTimestamp: () => ({ seconds: clock }),
        getTxID: () => `tx-${++n}`,
        createCompositeKey: (key: string, parts: string[]) =>
          [key, ...parts].join(":"),
        setEvent: () => {},
      },
    }) as unknown as Context;
  return {
    state,
    ctx,
    advance: () => {
      clock += 901;
    },
  };
}
async function fixture() {
  const net = network();
  const identities = invokeAsFabric(new IdentityRegistry());
  const admin = net.ctx("did:aegis:admin", "Org1MSP", true);
  await identities.Bootstrap(admin, "did:aegis:admin");
  for (const who of ["owner", "recipient"])
    await identities.Create(
      admin,
      `did:aegis:${who}`,
      createHash("sha256").update(`did:aegis:${who}`).digest("hex"),
    );
  return {
    ...net,
    identities,
    admin,
    owner: net.ctx("did:aegis:owner"),
    assets: invokeAsFabric(new AssetRegistry()),
    transfers: invokeAsFabric(new OwnershipTransfer()),
  };
}
test("unique mint, assignment and independent approved transfer", async () => {
  const f = await fixture();
  await f.assets.Mint(f.admin, "asset-1", "a".repeat(64));
  await assert.rejects(
    () => f.assets.Mint(f.admin, "asset-1", "a".repeat(64)),
    /exists/,
  );
  await f.assets.Assign(f.admin, "asset-1", "did:aegis:owner");
  await f.transfers.Request(f.owner, "asset-1", "did:aegis:recipient");
  await f.transfers.Approve(f.admin, "asset-1");
  await f.transfers.Accept(f.ctx("did:aegis:recipient"), "asset-1");
  assert.equal(
    JSON.parse(await f.assets.Get(f.admin, "asset-1")).owner,
    "did:aegis:recipient",
  );
  assert.equal(
    JSON.parse(await f.assets.Verify(f.admin, "asset-1", "a".repeat(64))).valid,
    true,
  );
});
test("user cannot mint or approve; binding cannot be forged", async () => {
  const f = await fixture();
  await assert.rejects(
    () => f.assets.Mint(f.owner, "forbidden", "a".repeat(64)),
    /Permission denied/,
  );
  const context = f.ctx("did:aegis:owner");
  context.clientIdentity.getIDBytes = () => Buffer.from("attacker-certificate");
  await assert.rejects(() => caller(context), /binding/);
});
test("revocation and certificate MSP boundary enforced", async () => {
  const f = await fixture();
  await f.identities.SetStatus(f.admin, "did:aegis:owner", "revoked");
  await assert.rejects(() => caller(f.owner), /inactive/);
  await assert.rejects(
    () => caller(f.ctx("did:aegis:admin", "Org2MSP")),
    /binding/,
  );
  await assert.rejects(
    () => f.identities.SetStatus(f.admin, "did:aegis:owner", "suspended"),
    /transition/,
  );
});
test("no foreign allocation and no second bootstrap", async () => {
  const f = await fixture();
  await f.assets.Mint(f.admin, "asset-1", "a".repeat(64));
  const other = f.ctx("did:aegis:other", "Org2MSP", true);
  await f.identities.Bootstrap(other, "did:aegis:other");
  await assert.rejects(
    () => f.assets.Assign(f.admin, "asset-1", "did:aegis:other"),
    /foreign/,
  );
  await assert.rejects(
    () => f.identities.Bootstrap(f.admin, "did:aegis:admin"),
    /exists/,
  );
});
test("transfer expiry and credential revocation", async () => {
  const f = await fixture();
  await f.assets.Mint(f.admin, "asset-1", "a".repeat(64));
  await f.assets.Assign(f.admin, "asset-1", "did:aegis:owner");
  await f.transfers.Request(f.owner, "asset-1", "did:aegis:recipient");
  f.advance();
  await assert.rejects(
    () => f.transfers.Approve(f.admin, "asset-1"),
    /unexpired/,
  );
  const c = invokeAsFabric(new CredentialRegistry());
  await c.Issue(f.admin, "cred-1", "did:aegis:owner", "b".repeat(64));
  assert.equal(
    JSON.parse(await c.Verify(f.owner, "cred-1", "b".repeat(64))).valid,
    true,
  );
  await c.Revoke(f.admin, "cred-1");
  assert.equal(
    JSON.parse(await c.Verify(f.owner, "cred-1", "b".repeat(64))).valid,
    false,
  );
});
import { Operations } from "../src/operations";

test("durable command replay and global identifier collisions", async () => {
  const f = await fixture(),
    operations = invokeAsFabric(new Operations());
  const command = JSON.stringify({
    action: "asset.mint",
    subject: "unique-asset",
    metadata_hash: "a".repeat(64),
  });
  const first = await operations.Execute(f.admin, "operation-1", command);
  assert.equal(
    await operations.Execute(f.admin, "operation-1", command),
    first,
  );
  await assert.rejects(
    () =>
      operations.Execute(
        f.admin,
        "operation-1",
        JSON.stringify({
          action: "asset.mint",
          subject: "different",
          metadata_hash: "a".repeat(64),
        }),
      ),
    /mismatch/,
  );
  await assert.rejects(
    () =>
      operations.Execute(
        f.admin,
        "operation-2",
        JSON.stringify({
          action: "asset.mint",
          subject: "did:aegis:owner",
          metadata_hash: "a".repeat(64),
        }),
      ),
    /exists/,
  );
});

test("role governance needs independent authorized approval", async () => {
  const f = await fixture(),
    operations = invokeAsFabric(new Operations());
  await operations.Execute(
    f.owner,
    "role-request",
    JSON.stringify({
      action: "role.propose",
      subject: "role-proposal",
      owner: "did:aegis:owner",
      role: "Manager",
    }),
  );
  await assert.rejects(
    () =>
      operations.Execute(
        f.owner,
        "bad-approval",
        JSON.stringify({
          action: "proposal.approve",
          subject: "role-proposal",
        }),
      ),
    /Permission/,
  );
  await operations.Execute(
    f.admin,
    "role-approval",
    JSON.stringify({ action: "proposal.approve", subject: "role-proposal" }),
  );
  assert.deepEqual(JSON.parse(await operations.WhoAmI(f.owner)).roles, [
    "Manager",
  ]);
  await assert.rejects(
    () =>
      operations.Execute(
        f.admin,
        "repeat-approval",
        JSON.stringify({
          action: "proposal.approve",
          subject: "role-proposal",
        }),
      ),
    /approval/,
  );
});

test("cross organization transfer needs source approval and destination acceptance", async () => {
  const f = await fixture(),
    operations = invokeAsFabric(new Operations());
  const other = f.ctx("did:aegis:foreign", "Org2MSP", true);
  await f.identities.Bootstrap(other, "did:aegis:foreign");
  await f.assets.Mint(f.admin, "cross-asset", "a".repeat(64));
  await f.assets.Assign(f.admin, "cross-asset", "did:aegis:owner");
  await f.transfers.Request(f.owner, "cross-asset", "did:aegis:foreign");
  await assert.rejects(
    () => f.transfers.Approve(other, "cross-asset"),
    /boundary/,
  );
  await f.transfers.Accept(other, "cross-asset");
  assert.equal(
    JSON.parse(await f.assets.Get(f.admin, "cross-asset")).owner,
    "did:aegis:owner",
  );
  await f.transfers.Approve(f.admin, "cross-asset");
  const result = JSON.parse(await f.assets.Get(other, "cross-asset"));
  assert.equal(result.org, "Org2MSP");
  assert.equal(result.owner, "did:aegis:foreign");
  await assert.rejects(() => f.assets.Get(f.admin, "cross-asset"), /boundary/);
  await assert.rejects(
    () => operations.Get(f.admin, "asset", "cross-asset"),
    /boundary/,
  );
});

test("recipient cannot independently approve and strangers cannot accept", async () => {
  const f = await fixture();
  await f.assets.Mint(f.admin, "asset-1", "a".repeat(64));
  await f.assets.Assign(f.admin, "asset-1", "did:aegis:owner");
  await f.transfers.Request(f.owner, "asset-1", "did:aegis:admin");
  await assert.rejects(
    () => f.transfers.Approve(f.admin, "asset-1"),
    /Independent/,
  );
  await assert.rejects(
    () => f.transfers.Accept(f.ctx("did:aegis:recipient"), "asset-1"),
    /recipient/,
  );
});

test("command rejects unrecognized fields, insecure certificate commitments and inactive targets", async () => {
  const f = await fixture(),
    operations = invokeAsFabric(new Operations());
  await assert.rejects(
    () =>
      operations.Execute(
        f.admin,
        "injected",
        JSON.stringify({
          action: "identity.create",
          subject: "attacker",
          roles: ["Admin"],
        }),
      ),
    /Unknown field/,
  );
  await assert.rejects(
    () =>
      operations.Execute(
        f.admin,
        "bad-cert",
        JSON.stringify({
          action: "identity.create",
          subject: "attacker",
          certificate_hash: "no",
        }),
      ),
    /SHA-256/,
  );
  await f.identities.SetStatus(f.admin, "did:aegis:owner", "revoked");
  await assert.rejects(
    () =>
      operations.Execute(
        f.admin,
        "recover",
        JSON.stringify({
          action: "identity.recover.propose",
          subject: "recover-proposal",
          owner: "did:aegis:owner",
          certificate_hash: "a".repeat(64),
        }),
      ),
    /terminal/,
  );
});

test("policy mutation is versioned and requires independent organization approval", async () => {
  const f = await fixture(),
    operations = invokeAsFabric(new Operations());
  await operations.Execute(
    f.owner,
    "become-admin",
    JSON.stringify({
      action: "role.propose",
      subject: "admin-proposal",
      owner: "did:aegis:owner",
      role: "Admin",
    }),
  );
  await operations.Execute(
    f.admin,
    "approve-admin",
    JSON.stringify({ action: "proposal.approve", subject: "admin-proposal" }),
  );
  await operations.Execute(
    f.admin,
    "configure-org",
    JSON.stringify({ action: "organization.configure", subject: "Org1MSP" }),
  );
  await operations.Execute(
    f.owner,
    "propose-policy",
    JSON.stringify({
      action: "policy.propose",
      subject: "ttl-proposal",
      transfer_ttl: 120,
    }),
  );
  await assert.rejects(
    () =>
      operations.Execute(
        f.owner,
        "self-policy",
        JSON.stringify({ action: "proposal.approve", subject: "ttl-proposal" }),
      ),
    /Independent/,
  );
  await operations.Execute(
    f.admin,
    "approve-policy",
    JSON.stringify({ action: "proposal.approve", subject: "ttl-proposal" }),
  );
  const org = JSON.parse(
    await operations.Get(f.admin, "organization", "Org1MSP"),
  );
  assert.equal(org.transferTTL, 120);
  assert.equal(org.version, 2);
  await assert.rejects(
    () =>
      operations.Execute(
        f.admin,
        "overwrite-policy",
        JSON.stringify({
          action: "organization.configure",
          subject: "Org1MSP",
        }),
      ),
    /exists/,
  );
  await f.assets.Mint(f.admin, "ttl-asset", "a".repeat(64));
  await f.assets.Assign(f.admin, "ttl-asset", "did:aegis:owner");
  await f.transfers.Request(f.owner, "ttl-asset", "did:aegis:recipient");
  assert.equal(
    JSON.parse(await f.assets.Get(f.admin, "ttl-asset")).pending.expires,
    1120,
  );
});

test("Fabric world-state semantics: pending writes are not returned by stub.getState", async () => {
  const net = network(),
    operations = invokeAsFabric(new Operations()),
    pending = new Map<string, Buffer>();
  const admin = net.ctx("did:aegis:bootstrap", "Org1MSP", true);
  admin.stub.putState = async (key: string, value: Buffer) => {
    pending.set(key, value);
  };
  // getState still reads net.state only: this reproduces Fabric's lack of read-your-writes.
  await operations.beforeTransaction(admin);
  await operations.Bootstrap(admin, "did:aegis:bootstrap");
  assert.equal(net.state.size, 0);
  assert.equal(
    JSON.parse(pending.get("identity:did:aegis:bootstrap")!.toString()).status,
    "active",
  );
  for (const [key, value] of pending) net.state.set(key, value);
  pending.clear();
  await operations.beforeTransaction(admin);
  const result = JSON.parse(
    await operations.Execute(
      admin,
      "real-semantics-mint",
      JSON.stringify({
        action: "asset.mint",
        subject: "staged-asset",
        metadata_hash: "a".repeat(64),
      }),
    ),
  );
  assert.equal(result.body.status, "minted");
  assert.equal(net.state.has("asset:staged-asset"), false);
  assert.equal(
    JSON.parse(pending.get("asset:staged-asset")!.toString()).metadataHash,
    "a".repeat(64),
  );
});
