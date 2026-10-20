import type { ReactNode } from "react";
import type { RecordItem } from "./api";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
export function Surface({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="surface">
      <header className="section-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
export function Registry({
  items,
  onSelect,
  selected,
}: {
  items: RecordItem[];
  onSelect: (item: RecordItem) => void;
  selected?: string;
}) {
  return items.length ? (
    <div className="registry" role="list">
      {items.map((item) => (
        <button
          className={`registry-row ${selected === item.id ? "selected" : ""}`}
          key={item.id}
          onClick={() => onSelect(item)}
          role="listitem"
        >
          <span className="record-monogram">
            {item.id.split(":").at(-1)?.slice(0, 2).toUpperCase()}
          </span>
          <span className="record-main">
            <strong>{item.id}</strong>
            <small>
              {item.body.owner ||
                item.body.roles?.join(", ") ||
                item.body.issuer ||
                item.org}
            </small>
          </span>
          <span className={`status ${item.body.status}`}>
            {item.body.status}
          </span>
        </button>
      ))}
    </div>
  ) : (
    <p className="empty">
      No records yet. Start a workflow or run a jury scenario.
    </p>
  );
}
export function Timeline({ item }: { item: RecordItem | null }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    let active = true;
    setQr("");
    if (item) {
      const url = new URL(window.location.origin);
      url.searchParams.set("asset", item.id);
      QRCode.toDataURL(url.toString(), {
        width: 180,
        margin: 2,
        errorCorrectionLevel: "M",
      })
        .then((data) => {
          if (active) setQr(data);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [item?.id]);
  return item ? (
    <>
      <dl className="details">
        <div>
          <dt>Asset</dt>
          <dd>{item.id}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{item.body.owner || "Unassigned"}</dd>
        </div>
        <div>
          <dt>Metadata SHA-256</dt>
          <dd className="hash">{item.body.metadata_hash}</dd>
        </div>
      </dl>
      <div className="relationship-map" aria-label="Asset relationships">
        <span>Issuer: {item.body.issuer || "Unknown"}</span>
        <span aria-hidden="true">→</span>
        <strong>{item.id}</strong>
        <span aria-hidden="true">→</span>
        <span>Owner: {item.body.owner || "Unassigned"}</span>
      </div>
      {qr && (
        <figure className="verification-qr">
          <img
            src={qr}
            alt={`QR link to authenticated verification for ${item.id}`}
            width="180"
            height="180"
          />
          <figcaption>
            Scan to open verification. Authentication and original evidence are
            still required.
          </figcaption>
        </figure>
      )}
      <ol className="timeline">
        {item.body.history?.map((entry, index) => (
          <li key={index}>
            <span className="timeline-point" />
            <div>
              <strong>
                {entry.action.replace("asset.", "").replaceAll(".", " ")}
              </strong>
              <p>{entry.actor}</p>
              <small>
                {entry.owner || "Unassigned"} ·{" "}
                {new Date(entry.time).toLocaleTimeString()}
              </small>
            </div>
          </li>
        ))}
      </ol>
    </>
  ) : (
    <p className="empty">Select an asset to inspect its ownership history.</p>
  );
}
