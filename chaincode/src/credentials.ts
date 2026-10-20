import { Context } from "fabric-contract-api";
import {
  TrustContract,
  caller,
  owner,
  hash,
  unique,
  write,
  read,
  emit,
  timestamp,
} from "./trust";
type Credential = {
  id: string;
  org: string;
  issuer: string;
  subject: string;
  digest: string;
  status: string;
  created: string;
};
export class CredentialRegistry extends TrustContract {
  constructor() {
    super("CredentialRegistry");
  }
  async Issue(ctx: Context, key: string, subject: string, digest: string) {
    const who = await caller(ctx, "credential.manage");
    await owner(ctx, subject, who.org);
    await unique(ctx, "credential", key);
    const value: Credential = {
      id: key,
      org: who.org,
      issuer: who.id,
      subject,
      digest: hash(digest),
      status: "active",
      created: timestamp(ctx),
    };
    await write(ctx, "credential", key, value);
    await emit(ctx, who, "credential.issue", key);
    return JSON.stringify(value);
  }
  async Revoke(ctx: Context, key: string) {
    const who = await caller(ctx, "credential.manage");
    const value = await read<Credential>(ctx, "credential", key);
    if (value.org !== who.org || value.status !== "active")
      throw new Error("Invalid credential lifecycle");
    value.status = "revoked";
    await write(ctx, "credential", key, value);
    await emit(ctx, who, "credential.revoke", key);
  }
  async Verify(ctx: Context, key: string, digest: string) {
    const who = await caller(ctx);
    const value = await read<Credential>(ctx, "credential", key);
    if (value.org !== who.org) throw new Error("Organization boundary");
    const subject = await read<{ status: string }>(
      ctx,
      "identity",
      value.subject,
    );
    return JSON.stringify({
      valid:
        value.digest === hash(digest) &&
        value.status === "active" &&
        subject.status === "active",
    });
  }
}
