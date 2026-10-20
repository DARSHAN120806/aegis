BEGIN;
CREATE TABLE operations (id VARCHAR(64) PRIMARY KEY, actor VARCHAR(160) NOT NULL, org VARCHAR(80) NOT NULL,
 key VARCHAR(80) NOT NULL, digest VARCHAR(64) NOT NULL, command JSONB NOT NULL,
 status VARCHAR(32) NOT NULL DEFAULT 'queued', prepared JSONB, result JSONB, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(actor,key));
CREATE INDEX operations_pending ON operations(status,created_at);
CREATE INDEX operations_org ON operations(org);
CREATE TABLE ledger_receipts (tx VARCHAR(128) PRIMARY KEY, block VARCHAR(40) NOT NULL, body JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE checkpoints (id VARCHAR(80) PRIMARY KEY, block VARCHAR(40) NOT NULL DEFAULT '0', tx VARCHAR(128));
CREATE TABLE evidence (id VARCHAR(64) PRIMARY KEY, org VARCHAR(80) NOT NULL, actor VARCHAR(160) NOT NULL,
 asset VARCHAR(160) NOT NULL, digest VARCHAR(64) NOT NULL, object_key VARCHAR(400) NOT NULL UNIQUE,
 content_type VARCHAR(80) NOT NULL, size INTEGER NOT NULL CHECK(size>0), created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX evidence_org_asset ON evidence(org,asset);
CREATE TABLE notifications (id VARCHAR(200) PRIMARY KEY, org VARCHAR(80) NOT NULL, actor VARCHAR(160) NOT NULL,
 body JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX notifications_actor ON notifications(org,actor,created_at);
CREATE TABLE profiles (id VARCHAR(160) PRIMARY KEY, org VARCHAR(80) NOT NULL, encrypted JSONB NOT NULL);
CREATE INDEX profiles_org ON profiles(org);
-- Defense in depth: even a privileged application bug cannot UPDATE/DELETE audit rows.
CREATE FUNCTION aegis_no_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit rows are append only'; END $$;
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION aegis_no_audit_mutation();
CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON ledger_receipts FOR EACH ROW EXECUTE FUNCTION aegis_no_audit_mutation();
INSERT INTO schema_migrations(version) VALUES(2);
COMMIT;
