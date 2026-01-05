from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.sql import func
from database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True) # Telegram ID
    username = Column(String, nullable=True)
    balance = Column(Float, default=10000.0) # Даем 10к на старт
    registered_at = Column(DateTime(timezone=True), server_default=func.now())

class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    amount = Column(Float) # + выиграл, - проиграл
    game_type = Column(String) # 'mines', 'crash'
    created_at = Column(DateTime(timezone=True), server_default=func.now())
