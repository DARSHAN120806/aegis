import { Context } from "fabric-contract-api";
import {
  TrustContract,
  Identity,
  binding,
  msp,
  id,
  hash,
  caller,
  read,
  unique,
  write,
  emit,
} from "./trust";
export class IdentityRegistry extends TrustContract {
  constructor() {
    super("IdentityRegistry");
  }
  async Bootstrap(ctx: Context, did: string) {
    id(did);
    const org = msp(ctx);
    if (
      ctx.clientIdentity.getAttributeValue("aegis.bootstrap") !== "true" ||
      ctx.clientIdentity.getAttributeValue("aegis.did") !== did
    )
      throw new Error("Bootstrap enrollment required");
    await unique(ctx, "bootstrap", org);
    await unique(ctx, "identity", did);
    const who: Identity = {
      id: did,
      org,
      binding: binding(ctx),
      status: "active",
      roles: ["Admin"],
    };
    await write(ctx, "identity", did, who);
    await write(ctx, "bootstrap", org, { complete: true });
    await emit(ctx, who, "identity.bootstrap", did);
    return JSON.stringify(who);
  }
  async Create(ctx: Context, did: string, certificateDigest: string) {
    const who = await caller(ctx, "identity.manage");
    await unique(ctx, "identity", did);
    const value: Identity = {
      id: id(did),
      org: who.org,
      binding: hash(certificateDigest),
      status: "active",
      roles: ["User"],
    };
    await write(ctx, "identity", did, value);
    await emit(ctx, who, "identity.create", did);
    return JSON.stringify(value);
  }
  async SetStatus(ctx: Context, did: string, status: string) {
    const who = await caller(ctx, "identity.manage");
    const value = await read<Identity>(ctx, "identity", did);
    if (
      value.org !== who.org ||
      value.id === who.id ||
      value.roles.includes("Admin")
    )
      throw new Error("Independent administrative approval required");
    if (
      !["suspended", "revoked"].includes(status) ||
      value.status === "revoked"
    )
      throw new Error("Invalid lifecycle transition");
    value.status = status as Identity["status"];
    await write(ctx, "identity", did, value);
    await emit(ctx, who, `identity.${status}`, did);
  }
  async Get(ctx: Context, did: string) {
    const who = await caller(ctx);
    const value = await read<Identity>(ctx, "identity", did);
    if (
      value.org !== who.org ||
      (who.roles.every((r) => r === "User") && who.id !== did)
    )
      throw new Error("Permission denied");
    return JSON.stringify(value);
  }
}
