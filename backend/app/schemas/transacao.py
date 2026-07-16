from pydantic import BaseModel
from typing import Optional

class TransacaoModel(BaseModel):
    valor: float
    descricao: str
    tipo:str
    categoria_id: int

    
    
    class Config:
        from_attributes = True