from fastapi import FastAPI, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from app.routes import transacao, categorias,dashboard


from app.database import engine,Base, get_db
import app.models as models


app = FastAPI()

app.include_router(categorias.router)
app.include_router(dashboard.router)
app.include_router(transacao.router)



Base.metadata.create_all(bind=engine)


