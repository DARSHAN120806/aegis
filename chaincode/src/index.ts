import { IdentityRegistry } from "./identity";
import { CredentialRegistry } from "./credentials";
import { RolePolicyRegistry } from "./policies";
import { AssetRegistry } from "./assets";
import { OwnershipTransfer } from "./transfers";
import { AuditRegistry } from "./audit";
import { Operations } from "./operations";
export const contracts = [
  Operations,
  IdentityRegistry,
  CredentialRegistry,
  RolePolicyRegistry,
  AssetRegistry,
  OwnershipTransfer,
  AuditRegistry,
];
