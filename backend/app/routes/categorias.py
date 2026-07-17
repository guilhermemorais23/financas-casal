from fastapi import APIRouter, Depends,HTTPException, status
from sqlalchemy.orm import Session
from typing import List

# Importando nossos tradutores (Schemas) e nossas tabelas (Models)
from ..schemas.categorias import CategoriaCreateSchema,CategoriaDisplaySchema
from ..models.categoria import CategoriaModel
from ..database import get_db

# Criando o nosso roteador
router = APIRouter(
    prefix="/categorias",  # Todas as rotas daqui começam com /categorias
    tags=["Categorias"]    # Organização na documentação do Swagger
)

# ROTA 1: CRIAR UMA NOVA CATEGORIA
@router.post("/", response_model=CategoriaCreateSchema)
def criar_categoria(categoria_input: CategoriaCreateSchema, db: Session = Depends(get_db)):
    # Criamos o objeto do banco de dados com as informações enviadas pelo usuário
    nova_categoria = CategoriaModel(
        nome=categoria_input.nome,
        pai_id=categoria_input.pai_id
    )
    
    # Salvamos no banco de dados
    db.add(nova_categoria)
    db.commit()
    db.refresh(nova_categoria)
    
    return nova_categoria


# ROTA 2: LISTAR TODAS AS CATEGORIAS
@router.get("/", response_model=List[CategoriaDisplaySchema])
def listar_categorias(db: Session = Depends(get_db)):
    # Buscamos todos os registros da tabela "categorias"
    categorias = db.query(CategoriaModel).all()
    return categorias

@router.delete("/{categoria_id}")
def deletar_categoria(categoria_id: int, db:Session =Depends(get_db)):
    categoria = db.query(CategoriaModel).filter(CategoriaModel.id== categoria_id).first()

    if not categoria:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoria nao encontrada"
        )
    
    db.delete(categoria)
    db.commit()

    return{
        "mensagem": f"A categoria {categoria_id} foi deletada com sucesso"
    }

@router.put("/{categoria_id}")
def atualizar_categoria(categoria_id:int,dados_novos: CategoriaCreateSchema, db:Session = Depends(get_db)):
    categoria = db.query(CategoriaModel).filter(CategoriaModel.id ==categoria_id).first()

    if not categoria:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoria nao encontrada"
        )
    
    categoria.nome = dados_novos.nome
    categoria.pai_id = dados_novos.pai_id

    db.commit()
    db.refresh(categoria)

    return{
        "mensagem": f"A categoria {categoria} foi edita com sucesso"

    }