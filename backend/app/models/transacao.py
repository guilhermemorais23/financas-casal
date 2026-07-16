from sqlalchemy import Column,Integer,String,ForeignKey,Float

from sqlalchemy.orm import relationship
from ..database import Base



class TransacaoModel(Base):
    __tablename__ = "transacoes"

    id = Column(Integer, primary_key=True, index=True)
    descricao = Column(String, nullable=False)
    valor = Column(Float, nullable=False)
    tipo = Column(String, nullable=False)
    categoria_id = Column(Integer, ForeignKey("categorias.id"), nullable=False)

    categoria= relationship("CategoriaModel")