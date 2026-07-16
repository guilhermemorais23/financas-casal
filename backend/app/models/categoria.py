from sqlalchemy import Colum,Integer,String,ForeignKey

from ..database import Base

class CategoriaMode(Base):
    __tablename__ = "categorias"

    id = Colum(Integer,primary_key=True,index=True)
    nome = Colum(String, nullable=False)
    pai_id= Colum(Integer, ForeignKey("categorias.id"),nullable = True)
