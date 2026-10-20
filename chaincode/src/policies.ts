import { Context } from "fabric-contract-api";
import { TrustContract, caller, permissions } from "./trust";
export class RolePolicyRegistry extends TrustContract {
  constructor() {
    super("RolePolicyRegistry");
  }
  async Matrix(ctx: Context) {
    await caller(ctx);
    return JSON.stringify(permissions);
  }
  // Fixed permission vocabulary; approved role changes are enforced by Operations proposals.
}
