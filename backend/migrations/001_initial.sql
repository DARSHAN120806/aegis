-- Operational projection schema only. Does not make production mode ready.
BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE records (id VARCHAR(160) PRIMARY KEY, org VARCHAR(80) NOT NULL, kind VARCHAR(40) NOT NULL, body JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX records_org_kind ON records(org,kind);
CREATE TABLE events (sequence BIGSERIAL PRIMARY KEY, org VARCHAR(80) NOT NULL, actor VARCHAR(160) NOT NULL, action VARCHAR(80) NOT NULL, subject VARCHAR(160) NOT NULL, outcome VARCHAR(40) NOT NULL, correlation VARCHAR(80) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), source VARCHAR(20) NOT NULL);
CREATE INDEX events_org_sequence ON events(org,sequence);
CREATE TABLE idempotency (id BIGSERIAL PRIMARY KEY, actor VARCHAR(160) NOT NULL, key VARCHAR(80) NOT NULL, digest VARCHAR(64) NOT NULL, response JSONB NOT NULL, UNIQUE(actor,key));
INSERT INTO schema_migrations(version) VALUES (1);
COMMIT;
