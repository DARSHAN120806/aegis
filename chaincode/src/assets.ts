import { Context } from "fabric-contract-api";
import {
  TrustContract,
  caller,
  owner,
  hash,
  unique,
  write,
  emit,
  timestamp,
  asset,
  Asset,
  read,
} from "./trust";
export class AssetRegistry extends TrustContract {
  constructor() {
    super("AssetRegistry");
  }
  async Mint(ctx: Context, key: string, digest: string) {
    const who = await caller(ctx, "asset.mint");
    await unique(ctx, "asset", key);
    const value: Asset = {
      id: key,
      org: who.org,
      issuer: who.id,
      owner: null,
      metadataHash: hash(digest),
      created: timestamp(ctx),
      updated: timestamp(ctx),
      status: "minted",
    };
    await write(ctx, "asset", key, value);
    await emit(ctx, who, "asset.mint", key);
    return JSON.stringify(value);
  }
  async Assign(ctx: Context, key: string, recipient: string) {
    const who = await caller(ctx, "asset.assign");
    const value = await asset(ctx, key, who);
    if (value.status !== "minted")
      throw new Error("Only minted assets can be assigned");
    await owner(ctx, recipient, who.org);
    value.owner = recipient;
    value.status = "active";
    value.updated = timestamp(ctx);
    await write(ctx, "asset", key, value);
    await emit(ctx, who, "asset.assign", key);
  }
  async Archive(ctx: Context, key: string) {
    const who = await caller(ctx, "asset.archive");
    const value = await asset(ctx, key, who);
    if (value.pending || value.status === "archived")
      throw new Error("Invalid archive state");
    value.status = "archived";
    value.updated = timestamp(ctx);
    await write(ctx, "asset", key, value);
    await emit(ctx, who, "asset.archive", key);
  }
  async Get(ctx: Context, key: string) {
    return JSON.stringify(await asset(ctx, key, await caller(ctx)));
  }
  async Verify(ctx: Context, key: string, digest: string) {
    const value = await asset(ctx, key, await caller(ctx));
    const identity = value.owner
      ? await read<{ status: string }>(ctx, "identity", value.owner)
      : null;
    return JSON.stringify({
      matches: value.metadataHash === hash(digest),
      status: value.status,
      owner_active: identity?.status === "active",
      valid:
        value.metadataHash === hash(digest) &&
        value.status === "active" &&
        identity?.status === "active",
      asset: value.id,
    });
  }
}
