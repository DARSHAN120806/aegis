import { command, login, request, type Persona } from "./api";
export type Step = {
  label: string;
  persona: Persona;
  run: () => Promise<unknown>;
  denied?: boolean;
};
const hash = "a".repeat(64);
const mint: Step = {
  label: "Mint unique asset",
  persona: "manager",
  run: () => command("asset.mint", "demo-asset", { metadata_hash: hash }),
};
const assign: Step = {
  label: "Allocate to owner",
  persona: "manager",
  run: () => command("asset.assign", "demo-asset", { owner: "did:aegis:user" }),
};
const onboard: Step = {
  label: "Create organization identity",
  persona: "admin",
  run: () => command("identity.create", "did:aegis:alice"),
};
const credential: Step = {
  label: "Issue credential commitment",
  persona: "manager",
  run: () =>
    command("credential.issue", "demo-credential", {
      owner: "did:aegis:alice",
      metadata_hash: hash,
    }),
};
const denied: Step = {
  label: "Block unauthorized mint",
  persona: "user",
  run: () => command("asset.mint", "forbidden-asset", { metadata_hash: hash }),
  denied: true,
};
const transfer: Step[] = [
  {
    label: "Owner requests transfer",
    persona: "user",
    run: () =>
      command("asset.transfer.request", "demo-asset", {
        owner: "did:aegis:recipient",
      }),
  },
  {
    label: "Independent manager approves",
    persona: "manager",
    run: () => command("asset.transfer.approve", "demo-asset"),
  },
  {
    label: "Recipient accepts transfer",
    persona: "recipient",
    run: () => command("asset.transfer.accept", "demo-asset"),
  },
];
const verify: Step = {
  label: "Verify metadata commitment",
  persona: "auditor",
  run: () =>
    request<{ valid: boolean }>("/api/assets/demo-asset/verify", {
      method: "POST",
      body: JSON.stringify({ metadata_hash: hash }),
    }).then((result) => {
      if (!result.valid) throw new Error("Asset verification failed");
      return result;
    }),
};
const investigate: Step = {
  label: "Auditor investigates provenance",
  persona: "auditor",
  run: () => request("/api/audit"),
};
export const scenarios: { name: string; steps: Step[]; note?: string }[] = [
  { name: "Normal identity onboarding", steps: [onboard] },
  { name: "Credential issuance", steps: [onboard, credential] },
  { name: "Asset mint and allocation", steps: [mint, assign] },
  { name: "Authorized asset transfer", steps: [mint, assign, ...transfer] },
  { name: "Unauthorized access blocked", steps: [denied] },
  {
    name: "Privilege escalation blocked",
    steps: [
      {
        label: "Reject unauthorized administration",
        persona: "user",
        run: () => command("identity.create", "did:aegis:escalation"),
        denied: true,
      },
    ],
  },
  {
    name: "Revoked identity blocked",
    steps: [
      {
        label: "Revoke identity",
        persona: "admin",
        run: () => command("identity.revoke", "did:aegis:user"),
      },
      {
        label: "Reject revoked login",
        persona: "admin",
        run: () => login("user"),
        denied: true,
      },
    ],
  },
  { name: "Asset authenticity verification", steps: [mint, assign, verify] },
  {
    name: "Cross-organization boundary",
    note: "Tests demo tenant isolation. Production bilateral transfers use certificate sessions, recipient acceptance and source approval.",
    steps: [
      mint,
      {
        label: "Block foreign organization allocation",
        persona: "org2admin",
        run: () =>
          command("asset.assign", "demo-asset", {
            owner: "did:aegis:org2admin",
          }),
        denied: true,
      },
    ],
  },
  {
    name: "Golden Journey",
    note: "Demo identities and organizations are fixtures. Production enrollment and approved role assignment use the Security desk.",
    steps: [
      onboard,
      credential,
      mint,
      assign,
      denied,
      ...transfer,
      verify,
      investigate,
    ],
  },
];
