from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.event import listen

SQLALCHEMY_DATABASE_URL = "sqlite:///../controle_gastos.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
      connect_args={"check_same_thread": False}
)

def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreing_keys=ON")
    cursor.close()

listen(engine, "connect", _set_sqlite_pragma)

SessionLocal = sessionmaker(autocommit=False,autoflush=False,bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        # Força o SQLite a ligar a trava diretamente nesta sessão atual!
        db.execute(text("PRAGMA foreign_keys=ON")) 
        yield db
    finally:
        db.close()