from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .config import settings
from .models import Base


def build_database(config):
    engine = create_engine(
        config.database_url,
        pool_pre_ping=True,
        connect_args={"check_same_thread": False} if config.database_url.startswith("sqlite") else {},
    )
    return engine, sessionmaker(engine, expire_on_commit=False)


engine, Session = build_database(settings())


def initialize_demo():
    if settings().mode == "demo":
        Base.metadata.create_all(engine)


def session():
    with Session() as db:
        yield db
