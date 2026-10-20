import { useState } from "react";
import {
  command,
  download,
  request,
  waitOperation,
  type Operation,
  type Me,
} from "./api";
import { Surface } from "./components";

export default function SecurityDesk({
  me,
  onChanged,
}: {
  me: Me;
  onChanged: () => Promise<void>;
}) {
  const [action, setAction] = useState("role.propose"),
    [subject, setSubject] = useState(""),
    [target, setTarget] = useState(me.id),
    [hash, setHash] = useState(""),
    [role, setRole] = useState("User");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [asset, setAsset] = useState(""),
    [evidenceId, setEvidenceId] = useState("");
  const [signed, setSigned] = useState(""),
    [notices, setNotices] = useState<
      { id: string; action: string; subject: string }[]
    >([]);
  const [operation, setOperation] = useState("");
  const [displayName, setDisplayName] = useState(""),
    [contact, setContact] = useState("");
  const admin = me.roles.includes("Admin");
  const [transferTTL, setTransferTTL] = useState(900);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await work();
      setMessage(typeof result === "string" ? result : JSON.stringify(result));
      await onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="work-grid">
      <Surface title="Private identity profile">
        <form
          className="workflow-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              request("/api/profile", {
                method: "POST",
                body: JSON.stringify({ display_name: displayName, contact }),
              }),
            );
          }}
        >
          <label htmlFor="profile-name">Display name</label>
          <input
            id="profile-name"
            required
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <label htmlFor="profile-contact">Private contact</label>
          <input
            id="profile-contact"
            maxLength={160}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
          <button disabled={busy}>Save encrypted profile</button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const p = await request<{
                  display_name: string;
                  contact: string;
                }>("/api/profile");
                setDisplayName(p.display_name);
                setContact(p.contact);
                return "Private profile loaded";
              })
            }
          >
            Load my profile
          </button>
          <p className="notice">
            Your profile is encrypted off-chain and is visible to your
            authenticated identity.
          </p>
        </form>
      </Surface>
      <Surface title="Governance & identity keys">
        <form
          className="workflow-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              action === "proposal.approve" &&
              !confirm("Approve this governance proposal?")
            )
              return;
            run(() =>
              command(action, subject, {
                ...([
                  "role.propose",
                  "identity.recover.propose",
                  "identity.rotate.propose",
                ].includes(action)
                  ? { owner: target }
                  : {}),
                ...(action === "role.propose" ? { role } : {}),
                ...(action === "policy.propose"
                  ? { transfer_ttl: transferTTL }
                  : {}),
                ...([
                  "identity.create",
                  "identity.recover.propose",
                  "identity.rotate.propose",
                ].includes(action)
                  ? { certificate_hash: hash }
                  : {}),
              }),
            );
          }}
        >
          <label htmlFor="governance-action">Governance action</label>
          <select
            id="governance-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option>role.propose</option>
            <option>identity.rotate.propose</option>
            {admin && (
              <>
                <option>identity.create</option>
                <option>identity.recover.propose</option>
                <option>proposal.approve</option>
                <option>organization.configure</option>
                <option>policy.propose</option>
              </>
            )}
          </select>
          <label htmlFor="governance-id">Record or proposal ID</label>
          <input
            id="governance-id"
            required
            pattern="[a-zA-Z0-9:._-]{1,120}"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          {[
            "role.propose",
            "identity.recover.propose",
            "identity.rotate.propose",
          ].includes(action) && (
            <>
              <label htmlFor="governance-target">Target DID</label>
              <input
                id="governance-target"
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </>
          )}
          {action === "role.propose" && (
            <>
              <label htmlFor="governance-role">Requested role</label>
              <select
                id="governance-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                {["User", "Manager", "Auditor", "Admin"].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </>
          )}
          {action === "policy.propose" && (
            <>
              <label htmlFor="policy-ttl">
                Transfer expiry (seconds, 60–3600)
              </label>
              <input
                id="policy-ttl"
                type="number"
                min={60}
                max={3600}
                required
                value={transferTTL}
                onChange={(e) => setTransferTTL(Number(e.target.value))}
              />
            </>
          )}
          {[
            "identity.create",
            "identity.recover.propose",
            "identity.rotate.propose",
          ].includes(action) && (
            <>
              <label htmlFor="cert-hash">Enrolled certificate SHA-256</label>
              <input
                id="cert-hash"
                required
                pattern="[a-f0-9]{64}"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
              />
            </>
          )}
          <button className="primary" disabled={busy}>
            Submit for ledger validation
          </button>
          <p className="notice">
            A role or replacement key proposal expires in 15 minutes. A separate
            administrator approves it. Replacement key activation requires proof
            of possession.
          </p>
        </form>
      </Surface>
      <Surface title="Private evidence & credential verification">
        <form
          className="workflow-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            run(async () => {
              const result = await request<
                { id: string; sha256: string } & Operation
              >(`/api/assets/${encodeURIComponent(asset)}/evidence`, {
                method: "POST",
                headers: { "Content-Type": file.type },
                body: file,
              });
              setEvidenceId(result.id);
              await waitOperation(result);
              return `Evidence ${result.id} committed. SHA-256 ${result.sha256}`;
            });
          }}
        >
          <label htmlFor="evidence-asset">Evidence asset ID</label>
          <input
            id="evidence-asset"
            value={asset}
            required
            onChange={(e) => setAsset(e.target.value)}
          />
          <label htmlFor="evidence-file">
            Evidence (PDF, PNG, JPEG; up to 5 MiB)
          </label>
          <input
            id="evidence-file"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            required
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button disabled={busy || !file}>Upload and anchor commitment</button>
        </form>
        <div className="workflow-form">
          <label htmlFor="evidence-id">
            Evidence or credential document ID
          </label>
          <input
            id="evidence-id"
            value={evidenceId}
            onChange={(e) => setEvidenceId(e.target.value)}
          />
          <button
            disabled={busy || !evidenceId}
            onClick={() =>
              run(async () => {
                await download(
                  `/api/evidence/${encodeURIComponent(evidenceId)}`,
                );
                return "Integrity checked; download started.";
              })
            }
          >
            Retrieve verified bytes
          </button>
          <label htmlFor="signed-vc">Signed credential JWT</label>
          <textarea
            id="signed-vc"
            value={signed}
            onChange={(e) => setSigned(e.target.value)}
          />
          <button
            disabled={busy || !signed}
            onClick={() =>
              run(() =>
                request("/api/credentials/verify", {
                  method: "POST",
                  body: JSON.stringify({ credential: signed }),
                }),
              )
            }
          >
            Verify signature and ledger status
          </button>
        </div>
      </Surface>
      <Surface title="Operations & notifications">
        <div className="workflow-form">
          <label htmlFor="operation-id">Operation ID</label>
          <input
            id="operation-id"
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
          />
          <button
            disabled={busy || !operation}
            onClick={() =>
              run(() =>
                request(`/api/operations/${encodeURIComponent(operation)}`),
              )
            }
          >
            Inspect transaction outcome
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const n = await request<typeof notices>("/api/notifications");
                setNotices(n);
                return `${n.length} notifications loaded`;
              })
            }
          >
            Refresh notifications
          </button>
          <ul>
            {notices.map((n) => (
              <li key={n.id}>
                {n.action} · {n.subject}
              </li>
            ))}
          </ul>
        </div>
      </Surface>
      {(message || error) && (
        <Surface title="Operation result">
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : (
            <p role="status" className="success hash">
              {message}
            </p>
          )}
        </Surface>
      )}
    </div>
  );
}
