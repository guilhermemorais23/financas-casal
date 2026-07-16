from pydantic import BaseModel
from typing import Optional

class CategoriaSchema(BaseModel):
    nome:str
    pai_id: Optional[int] = None

    class Config:
        from_attributes = True
        