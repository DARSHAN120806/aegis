import { HealthPanel, AuditPanel, VerificationPanel } from "./Panels";
import LoginScreen from "./LoginScreen";
import Workflow from "./Workflow";
import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  Fingerprint,
  Layers,
  GitBranch,
  ScanLine,
  ScrollText,
  Activity,
  FlaskConical,
  LogOut,
} from "lucide-react";
import {
  command,
  login,
  loginWithKey,
  logout,
  request,
  type AuditEvent,
  type Me,
  type Persona,
  type RecordItem,
} from "./api";
import { Registry, Surface, Timeline } from "./components";
import DemoCenter from "./DemoCenter";
import SecurityDesk from "./SecurityDesk";
import { waitOperation, type Operation } from "./api";
type Page =
  | "Identities"
  | "Credentials"
  | "Assets"
  | "Provenance"
  | "Verification"
  | "Audit"
  | "Health"
  | "Jury Demo";
type WorkspacePage = Page | "Security desk" | "Proposals" | "Organizations";
const nav: { name: Page; icon: typeof Fingerprint }[] = [
  { name: "Identities", icon: Fingerprint },
  { name: "Credentials", icon: ShieldCheck },
  { name: "Assets", icon: Layers },
  { name: "Provenance", icon: GitBranch },
  { name: "Verification", icon: ScanLine },
  { name: "Audit", icon: ScrollText },
  { name: "Health", icon: Activity },
  { name: "Jury Demo", icon: FlaskConical },
];
export default function App() {
  const [me, setMe] = useState<Me | null>(null),
    [persona, setPersona] = useState<Persona>("admin"),
    [page, setPage] = useState<WorkspacePage>(
      new URLSearchParams(location.search).has("asset")
        ? "Verification"
        : "Assets",
    ),
    [identities, setIdentities] = useState<RecordItem[]>([]),
    [credentials, setCredentials] = useState<RecordItem[]>([]),
    [assets, setAssets] = useState<RecordItem[]>([]),
    [events, setEvents] = useState<AuditEvent[]>([]),
    [selected, setSelected] = useState<RecordItem | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [subject, setSubject] = useState(
      new URLSearchParams(location.search).get("asset") || "",
    ),
    [owner, setOwner] = useState("did:aegis:user"),
    [hash, setHash] = useState("a".repeat(64)),
    [action, setAction] = useState("asset.mint"),
    [health, setHealth] = useState("Checking");
  const [mode, setMode] = useState("unknown");
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [query, setQuery] = useState(""),
    [proposals, setProposals] = useState<RecordItem[]>([]),
    [organizations, setOrganizations] = useState<RecordItem[]>([]);
  const refresh = useCallback(async () => {
    const user = await request<Me>("/api/me");
    setMe(user);
    setSummary(
      (await request<{ records: Record<string, number> }>("/api/dashboard"))
        .records,
    );
    if (user.roles.includes("User")) setAction("asset.transfer.request");
    const [i, c, a] = await Promise.all([
      request<RecordItem[]>(
        `/api/records/identity?q=${encodeURIComponent(query)}`,
      ),
      request<RecordItem[]>(
        `/api/records/credential?q=${encodeURIComponent(query)}`,
      ),
      request<RecordItem[]>(
        `/api/records/asset?q=${encodeURIComponent(query)}`,
      ),
    ]);
    setIdentities(i);
    setCredentials(c);
    setAssets(a);
    if (user.mode === "production") {
      setProposals(await request<RecordItem[]>("/api/records/proposal"));
      setOrganizations(
        await request<RecordItem[]>("/api/records/organization"),
      );
    }
    setSelected((old) => (old ? a.find((x) => x.id === old.id) || null : null));
    if (user.roles.some((r) => r === "Admin" || r === "Auditor"))
      setEvents(await request<AuditEvent[]>("/api/audit"));
    else setEvents([]);
  }, [query]);
  useEffect(() => {
    request<{ mode: string }>("/health/live")
      .then((r) => {
        setMode(r.mode);
        if (r.mode === "production") {
          setHash("");
          setOwner("");
        }
        setHealth(
          r.mode === "demo"
            ? "Demo API available"
            : "Production API available; check dependency readiness",
        );
      })
      .catch(() => setHealth("API unavailable"));
  }, []);
  useEffect(() => {
    if (!me) return;
    refresh().catch((e) => setError(String(e)));
  }, [me?.id, refresh]);
  async function signIn(credentials?: {
    did: string;
    key: string;
    activate: boolean;
  }) {
    setBusy(true);
    setError("");
    try {
      if (credentials)
        await loginWithKey(
          credentials.did,
          credentials.key,
          credentials.activate,
        );
      else await login(persona);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      (action.includes("revoke") ||
        action.includes("suspend") ||
        action.includes("archive") ||
        action === "proposal.approve") &&
      !window.confirm(`Confirm ${action} for ${subject}?`)
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const extra: Record<string, string> = {};
      if (action === "asset.mint" || action === "credential.issue")
        extra.metadata_hash = hash;
      if (
        ["asset.assign", "asset.transfer.request", "credential.issue"].includes(
          action,
        )
      )
        extra.owner = owner;
      if (me?.mode === "production" && action === "credential.issue") {
        const issued = await request<Operation & { credential: string }>(
          "/api/credentials/issue",
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({
              id: subject,
              subject: owner,
              commitment: hash,
            }),
          },
        );
        const url = URL.createObjectURL(
          new Blob([issued.credential], { type: "application/vc+jwt" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "aegis-credential.jwt";
        a.click();
        URL.revokeObjectURL(url);
        await waitOperation(issued);
      } else await command(action, subject, extra);
      await refresh();
      setMessage(
        me?.mode === "demo"
          ? "Operation completed in the demo."
          : "Fabric transaction committed. The event projection will refresh shortly.",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ valid: boolean; matches: boolean }>(
        `/api/assets/${encodeURIComponent(subject)}/verify`,
        { method: "POST", body: JSON.stringify({ metadata_hash: hash }) },
      );
      setMessage(
        result.valid
          ? `Commitment matches; asset and owner are active (${me?.mode}). This does not prove metadata is true.`
          : `Verification failed. Hash match: ${result.matches}. Check asset and identity status.`,
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const admin = me?.roles.includes("Admin"),
    manager = admin || me?.roles.includes("Manager"),
    auditor = admin || me?.roles.includes("Auditor");
  function signOut() {
    request("/api/auth/logout", { method: "POST" }).catch(() => {});
    logout();
    setMe(null);
    setEvents([]);
  }
  if (!me)
    return (
      <LoginScreen
        persona={persona}
        setPersona={setPersona}
        signIn={signIn}
        busy={busy}
        error={error}
        health={health}
        mode={mode}
      />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={28} />
          <strong>AEGIS</strong>
        </div>
        <p className="organization">
          {me.org}
          <span>Identity & ownership</span>
        </p>
        <nav aria-label="Workspace">
          {me.mode === "production" &&
            (
              ["Security desk", "Proposals", "Organizations"] as WorkspacePage[]
            ).map((name) => (
              <button
                key={name}
                aria-current={page === name ? "page" : undefined}
                onClick={() => setPage(name)}
              >
                {name}
              </button>
            ))}
          {nav
            .filter(
              (n) =>
                !(["Audit"].includes(n.name) && !auditor) &&
                !(n.name === "Jury Demo" && (!admin || me.mode !== "demo")),
            )
            .map(({ name, icon: Icon }) => (
              <button
                key={name}
                aria-current={page === name ? "page" : undefined}
                className={page === name ? "active" : ""}
                onClick={() => {
                  setPage(name);
                  setError("");
                  setMessage("");
                }}
              >
                <Icon size={19} />
                {name}
              </button>
            ))}
        </nav>
        <div className="sidebar-footer">
          <span>{me.id.split(":").at(-1)}</span>
          <small>{me.roles.join(", ")}</small>
          <button onClick={signOut}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <button className="mobile-signout" onClick={signOut}>
            Sign out
          </button>
          <span>Organization workspace</span>
          <span className="mode-label">
            {me.mode === "demo"
              ? "SIMULATED · NO LIVE FABRIC"
              : "FABRIC · CERTIFICATE SESSION"}
          </span>
        </header>
        <button
          className="load-more"
          disabled={busy}
          onClick={() => refresh().catch((e) => setError(String(e)))}
        >
          Refresh workspace
        </button>
        <div className="page-head">
          <div>
            <p className="eyebrow">CONTROLLED TRUST</p>
            <h1>
              {page === "Assets"
                ? "Digital assets"
                : page === "Identities"
                  ? "Identity directory"
                  : page}
            </h1>
          </div>
          <p>
            {page === "Assets"
              ? "Ownership is precise. Every change leaves a trace."
              : page === "Jury Demo"
                ? "Repeatable scenarios through the application API."
                : "Organization-scoped records and activity."}
          </p>
        </div>
        <dl
          className="workspace-summary"
          aria-label="Organization record totals"
        >
          {Object.entries(summary).map(([kind, count]) => (
            <div key={kind}>
              <dt>{kind}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              onClick={() => {
                setError("");
                refresh().catch((e) => setError(String(e)));
              }}
            >
              Retry
            </button>
          </div>
        )}
        {message && (
          <div className="success" role="status">
            {message}
          </div>
        )}
        {page === "Security desk" ? (
          <SecurityDesk me={me} onChanged={refresh} />
        ) : page === "Jury Demo" ? (
          <DemoCenter refresh={refresh} onMessage={setMessage} />
        ) : page === "Health" ? (
          <HealthPanel
            health={health}
            setMessage={setMessage}
            setError={setError}
          />
        ) : page === "Audit" ? (
          <AuditPanel events={events} />
        ) : page === "Verification" ? (
          <VerificationPanel
            subject={subject}
            setSubject={setSubject}
            hash={hash}
            setHash={setHash}
            busy={busy}
            verify={verify}
          />
        ) : (
          <div className="work-grid">
            <Surface
              title={
                page === "Identities"
                  ? "Organization identities"
                  : page === "Credentials"
                    ? "Issued commitments"
                    : "Asset registry"
              }
              aside={
                <span>
                  {
                    (page === "Identities"
                      ? identities
                      : page === "Credentials"
                        ? credentials
                        : page === "Proposals"
                          ? proposals
                          : page === "Organizations"
                            ? organizations
                            : assets
                    ).length
                  }{" "}
                  records
                </span>
              }
            >
              <div className="registry-tools">
                <label htmlFor="registry-search">Search record ID</label>
                <input
                  id="registry-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Registry
                items={
                  page === "Identities"
                    ? identities
                    : page === "Credentials"
                      ? credentials
                      : page === "Proposals"
                        ? proposals
                        : page === "Organizations"
                          ? organizations
                          : assets
                }
                onSelect={(item) => {
                  setSelected(item);
                  setSubject(item.id);
                }}
                selected={selected?.id}
              />
              <button
                className="load-more"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const kind =
                      page === "Identities"
                        ? "identity"
                        : page === "Credentials"
                          ? "credential"
                          : page === "Proposals"
                            ? "proposal"
                            : page === "Organizations"
                              ? "organization"
                              : "asset";
                    const current =
                      kind === "identity"
                        ? identities
                        : kind === "credential"
                          ? credentials
                          : kind === "proposal"
                            ? proposals
                            : kind === "organization"
                              ? organizations
                              : assets;
                    const batch = await request<RecordItem[]>(
                      `/api/records/${kind}?after=${encodeURIComponent(current.at(-1)?.id || "")}&q=${encodeURIComponent(query)}`,
                    );
                    const update =
                      kind === "identity"
                        ? setIdentities
                        : kind === "credential"
                          ? setCredentials
                          : kind === "proposal"
                            ? setProposals
                            : kind === "organization"
                              ? setOrganizations
                              : setAssets;
                    update([...current, ...batch]);
                    if (!batch.length) setMessage("No more records.");
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Load next records
              </button>
            </Surface>
            <Surface
              title={page === "Provenance" ? "Ownership timeline" : "Workflow"}
            >
              {page === "Provenance" ? (
                <Timeline item={selected} />
              ) : (
                <Workflow
                  admin={!!admin}
                  manager={!!manager}
                  user={me.roles.includes("User")}
                  action={action}
                  setAction={setAction}
                  subject={subject}
                  setSubject={setSubject}
                  owner={owner}
                  setOwner={setOwner}
                  hash={hash}
                  setHash={setHash}
                  busy={busy}
                  submit={submit}
                />
              )}
            </Surface>
          </div>
        )}
        <footer className="workspace-footer">
          <span>Private organization boundary</span>
          <span>
            {me.mode === "demo"
              ? "Demo records only · No cryptographic identity binding"
              : "Current ledger authorization checked on every request"}
          </span>
        </footer>
      </main>
    </div>
  );
}
