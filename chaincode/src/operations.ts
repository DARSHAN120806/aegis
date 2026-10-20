import { Context } from "fabric-contract-api";
import { createHash } from "node:crypto";
import {
  TrustContract,
  caller,
  read,
  write,
  id,
  hash,
  seconds,
  timestamp,
  Identity,
  binding,
  msp,
  unique,
} from "./trust";
import { IdentityRegistry } from "./identity";
import { AssetRegistry } from "./assets";
import { CredentialRegistry } from "./credentials";
import { OwnershipTransfer } from "./transfers";

type Command = {
  action: string;
  subject: string;
  owner?: string;
  metadata_hash?: string;
  certificate_hash?: string;
  role?: string;
  proposal?: string;
  transfer_ttl?: number;
};
type Proposal = {
  id: string;
  org: string;
  requester: string;
  target: string;
  action: string;
  value: string;
  expires: number;
  status: string;
};

export class Operations extends TrustContract {
  constructor() {
    super("Operations");
  }
  async WhoAmI(ctx: Context) {
    return JSON.stringify(await caller(ctx));
  }
  async Bootstrap(ctx: Context, did: string) {
    const result = await new IdentityRegistry().Bootstrap(ctx, did);
    await this._event(
      ctx,
      "identity.bootstrap",
      did,
      JSON.parse(result),
      "identity",
    );
    return result;
  }
  async Get(ctx: Context, kind: string, key: string) {
    const who = await caller(ctx);
    if (
      ![
        "identity",
        "asset",
        "credential",
        "proposal",
        "organization",
        "evidence",
      ].includes(kind)
    )
      throw new Error("Invalid kind");
    const value = await read<Record<string, any>>(ctx, kind, key);
    if (
      value.org !== who.org &&
      !(kind === "asset" && value.pending?.recipient === who.id)
    )
      throw new Error("Organization boundary");
    if (
      ["identity", "credential"].includes(kind) &&
      who.roles.every((r) => r === "User") &&
      (kind === "identity" ? value.id !== who.id : value.subject !== who.id)
    )
      throw new Error("Permission denied");
    return JSON.stringify(value);
  }
  async Execute(ctx: Context, operation: string, raw: string) {
    id(operation);
    const who = await caller(ctx);
    const digest = createHash("sha256").update(raw).digest("hex");
    const opKey = ctx.stub.createCompositeKey("operation", [who.id, operation]);
    const prior = await ctx.stub.getState(opKey);
    if (prior.length) {
      const previous = JSON.parse(Buffer.from(prior).toString());
      if (previous.digest !== digest)
        throw new Error("Operation payload mismatch");
      return JSON.stringify(previous.result);
    }
    const c: Command = JSON.parse(raw);
    if (
      Object.keys(c).some(
        (k) =>
          ![
            "action",
            "subject",
            "owner",
            "metadata_hash",
            "certificate_hash",
            "role",
            "proposal",
            "transfer_ttl",
          ].includes(k),
      )
    )
      throw new Error("Unknown field");
    id(c.subject);
    const identities = new IdentityRegistry(),
      assets = new AssetRegistry();
    const credentials = new CredentialRegistry(),
      transfers = new OwnershipTransfer();
    let kind = c.action.split(".")[0];
    switch (c.action) {
      case "evidence.attach": {
        const asset = await read<Record<string, any>>(ctx, "asset", c.owner!);
        if (
          asset.org !== who.org ||
          (asset.owner !== who.id &&
            !who.roles.some((r) => ["Admin", "Manager"].includes(r)))
        )
          throw new Error("Permission denied");
        await unique(ctx, "evidence", c.subject);
        await write(ctx, "evidence", c.subject, {
          id: c.subject,
          org: who.org,
          asset: c.owner,
          digest: hash(c.metadata_hash!),
          status: "anchored",
        });
        break;
      }
      case "identity.create":
        await identities.Create(ctx, c.subject, hash(c.certificate_hash!));
        break;
      case "identity.suspend":
        await identities.SetStatus(ctx, c.subject, "suspended");
        break;
      case "identity.revoke":
        await identities.SetStatus(ctx, c.subject, "revoked");
        break;
      case "asset.mint":
        await assets.Mint(ctx, c.subject, c.metadata_hash!);
        break;
      case "asset.assign":
        await assets.Assign(ctx, c.subject, c.owner!);
        break;
      case "asset.archive":
        await assets.Archive(ctx, c.subject);
        break;
      case "asset.transfer.request":
        await transfers.Request(ctx, c.subject, c.owner!);
        break;
      case "asset.transfer.approve":
        await transfers.Approve(ctx, c.subject);
        break;
      case "asset.transfer.accept":
        await transfers.Accept(ctx, c.subject);
        break;
      case "asset.transfer.cancel":
        await transfers.Cancel(ctx, c.subject);
        break;
      case "credential.issue":
        await credentials.Issue(ctx, c.subject, c.owner!, c.metadata_hash!);
        break;
      case "credential.revoke":
        await credentials.Revoke(ctx, c.subject);
        break;
      case "role.propose":
      case "identity.recover.propose":
      case "identity.rotate.propose": {
        const target = await read<Identity>(ctx, "identity", c.owner!);
        if (
          target.org !== who.org ||
          (target.id !== who.id && !who.roles.includes("Admin"))
        )
          throw new Error("Permission denied");
        if (target.status === "revoked") throw new Error("Revocation terminal");
        if (
          c.action === "role.propose" &&
          !["Admin", "Manager", "Auditor", "User"].includes(c.role!)
        )
          throw new Error("Invalid role");
        await unique(ctx, "proposal", c.subject);
        const p: Proposal = {
          id: c.subject,
          org: who.org,
          requester: who.id,
          target: target.id,
          action: c.action,
          value:
            c.action === "role.propose" ? c.role! : hash(c.certificate_hash!),
          expires: seconds(ctx) + 900,
          status: "pending",
        };
        await write(ctx, "proposal", c.subject, p);
        kind = "proposal";
        break;
      }
      case "policy.propose": {
        if (!who.roles.includes("Admin")) throw new Error("Permission denied");
        if (
          !Number.isInteger(c.transfer_ttl) ||
          c.transfer_ttl! < 60 ||
          c.transfer_ttl! > 3600
        )
          throw new Error("Invalid transfer TTL");
        await unique(ctx, "proposal", c.subject);
        await read(ctx, "organization", who.org);
        await write(ctx, "proposal", c.subject, {
          id: c.subject,
          org: who.org,
          requester: who.id,
          target: who.org,
          action: c.action,
          value: String(c.transfer_ttl),
          expires: seconds(ctx) + 900,
          status: "pending",
        });
        kind = "proposal";
        break;
      }
      case "proposal.approve": {
        if (!who.roles.includes("Admin")) throw new Error("Permission denied");
        const p = await read<Proposal>(ctx, "proposal", c.subject);
        if (
          p.org !== who.org ||
          p.requester === who.id ||
          p.target === who.id ||
          p.status !== "pending" ||
          p.expires <= seconds(ctx)
        )
          throw new Error("Independent approval required");
        const requester = await read<Identity>(ctx, "identity", p.requester);
        if (
          requester.org !== who.org ||
          requester.status !== "active" ||
          (p.action === "policy.propose" && !requester.roles.includes("Admin"))
        )
          throw new Error("Requester no longer authorized");
        if (p.action === "policy.propose") {
          const organization = await read<Record<string, any>>(
            ctx,
            "organization",
            who.org,
          );
          organization.transferTTL = Number(p.value);
          organization.version += 1;
          await write(ctx, "organization", who.org, organization);
          p.status = "approved";
          await write(ctx, "proposal", p.id, p);
          kind = "proposal";
          break;
        }
        const target = await read<Identity>(ctx, "identity", p.target);
        if (target.status === "revoked") throw new Error("Revocation terminal");
        if (p.action === "role.propose") target.roles = [p.value];
        else {
          target.binding = hash(p.value);
          target.status = "active";
        }
        p.status = "approved";
        await write(ctx, "identity", target.id, target);
        await this._event(ctx, p.action, target.id, target, "identity");
        await write(ctx, "proposal", p.id, p);
        kind = "proposal";
        break;
      }
      case "organization.configure": {
        if (!who.roles.includes("Admin") || c.subject !== who.org)
          throw new Error("Permission denied");
        await unique(ctx, "organization", c.subject);
        await write(ctx, "organization", c.subject, {
          id: who.org,
          org: who.org,
          status: "active",
          policy: "owner+recipient+independent-approver",
          transferTTL: 900,
          version: 1,
        });
        break;
      }
      default:
        throw new Error("Unsupported operation");
    }
    const record = await read<Record<string, any>>(ctx, kind, c.subject);
    const result = {
      id: c.subject,
      org: record.org,
      kind,
      body: record,
      tx: ctx.stub.getTxID(),
      source: "fabric",
    };
    await ctx.stub.putState(
      opKey,
      Buffer.from(JSON.stringify({ digest, result })),
    );
    await this._event(ctx, c.action, c.subject, record, kind, operation);
    return JSON.stringify(result);
  }
  async _event(
    ctx: Context,
    action: string,
    subject: string,
    body: unknown,
    kind: string,
    operation?: string,
  ) {
    const who = await caller(ctx);
    // Events contain commitments and pseudonymous identifiers only.
    const event = {
      org: (body as any).org || who.org,
      actorOrg: who.org,
      actor: who.id,
      action,
      subject,
      kind,
      body,
      tx: ctx.stub.getTxID(),
      time: timestamp(ctx),
      operation,
    };
    // Approved proposals also change identity state; include it in the same event for atomic projection.
    if (
      kind === "proposal" &&
      (body as Proposal).status === "approved" &&
      (body as Proposal).action === "policy.propose"
    )
      (event as any).organization = await read(ctx, "organization", who.org);
    else if (kind === "proposal" && (body as Proposal).status === "approved")
      (event as any).identity = await read<Identity>(
        ctx,
        "identity",
        (body as Proposal).target,
      );
    ctx.stub.setEvent("aegis.domain", Buffer.from(JSON.stringify(event)));
  }
  async Claim(ctx: Context, did: string) {
    // Enrollment activation is restricted to the certificate recorded by an administrator.
    const who = await read<Identity>(ctx, "identity", id(did));
    if (
      who.binding !== binding(ctx) ||
      who.org !== msp(ctx) ||
      ctx.clientIdentity.getAttributeValue("aegis.did") !== did
    )
      throw new Error("Enrollment binding mismatch");
    return JSON.stringify(who);
  }
}
