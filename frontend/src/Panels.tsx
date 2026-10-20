import { Surface } from "./components";
import { request, type AuditEvent } from "./api";
export function HealthPanel({
  health,
  setMessage,
  setError,
}: {
  health: string;
  setMessage: (s: string) => void;
  setError: (s: string) => void;
}) {
  return (
    <Surface title="Service readiness">
      <dl className="details">
        <div>
          <dt>Application API</dt>
          <dd>{health}</dd>
        </div>
        <div>
          <dt>Ledger</dt>
          <dd>
            Inspect dependency readiness below for the configured environment.
          </dd>
        </div>
        <div>
          <dt>Production readiness</dt>
          <dd>
            Readiness verifies configured dependencies; it does not certify
            operational deployment.
          </dd>
        </div>
        <div>
          <dt>Local data</dt>
          <dd>PostgreSQL in production; isolated SQLite in demo.</dd>
        </div>
      </dl>
      <button
        onClick={() =>
          request<{ ready: boolean }>("/health/ready")
            .then((r) => setMessage(JSON.stringify(r)))
            .catch((e) => setError(String(e)))
        }
      >
        Check readiness
      </button>
    </Surface>
  );
}
export function AuditPanel({ events }: { events: AuditEvent[] }) {
  return (
    <Surface title="Security audit" aside={<span>{events.length} events</span>}>
      <div className="audit-table">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Actor</th>
              <th>Outcome</th>
              <th>Subject</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.sequence}>
                <td>{e.action}</td>
                <td>{e.actor.split(":").at(-1)}</td>
                <td>
                  <span className={`status ${e.outcome}`}>{e.outcome}</span>
                </td>
                <td>{e.subject}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && (
          <p className="empty">
            No audit events. Run an operation to see its outcome.
          </p>
        )}
      </div>
    </Surface>
  );
}
export function VerificationPanel({
  subject,
  setSubject,
  hash,
  setHash,
  busy,
  verify,
}: {
  subject: string;
  setSubject: (s: string) => void;
  hash: string;
  setHash: (s: string) => void;
  busy: boolean;
  verify: () => void;
}) {
  return (
    <Surface title="Check an asset commitment">
      <div className="verification-form">
        <label htmlFor="verify-id">Asset ID</label>
        <input
          id="verify-id"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="demo-asset"
        />
        <label htmlFor="verify-hash">Metadata SHA-256</label>
        <input
          id="verify-hash"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
        />
        <button
          className="primary"
          onClick={verify}
          disabled={busy || !subject || !/^[a-f0-9]{64}$/.test(hash)}
        >
          Verify commitment
        </button>
        <p className="notice">
          Checks the commitment, asset state and current owner status using the
          configured environment. A matching hash does not establish identity,
          authenticity or the truth of metadata.
        </p>
      </div>
    </Surface>
  );
}
