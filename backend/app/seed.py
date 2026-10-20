from .models import Record

PERSONAS = {
    "admin": ("Org1MSP", "Admin"),
    "manager": ("Org1MSP", "Manager"),
    "auditor": ("Org1MSP", "Auditor"),
    "user": ("Org1MSP", "User"),
    "recipient": ("Org1MSP", "User"),
    "org2admin": ("Org2MSP", "Admin"),
}


def seed(db):
    for name, (org, role) in PERSONAS.items():
        did = f"did:aegis:{name}"
        if not db.get(Record, did):
            db.add(
                Record(
                    id=did,
                    org=org,
                    kind="identity",
                    body={"did": did, "status": "active", "roles": [role], "binding": "demo-only"},
                )
            )
    db.commit()
