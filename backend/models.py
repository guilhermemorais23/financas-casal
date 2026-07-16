from sqlalchemy import Column, Integer, String,Float, ForeignKey
from database import Base

class CategoriaModel(Base):
    __tablename__= "categorias"

    id = Column(Integer, primary_key=True,index=True)
    nome = Column(String,nullable=False)

    pai_id= Column(Integer,ForeignKey("categorias.id"),nullable=True)

class TransacaoModel(Base):
    __tablename__ = "transacoes"

    id = Column(Integer,primary_key=True, index=True)
    descricao = Column(String, nullable=True)
    valor = Column(Float,nullable= False)
    tipo = Column(String,nullable=False)
    categoria_id = Column(ForeignKey("categorias.id"),nullable=False)