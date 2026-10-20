import { Context } from "fabric-contract-api";
import { TrustContract, caller, asset } from "./trust";
export class AuditRegistry extends TrustContract {
  constructor() {
    super("AuditRegistry");
  }
  async Provenance(ctx: Context, key: string) {
    await asset(ctx, key, await caller(ctx));
    const iterator = await ctx.stub.getHistoryForKey(`asset:${key}`);
    const history = [];
    try {
      while (true) {
        const next = await iterator.next();
        if (next.value)
          history.push({
            tx: next.value.txId,
            deleted: next.value.isDelete,
            value: Buffer.from(next.value.value).toString(),
          });
        if (next.done) break;
        if (history.length >= 200) break;
      }
    } finally {
      await iterator.close();
    }
    return JSON.stringify(history);
  }
  async Events(ctx: Context) {
    const who = await caller(ctx, "audit.read");
    const iterator = await ctx.stub.getStateByPartialCompositeKey("audit", [
      who.org,
    ]);
    const events = [];
    try {
      while (true) {
        const next = await iterator.next();
        if (next.value)
          events.push(JSON.parse(Buffer.from(next.value.value).toString()));
        if (next.done || events.length >= 200) break;
      }
    } finally {
      await iterator.close();
    }
    return JSON.stringify(events);
  }
}
