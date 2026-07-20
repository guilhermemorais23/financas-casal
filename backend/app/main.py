from fastapi import FastAPI



from app.routes import transacao, categorias,dashboard
from fastapi.middleware.cors import CORSMiddleware


from app.database import engine,Base, get_db
import app.models as models



app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],  # Permite GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],
)



app.include_router(categorias.router)
app.include_router(dashboard.router)
app.include_router(transacao.router)



Base.metadata.create_all(bind=engine)


