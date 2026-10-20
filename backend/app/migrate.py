"""Ordered, checksum-verified SQL migrations; run with an independent DDL credential."""

import hashlib
from pathlib import Path

from sqlalchemy import create_engine, text

from .config import settings


def main():
    engine = create_engine(settings().database_url)
    root = Path(__file__).resolve().parents[1] / "migrations"
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as db:
        db.execute(text("SELECT pg_advisory_lock(1743240982)"))
        try:
            db.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
                )
            )
            db.execute(
                text(
                    "CREATE TABLE IF NOT EXISTS migration_checksums (version INTEGER PRIMARY KEY, digest TEXT NOT NULL)"
                )
            )
            for path in sorted(root.glob("*.sql")):
                version = int(path.name.split("_")[0])
                sql = path.read_text(encoding="utf-8-sig")
                digest = hashlib.sha256(sql.encode()).hexdigest()
                prior = db.execute(
                    text("SELECT digest FROM migration_checksums WHERE version=:v"), {"v": version}
                ).scalar()
                if prior and prior != digest:
                    raise RuntimeError(f"Migration {version} checksum changed")
                applied = db.execute(
                    text("SELECT version FROM schema_migrations WHERE version=:v"), {"v": version}
                ).scalar()
                if not applied:
                    db.exec_driver_sql(sql)
                if not prior:
                    db.execute(
                        text("INSERT INTO migration_checksums(version,digest) VALUES(:v,:d)"),
                        {"v": version, "d": digest},
                    )
                print(f"Migration {version} verified")
        finally:
            db.execute(text("SELECT pg_advisory_unlock(1743240982)"))


if __name__ == "__main__":
    main()
