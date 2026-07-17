from pydantic import BaseModel,Field
from typing import Optional
from .categorias import CategoriaDisplaySchema


class TransacaoCreateSchema(BaseModel):
    valor: float = Field(...,gt=0)
    descricao: str
    tipo:str
    categoria_id: int

    
    
class TransacaoDisplaySchemas(BaseModel):

    id: int
    descricao: str
    valor: float
    tipo: str
    categoria_id: int

    categoria: Optional[CategoriaDisplaySchema] = None



    class Config:
        from_attributes = True