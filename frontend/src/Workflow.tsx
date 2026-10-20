type Props = {
  admin: boolean;
  manager: boolean;
  user: boolean;
  action: string;
  setAction: (s: string) => void;
  subject: string;
  setSubject: (s: string) => void;
  owner: string;
  setOwner: (s: string) => void;
  hash: string;
  setHash: (s: string) => void;
  busy: boolean;
  submit: (e: React.FormEvent) => void;
};
export default function Workflow({
  admin,
  manager,
  user,
  action,
  setAction,
  subject,
  setSubject,
  owner,
  setOwner,
  hash,
  setHash,
  busy,
  submit,
}: Props) {
  return (
    <form onSubmit={submit} className="workflow-form">
      <label htmlFor="action">Operation</label>
      <select
        id="action"
        value={action}
        onChange={(e) => setAction(e.target.value)}
      >
        {(admin
          ? ["identity.create", "identity.suspend", "identity.revoke"]
          : []
        )
          .concat(
            manager
              ? [
                  "credential.issue",
                  "credential.revoke",
                  "asset.mint",
                  "asset.assign",
                  "asset.transfer.approve",
                  "asset.archive",
                ]
              : [],
          )
          .concat(
            user || manager
              ? [
                  "asset.transfer.request",
                  "asset.transfer.accept",
                  "asset.transfer.cancel",
                ]
              : [],
          )
          .map((a) => (
            <option key={a}>{a}</option>
          ))}
      </select>
      {!manager && !user ? (
        <p className="notice">
          Your role has read access. Select an asset and open Provenance to
          investigate.
        </p>
      ) : (
        <>
          <label htmlFor="subject">Record ID</label>
          <input
            id="subject"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="asset-001 or did:aegis:alice"
          />
          {[
            "asset.assign",
            "asset.transfer.request",
            "credential.issue",
          ].includes(action) && (
            <>
              <label htmlFor="owner">Recipient identity</label>
              <input
                id="owner"
                required
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              />
            </>
          )}
          {["asset.mint", "credential.issue"].includes(action) && (
            <>
              <label htmlFor="hash">Metadata / credential SHA-256</label>
              <input
                id="hash"
                required
                pattern="[a-f0-9]{64}"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
              />
            </>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Processing…" : "Submit operation"}
          </button>
          <p className="notice">
            Every operation is authorized by the API. Production changes wait
            for a confirmed ledger commit. Transfers need recipient acceptance
            and an independent approver.
          </p>
        </>
      )}
    </form>
  );
}
