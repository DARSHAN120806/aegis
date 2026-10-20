import { Context } from "fabric-contract-api";
import {
  TrustContract,
  caller,
  owner,
  write,
  emit,
  timestamp,
  seconds,
  asset,
  read,
  Asset,
  Identity,
  permissions,
} from "./trust";
export class OwnershipTransfer extends TrustContract {
  constructor() {
    super("OwnershipTransfer");
  }
  async Request(ctx: Context, key: string, recipient: string) {
    const who = await caller(ctx, "asset.request");
    const value = await asset(ctx, key, who);
    if (value.owner !== who.id || value.status !== "active" || value.pending)
      throw new Error("Only active owner may request one pending transfer");
    const recipientIdentity = await read<Identity>(ctx, "identity", recipient);
    if (recipientIdentity.status !== "active")
      throw new Error("Recipient inactive");
    if (recipient === who.id) throw new Error("Recipient already owns asset");
    const policyBytes = await ctx.stub.getState(`organization:${who.org}`);
    const ttl = policyBytes.length
      ? JSON.parse(Buffer.from(policyBytes).toString()).transferTTL || 900
      : 900;
    value.pending = {
      recipient,
      recipientOrg: recipientIdentity.org,
      requester: who.id,
      expires: seconds(ctx) + ttl,
    };
    value.updated = timestamp(ctx);
    await write(ctx, "asset", key, value);
    await emit(ctx, who, "asset.transfer.request", key);
  }
  async Approve(ctx: Context, key: string) {
    const who = await caller(ctx, "asset.approve");
    const value = await asset(ctx, key, who);
    if (
      value.status !== "active" ||
      !value.pending ||
      value.pending.requester === who.id ||
      value.pending.recipient === who.id ||
      value.pending.expires <= seconds(ctx)
    )
      throw new Error("Independent unexpired approval required");
    await owner(
      ctx,
      value.pending.recipient,
      value.pending.recipientOrg || who.org,
    );
    await owner(ctx, value.owner!, who.org);
    value.pending.approver = who.id;
    if (value.pending.accepted) {
      value.owner = value.pending.recipient;
      value.org = value.pending.recipientOrg || value.org;
      delete value.pending;
    }
    value.updated = timestamp(ctx);
    await write(ctx, "asset", key, value);
    await emit(ctx, who, "asset.transfer.approve", key);
  }
  async Accept(ctx: Context, key: string) {
    const who = await caller(ctx, "asset.request");
    const value = await read<Asset>(ctx, "asset", key);
    if (
      !value.pending ||
      value.pending.recipient !== who.id ||
      value.pending.expires <= seconds(ctx)
    )
      throw new Error("Only unexpired recipient may accept");
    await owner(ctx, value.owner!, value.org);
    await owner(ctx, who.id, value.pending.recipientOrg || value.org);
    value.pending.accepted = true;
    if (value.pending.approver) {
      const approver = await owner(ctx, value.pending.approver, value.org);
      if (
        !approver.roles.some((r) => permissions[r]?.includes("asset.approve"))
      )
        throw new Error("Approver no longer authorized");
      value.owner = who.id;
      value.org = who.org;
      delete value.pending;
    }
    value.updated = timestamp(ctx);
    await write(ctx, "asset", key, value);
    await emit(ctx, who, "asset.transfer.accept", key);
  }
  async Cancel(ctx: Context, key: string) {
    const who = await caller(ctx, "asset.request");
    const value = await asset(ctx, key, who);
    if (value.owner !== who.id || !value.pending)
      throw new Error("Only owner may cancel pending transfer");
    delete value.pending;
    await write(ctx, "asset", key, value);
    await emit(ctx, who, "asset.transfer.cancel", key);
  }
}
