import hashlib
import hmac
import json
from urllib.parse import unquote
from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
import asyncio
from contextlib import asynccontextmanager

from config import settings # Твой конфиг (как в прошлом примере)
from database import init_db, get_db
from models import User, Transaction
from bot import start_bot, stop_bot

# === Pydantic Models ===
class InitDataSchema(BaseModel):
    initData: str # Строка от Telegram для проверки безопасности

class GameResultSchema(BaseModel):
    initData: str
    game: str
    bet: float
    multiplier: float
    win: bool

# === Lifecycle ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Запускаем бота в фоне
    bot_task = asyncio.create_task(start_bot())
    yield
    await stop_bot()
    bot_task.cancel()

app = FastAPI(lifespan=lifespan)

# Раздаем статику (наш фронтенд)
app.mount("/static", StaticFiles(directory="static"), name="static")

# === SECURITY (Важнейшая часть) ===
def validate_telegram_data(init_data: str, bot_token: str):
    """Проверяем, что запрос реально из Телеграм, а не от хакера"""
    try:
        parsed_data = dict(x.split('=') for x in unquote(init_data).split('&'))
        hash_check = parsed_data.pop('hash')
        data_check_string = '\n'.join(f'{k}={v}' for k, v in sorted(parsed_data.items()))
        
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        
        if calculated_hash != hash_check:
            raise ValueError("Invalid hash")
            
        user_data = json.loads(parsed_data['user'])
        return user_data
    except Exception:
        raise HTTPException(status_code=403, detail="Auth failed")

# === API ENDPOINTS ===

@app.post("/api/login")
async def login(data: InitDataSchema, db: AsyncSession = Depends(get_db)):
    """Авторизация пользователя при входе в Web App"""
    tg_user = validate_telegram_data(data.initData, settings.BOT_TOKEN)
    user_id = tg_user['id']
    
    # Ищем или создаем юзера
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        user = User(id=user_id, username=tg_user.get('username'))
        db.add(user)
        await db.commit()
    
    return {"status": "ok", "balance": user.balance, "username": user.username}

@app.post("/api/game/finish")
async def finish_game(data: GameResultSchema, db: AsyncSession = Depends(get_db)):
    """Обработка результата игры (списание/начисление)"""
    # 1. Валидация
    tg_user = validate_telegram_data(data.initData, settings.BOT_TOKEN)
    user_id = tg_user['id']
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # 2. Логика денег
    profit = 0
    if data.win:
        win_amount = data.bet * data.multiplier
        profit = win_amount - data.bet # Чистая прибыль
        user.balance += profit
    else:
        profit = -data.bet
        user.balance -= data.bet
        
    # 3. Сохраняем транзакцию
    tx = Transaction(user_id=user_id, amount=profit, game_type=data.game)
    db.add(tx)
    await db.commit()
    
    return {"new_balance": user.balance}

@app.get("/")
async def root():
    # Отдаем файл index.html
    return HTMLResponse(content=open("static/index.html").read())
