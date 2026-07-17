from fastapi import APIRouter, Depends,HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from ..schemas.transacao import TransacaoCreateSchema, TransacaoDisplaySchemas
from .. models.transacao import TransacaoModel
from ..database import get_db


router = APIRouter(
    prefix="/transacoes",
    tags=["transacoes"]
)

@router.post("/",response_model=TransacaoDisplaySchemas)
def criar_transacao(transacao_input: TransacaoCreateSchema, db:Session = Depends(get_db)):
    nova_transacao = TransacaoModel(
        descricao = transacao_input.descricao,
        valor = transacao_input.valor,
        tipo = transacao_input.tipo,
        categoria_id = transacao_input.categoria_id
    )

    db.add(nova_transacao)
    db.commit()
    db.refresh(nova_transacao)

    return nova_transacao


@router.get("/", response_model=List[TransacaoCreateSchema])
def listar_transacoes(db:Session = Depends(get_db)):
    transacoes = db.query(TransacaoModel).all()
    return transacoes

@router.delete("/{transacao_id}")
def deletar_transacao(transacao_id:int, db:Session = Depends(get_db)):
    transacao = db.query(TransacaoModel).filter(TransacaoModel.id == transacao_id).first()

    if not transacao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transacao nao encontrada "
        )
    
    db.delete(transacao)
    db.commit()
    
    return {
        "mensagem": f"A transacao {transacao_id} foi deletada com sucesso"

    }

@router.put("/{transacao_id}")
def atualizar_transacao(transacao_id:int, novos_dados:TransacaoCreateSchema,db: Session = Depends(get_db)):
    transacao = db.query(TransacaoModel).filter(TransacaoModel.id == transacao_id).first()

    if not transacao:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="A transacao nao foi encontrada"
        )
    
    transacao.valor = novos_dados.valor
    transacao.descricao = novos_dados.descricao
    transacao.tipo = novos_dados.tipo
    transacao.categoria_id = novos_dados.categoria_id
    
    
    db.commit()
    db.refresh(transacao)
    
    return {
        "mensagem": "Transação atualizada com sucesso!",
        "dados": transacao
    }
