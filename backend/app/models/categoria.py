from sqlalchemy import Column,Integer,String,ForeignKey,DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from ..database import Base


class CategoriaModel(Base):
    __tablename__ = "categorias"

    id = Column(Integer,primary_key=True,index=True)
    nome = Column(String, nullable=False)
    pai_id= Column(Integer, ForeignKey("categorias.id"),nullable = True)
    transacoes = relationship("TransacaoModel", back_populates ="categoria")
    criado_em = Column(DateTime(timezone=True), server_default=func.now(),nullable=False)