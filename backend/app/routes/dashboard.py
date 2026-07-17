from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from datetime import datetime
from ..database import get_db
from ..models.transacao import TransacaoModel
from ..schemas.dashboard import ResumoFinanceiroSchema

router = APIRouter(
    prefix="/dashboard",
    tags=["dashboard"]
)

@router.get("/", response_model=ResumoFinanceiroSchema)
def obter_resumo_financeiro(
    mes: int = None,
    ano: int= None,
    db:Session = Depends(get_db)
    ):

    mes_atual = mes or datetime.now().month
    ano_atual = mes or datetime.now().year
    
    total_entradas = db.query(func.sum(TransacaoModel.valor))\
    .filter(TransacaoModel.tipo =="entrada")\
    .filter(extract('month', TransacaoModel.criado_em) == mes_atual)\
    .filter(extract('year', TransacaoModel.criado_em) == ano_atual)\
    .scalar( ) or 0.0

    total_saida = db.query(func.sum(TransacaoModel.valor))\
    .filter(TransacaoModel.tipo =="saida")\
    .filter(extract('month', TransacaoModel.criado_em) == mes_atual)\
    .filter(extract('year', TransacaoModel.criado_em)== ano_atual)\
    .scalar() or 0.0

    saldo_atual= total_entradas - total_saida

    return{
        "total_entradas": total_entradas,
        "total_saidas": total_saida,
        "saldo_atual": saldo_atual
    }

