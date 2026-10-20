import { ShieldCheck } from "lucide-react";
import type { Persona } from "./api";
import { request } from "./api";
import { useState } from "react";
type Props = {
  persona: Persona;
  setPersona: (p: Persona) => void;
  signIn: (credentials?: {
    did: string;
    key: string;
    activate: boolean;
  }) => void;
  busy: boolean;
  error: string;
  health: string;
  mode: string;
};
export default function LoginScreen({
  persona,
  setPersona,
  signIn,
  busy,
  error,
  health,
  mode,
}: Props) {
  const [did, setDid] = useState(""),
    [key, setKey] = useState<File | null>(null),
    [activate, setActivate] = useState(false);
  const [enrolling, setEnrolling] = useState(false),
    [enrollId, setEnrollId] = useState(""),
    [secret, setSecret] = useState(""),
    [msp, setMsp] = useState("Org1MSP"),
    [feedback, setFeedback] = useState("");
  async function enroll() {
    setEnrolling(true);
    setFeedback("");
    try {
      const result = await request<{
        privateKey: string;
        certificate_hash: string;
      }>("/api/auth/enroll", {
        method: "POST",
        body: JSON.stringify({
          did,
          msp_id: msp,
          enrollment_id: enrollId,
          secret,
        }),
      });
      setSecret("");
      const url = URL.createObjectURL(
        new Blob([result.privateKey], { type: "application/x-pem-file" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "aegis-enrollment-key.pem";
      a.click();
      URL.revokeObjectURL(url);
      setFeedback(
        `Key downloaded once. Protect it. Administrator must bind certificate SHA-256: ${result.certificate_hash}`,
      );
    } catch (e) {
      setFeedback(String(e));
    } finally {
      setEnrolling(false);
    }
  }
  return (
    <main className="login-shell">
      <div className="brand">
        <ShieldCheck size={32} />
        <strong>AEGIS</strong>
      </div>
      <div className="login-composition">
        <div>
          <p className="eyebrow">IDENTITY & OWNERSHIP</p>
          <h1>
            Trust has
            <br />a trace.
          </h1>
          <p className="intro">
            One workspace for organizational identity, controlled access and the
            history behind every asset.
          </p>
          <div className="login-line">
            Private by design. Accountable at every step.
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "production") {
              if (key)
                key
                  .text()
                  .then((text) => signIn({ did, key: text, activate }))
                  .catch((e) => setFeedback(String(e)));
            } else signIn();
          }}
          className="login-form"
        >
          <span className="mode-label">
            {mode === "demo"
              ? "SIMULATED ENVIRONMENT"
              : "CERTIFICATE AUTHENTICATION"}
          </span>
          <h2>Enter the workspace</h2>
          {mode === "demo" ? (
            <>
              <p>
                Choose a seeded demo identity. No real organization or Fabric
                credentials are used.
              </p>
              <label htmlFor="persona">Demo identity</label>
              <select
                id="persona"
                value={persona}
                onChange={(e) => setPersona(e.target.value as Persona)}
              >
                <option value="admin">Org 1 · Administrator</option>
                <option value="manager">Org 1 · Manager</option>
                <option value="auditor">Org 1 · Auditor</option>
                <option value="user">Org 1 · Asset owner</option>
                <option value="recipient">Org 1 · Recipient</option>
                <option value="org2admin">Org 2 · Administrator</option>
              </select>
            </>
          ) : (
            <>
              <p>
                Sign a single-use challenge with your enrolled P-256 key. Your
                key is used locally and is never sent to the API.
              </p>
              <label htmlFor="did">Identity DID</label>
              <input
                id="did"
                value={did}
                onChange={(e) => setDid(e.target.value)}
                required
                pattern="[a-zA-Z0-9:._-]{1,120}"
              />
              <label htmlFor="key">Enrollment private key (PKCS#8 PEM)</label>
              <input
                id="key"
                type="file"
                accept=".pem"
                required
                onChange={(e) => setKey(e.target.files?.[0] || null)}
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={activate}
                  onChange={(e) => setActivate(e.target.checked)}
                />{" "}
                Activate approved replacement key
              </label>
              <details>
                <summary>Enroll a registered identity</summary>
                <p>
                  Your organization registrar supplies a single-use enrollment
                  ID and secret. Activation requires administrator approval.
                </p>
                <label htmlFor="msp">Organization</label>
                <select
                  id="msp"
                  value={msp}
                  onChange={(e) => setMsp(e.target.value)}
                >
                  <option>Org1MSP</option>
                  <option>Org2MSP</option>
                </select>
                <label htmlFor="enroll-id">Enrollment ID</label>
                <input
                  id="enroll-id"
                  value={enrollId}
                  onChange={(e) => setEnrollId(e.target.value)}
                />
                <label htmlFor="enroll-secret">Enrollment secret</label>
                <input
                  id="enroll-secret"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
                <button
                  type="button"
                  disabled={enrolling || !did || !secret || !enrollId}
                  onClick={enroll}
                >
                  {enrolling ? "Enrolling…" : "Enroll and download key"}
                </button>
              </details>
              {feedback && (
                <p role="status" className="hash">
                  {feedback}
                </p>
              )}
            </>
          )}
          <button className="primary" disabled={busy || mode === "unknown"}>
            {busy ? "Connecting…" : "Open workspace"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <small>{health}</small>
        </form>
      </div>
    </main>
  );
}
