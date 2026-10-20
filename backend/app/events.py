from .config import settings
from .models import Event


def audit(db, user, action, subject, outcome, correlation):
    db.add(
        Event(
            org=user.org,
            actor=user.id,
            action=action,
            subject=subject,
            outcome=outcome,
            correlation=correlation,
            source="fabric" if settings().mode == "production" else "simulation",
        )
    )


def event_dict(event):
    return {
        "sequence": event.sequence,
        "action": event.action,
        "actor": event.actor,
        "subject": event.subject,
        "outcome": event.outcome,
        "time": event.created_at.isoformat(),
        "source": event.source,
        "correlation": event.correlation,
    }
