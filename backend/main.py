from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from fastapi import Depends

from backend.app.database import engine,Base,get_db
import models

app = FastAPI()

Base.metadata.create_all(bind=engine)

historico_transacaoes = []

class CategoriaSchema(BaseModel):
    nome: str
    pai_id: Optional[int] = None

class TransacaoSchema(BaseModel):
    descricao: str
    valor: float
    tipo: str
    categoria_id: int

@app.get("/")
def ler_raiz():
    return{
        "mensagem": "Api do sistema esta funcionando"
    }

@app.get("/categorias")
def listar_categoria():
    categorias_do_banco = [
        {"id": 1, "nome": "Casa", "pai_id":None},
        {"id": 2, "nome": "Água", "pai_id": 1}
    ]
    return categorias_do_banco

@app.post("/categorias")
def criar_categoria(nova_categoria: CategoriaSchema,db:Session = Depends(get_db)):

    categoria_banco = models.CategoriaModel(
        nome = nova_categoria.nome,
        pai_id = nova_categoria.pai_id
    )
    db.add(categoria_banco)
    db.commit()
    db.refresh(categoria_banco)

    return{
        "mensagem": "Categoria criada com sucesso no banco de dados",
        "dados_salvos":{
            "id": categoria_banco.id,
            "nome": categoria_banco.nome,
            "pai_id": categoria_banco.pai_id
        }
    }

@app.post("/transacao")
def nova_transacao(nova_transacao: TransacaoSchema,db: Session = Depends(get_db)):
    transacao_banco = models.TransacaoModel(
        descricao = nova_transacao.descricao,
        valor = nova_transacao.valor,
        tipo = nova_transacao.tipo,
        categoria_id = nova_transacao.categoria_id
    )

    db.add(transacao_banco)
    db.commit()
    db.refresh(transacao_banco)

@app.get("/transacao")
def listar_transacao():

    return historico_transacaoes
