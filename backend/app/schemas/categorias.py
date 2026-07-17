from pydantic import BaseModel
from typing import Optional

class CategoriaCreateSchema(BaseModel):
    nome:str
    pai_id: Optional[int] = None

    class Config:
        from_attributes = True

class CategoriaDisplaySchema(BaseModel):
    id: int
    nome:str
    pai_id:Optional[int] = None

    class Config:
        from_attributes = True
        