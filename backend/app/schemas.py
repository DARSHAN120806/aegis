from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Login(Strict):
    persona: Literal["admin", "manager", "auditor", "user", "recipient", "org2admin"]


class Command(Strict):
    action: Literal[
        "identity.create",
        "identity.suspend",
        "identity.revoke",
        "credential.issue",
        "credential.revoke",
        "asset.mint",
        "asset.assign",
        "asset.transfer.request",
        "asset.transfer.approve",
        "asset.transfer.accept",
        "asset.transfer.cancel",
        "role.propose",
        "proposal.approve",
        "identity.recover.propose",
        "identity.rotate.propose",
        "organization.configure",
        "evidence.attach",
        "policy.propose",
        "asset.archive",
    ]
    subject: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9:._-]+$")
    owner: str | None = Field(default=None, max_length=120, pattern=r"^[a-zA-Z0-9:._-]+$")
    metadata_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    certificate_hash: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    role: Literal["Admin", "Manager", "Auditor", "User"] | None = None
    transfer_ttl: int | None = Field(default=None, ge=60, le=3600)


class Verify(Strict):
    metadata_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
