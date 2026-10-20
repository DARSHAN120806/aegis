from functools import lru_cache
from urllib.parse import parse_qs, urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AEGIS_", env_file=".env", extra="ignore", hide_input_in_errors=True
    )
    mode: str = "production"
    signing_secret: str = Field(default="", repr=False)
    database_url: str = "sqlite:///./aegis-demo.db"
    allowed_origins: list[str] = ["http://localhost:5173"]
    token_minutes: int = Field(default=15, ge=1, le=60)
    redis_url: str = Field(default="", repr=False)
    fabric_url: str = ""
    fabric_token: str = Field(default="", repr=False)
    fabric_ca_bundle: str | bool = True
    s3_endpoint: str = ""
    s3_region: str = "us-east-1"
    s3_bucket: str = "aegis-evidence"
    s3_access_key: str = Field(default="", repr=False)
    s3_secret_key: str = Field(default="", repr=False)
    s3_kms_key: str = ""
    upload_max_bytes: int = Field(default=5_242_880, ge=1, le=20_971_520)
    credential_private_key: str = Field(default="", repr=False)
    credential_key_id: str = ""
    credential_public_keys: dict[str, str] = {}
    profile_encryption_key: str = Field(default="", repr=False)
    malware_host: str = ""
    malware_port: int = Field(default=3310, ge=1, le=65535)

    @model_validator(mode="after")
    def validate_mode(self):
        if self.mode not in {"demo", "production"}:
            raise ValueError("mode must be demo or production")
        if len(self.signing_secret) < 32 or self.signing_secret.startswith("REPLACE_"):
            raise ValueError("AEGIS_SIGNING_SECRET must be at least 32 characters")
        if self.mode == "production" and not self.database_url.startswith("postgresql+psycopg://"):
            raise ValueError("Production requires PostgreSQL; no SQLite fallback")
        if "*" in self.allowed_origins:
            raise ValueError("Wildcard CORS is prohibited")
        if self.mode == "production":
            if not self.malware_host:
                raise ValueError("Production requires a malware scanning service")
            if len(self.profile_encryption_key) != 64:
                raise ValueError("Production profile encryption requires a 32-byte hex key")
            try:
                if len(bytes.fromhex(self.profile_encryption_key)) != 32:
                    raise ValueError("Profile key length invalid")
            except ValueError:
                raise ValueError("Profile encryption key must be hex") from None
            if not self.redis_url.startswith("rediss://"):
                raise ValueError("Production requires authenticated TLS Redis")
            redis = urlsplit(self.redis_url)
            if not redis.password or parse_qs(redis.query).get("ssl_cert_reqs", ["required"])[0] in {
                "none",
                "0",
            }:
                raise ValueError("Production Redis requires a password and certificate verification")
            if parse_qs(urlsplit(self.database_url).query).get("sslmode") != ["verify-full"]:
                raise ValueError("Production PostgreSQL requires sslmode=verify-full")
            if not self.fabric_url.startswith("https://") or len(self.fabric_token) < 32:
                raise ValueError("Production requires HTTPS Fabric bridge and service token")
            if not self.s3_endpoint.startswith("https://") or not self.s3_kms_key:
                raise ValueError("Production requires HTTPS S3 and a KMS key")
            if not self.credential_private_key or not self.credential_key_id:
                raise ValueError("Production requires a credential signing key and key ID")
            if self.credential_key_id not in self.credential_public_keys:
                raise ValueError("Current credential key ID must be present in verifier key map")
            if not self.allowed_origins or any(not v.startswith("https://") for v in self.allowed_origins):
                raise ValueError("Production CORS origins must use HTTPS")
            if self.fabric_ca_bundle is False:
                raise ValueError("TLS verification cannot be disabled")
        return self


@lru_cache
def settings():
    return Settings()
