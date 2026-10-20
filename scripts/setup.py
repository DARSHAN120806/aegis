#!/usr/bin/env python3
"""Generate private local config once; never print generated secrets."""
from pathlib import Path
import os
import secrets
root = Path(__file__).resolve().parents[1]
env = root / ".env"
if env.exists():
    print("Existing .env preserved")
else:
    content = (root / ".env.example").read_text().replace("REPLACE_WITH_RANDOM_64_HEX_CHARACTERS", secrets.token_hex(32)).replace("REPLACE_WITH_RANDOM_VALUE", secrets.token_hex(24), 1).replace("REPLACE_WITH_RANDOM_VALUE", secrets.token_hex(24), 1)
    descriptor = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as file:
        file.write(content)
    print("Local configuration generated; secrets omitted from output")
