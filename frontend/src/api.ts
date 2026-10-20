export type Persona =
  "admin" | "manager" | "auditor" | "user" | "recipient" | "org2admin";
export type Body = {
  status: string;
  roles?: string[];
  owner?: string;
  issuer?: string;
  metadata_hash?: string;
  history?: { action: string; actor: string; owner: string; time: string }[];
};
export type RecordItem = {
  id: string;
  org: string;
  body: Body;
  version: number;
};
export type AuditEvent = {
  sequence: number;
  action: string;
  actor: string;
  subject: string;
  outcome: string;
  time: string;
  source: string;
};
export type Me = { id: string; org: string; roles: string[]; mode: string };
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let accessToken = "";
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      detail =
        typeof data.detail === "string"
          ? data.detail
          : JSON.stringify(data.detail);
    } catch {
      /* Non-JSON errors retain HTTP status. */
    }
    throw new ApiError(detail, response.status);
  }
  return response.json() as Promise<T>;
}
export async function login(persona: Persona) {
  const data = await request<{ access_token: string }>("/api/demo/session", {
    method: "POST",
    body: JSON.stringify({ persona }),
  });
  accessToken = data.access_token;
  return request<Me>("/api/me");
}
export async function waitOperation(
  value: RecordItem | Operation,
): Promise<RecordItem> {
  if (!("operation" in value)) return value;
  for (let i = 0; i < 60; i++) {
    const current = await request<Operation>(
      `/api/operations/${encodeURIComponent(value.operation)}`,
    );
    if (current.status === "committed") return current.result as RecordItem;
    if (["invalid", "attention", "rejected"].includes(current.status))
      throw new Error(
        `Operation ${current.operation}: ${current.status}. Inspect diagnostics before retrying.`,
      );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Operation ${value.operation} is still pending. Check its status before submitting a new operation.`,
  );
}
export type Operation = {
  operation: string;
  status: string;
  result?: unknown;
  tx?: string;
};
export const command = async (
  action: string,
  subject: string,
  extra: object = {},
) =>
  waitOperation(
    await request<RecordItem | Operation>("/api/commands", {
      method: "POST",
      headers: {
        "Idempotency-Key":
          globalThis.crypto.randomUUID?.() ??
          Array.from(
            globalThis.crypto.getRandomValues(new Uint8Array(16)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join(""),
      },
      body: JSON.stringify({ action, subject, ...extra }),
    }),
  );
export async function loginWithKey(did: string, pem: string, activate = false) {
  const proof = await request<{ challenge: string; message: string }>(
    "/api/auth/challenge",
    { method: "POST", body: JSON.stringify({ did }) },
  );
  const bytes = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(proof.message),
  );
  const data = await request<{ access_token: string }>("/api/auth/session", {
    method: "POST",
    body: JSON.stringify({
      did,
      challenge: proof.challenge,
      signature: btoa(String.fromCharCode(...new Uint8Array(signature))),
      activate,
    }),
  });
  accessToken = data.access_token;
  return request<Me>("/api/me");
}
export async function download(path: string) {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "aegis-evidence";
  a.click();
  URL.revokeObjectURL(url);
}
export function logout() {
  accessToken = "";
}
