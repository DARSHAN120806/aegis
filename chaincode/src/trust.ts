import { createHash } from "node:crypto";
import { Context, Contract } from "fabric-contract-api";
export type Identity = {
  id: string;
  org: string;
  binding: string;
  status: "active" | "suspended" | "revoked";
  roles: string[];
};
export type Asset = {
  id: string;
  org: string;
  issuer: string;
  owner: string | null;
  metadataHash: string;
  created: string;
  updated: string;
  status: "minted" | "active" | "archived";
  pending?: {
    recipient: string;
    recipientOrg?: string;
    requester: string;
    expires: number;
    accepted?: boolean;
    approver?: string;
  };
};
export const permissions: Record<string, string[]> = {
  Admin: [
    "asset.request",
    "identity.manage",
    "credential.manage",
    "asset.mint",
    "asset.assign",
    "asset.approve",
    "asset.archive",
    "audit.read",
  ],
  Manager: [
    "asset.request",
    "credential.manage",
    "asset.mint",
    "asset.assign",
    "asset.approve",
    "asset.archive",
  ],
  Auditor: ["audit.read"],
  User: ["asset.request"],
};
export function id(value: string) {
  if (!/^[a-zA-Z0-9:._-]{1,120}$/.test(value)) throw new Error("Invalid ID");
  return value;
}
export function hash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid SHA-256");
  return value;
}
export function msp(ctx: Context) {
  const org = ctx.clientIdentity.getMSPID();
  if (!["Org1MSP", "Org2MSP"].includes(org))
    throw new Error("Untrusted organization");
  return org;
}
export function binding(ctx: Context) {
  return createHash("sha256")
    .update(ctx.clientIdentity.getIDBytes())
    .digest("hex");
}
export function seconds(ctx: Context) {
  return Number(ctx.stub.getTxTimestamp().seconds.toString());
}
export function timestamp(ctx: Context) {
  return new Date(seconds(ctx) * 1000).toISOString();
}
type WriteContext = Context & { _aegisWrites?: Map<string, Buffer> };
export async function state(ctx: Context, key: string): Promise<Buffer> {
  // Fabric getState reads committed world state, not this proposal's pending writes.
  const pending = (ctx as WriteContext)._aegisWrites?.get(key);
  return pending ?? Buffer.from(await ctx.stub.getState(key));
}
export async function read<T>(
  ctx: Context,
  kind: string,
  key: string,
): Promise<T> {
  const bytes = await state(ctx, `${kind}:${id(key)}`);
  if (!bytes.length) throw new Error("Record not found");
  return JSON.parse(bytes.toString()) as T;
}
export async function unique(ctx: Context, kind: string, key: string) {
  for (const namespace of new Set([
    kind,
    "identity",
    "asset",
    "credential",
    "proposal",
    "organization",
    "evidence",
  ])) {
    if ((await state(ctx, `${namespace}:${id(key)}`)).length)
      throw new Error("Record already exists");
  }
}
export async function write(
  ctx: Context,
  kind: string,
  key: string,
  value: unknown,
) {
  const ledgerKey = `${kind}:${id(key)}`,
    bytes = Buffer.from(JSON.stringify(value));
  await ctx.stub.putState(ledgerKey, bytes);
  const transaction = ctx as WriteContext;
  transaction._aegisWrites ??= new Map();
  transaction._aegisWrites.set(ledgerKey, bytes);
}
export async function caller(
  ctx: Context,
  permission?: string,
): Promise<Identity> {
  const did = ctx.clientIdentity.getAttributeValue("aegis.did");
  if (!did) throw new Error("DID certificate attribute required");
  const who = await read<Identity>(ctx, "identity", did);
  if (
    who.org !== msp(ctx) ||
    who.binding !== binding(ctx) ||
    who.status !== "active"
  )
    throw new Error("Identity binding inactive or invalid");
  if (
    permission &&
    !who.roles.some((r) => permissions[r]?.includes(permission))
  )
    throw new Error("Permission denied");
  return who;
}
export async function owner(ctx: Context, key: string, org: string) {
  const who = await read<Identity>(ctx, "identity", key);
  if (who.status !== "active" || who.org !== org)
    throw new Error("Recipient inactive or foreign organization");
  return who;
}
export async function asset(ctx: Context, key: string, who: Identity) {
  const value = await read<Asset>(ctx, "asset", key);
  if (value.org !== who.org) throw new Error("Organization boundary");
  return value;
}
export async function emit(
  ctx: Context,
  who: Identity,
  action: string,
  subject: string,
) {
  const event = {
    org: who.org,
    actor: who.id,
    action,
    subject,
    kind: action.split(".")[0],
    body: JSON.parse(
      (await state(ctx, `${action.split(".")[0]}:${subject}`)).toString() ||
        "null",
    ),
    tx: ctx.stub.getTxID(),
    time: timestamp(ctx),
  };
  await ctx.stub.putState(
    ctx.stub.createCompositeKey("audit", [who.org, ctx.stub.getTxID()]),
    Buffer.from(JSON.stringify(event)),
  );
  ctx.stub.setEvent("aegis.domain", Buffer.from(JSON.stringify(event)));
}
export class TrustContract extends Contract {
  constructor(name: string) {
    super(name);
  }
  async beforeTransaction(ctx: Context) {
    (ctx as WriteContext)._aegisWrites = new Map();
  }
}
