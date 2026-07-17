from pydantic import BaseModel

class ResumoFinanceiroSchema(BaseModel):
    total_entradas: float
    total_saidas: float
    saldo_atual: float

    class Config:
        from_attributes = True