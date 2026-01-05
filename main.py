import hashlib
import hmac
import json
import asyncio
from urllib.parse import unquote
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

# Импорты из наших файлов
from config import settings
from database import init_db, get_db
from models import User, Transaction
from bot import bot, dp # Импортируем объекты бота

# === Pydantic Модели (Валидация входящих данных) ===
class InitDataSchema(BaseModel):
    initData: str # Строка от Telegram

class GameResultSchema(BaseModel):
    initData: str
    game: str
    bet: float
    multiplier: float
    win: bool

# === Жизненный цикл (Запуск и Остановка) ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. При запуске
    print("🚀 SERVER STARTED")
    await init_db() # Создаем таблицы БД
    
    # Удаляем вебхуки, чтобы не было конфликтов
    await bot.delete_webhook(drop_pending_updates=True)
    
    # Запускаем бота в фоновом режиме
    asyncio.create_task(dp.start_polling(bot))
    
    yield # Тут работает сервер
    
    # 2. При остановке
    print("🛑 SERVER STOPPED")
    await bot.session.close()

# Создаем приложение
app = FastAPI(lifespan=lifespan)

# Подключаем папку static (чтобы работали CSS/JS/HTML)
app.mount("/static", StaticFiles(directory="static"), name="static")

# === БЕЗОПАСНОСТЬ: Проверка данных от Telegram ===
def validate_telegram_data(init_data: str):
    """
    Проверяет, что запрос пришел реально от Телеграма, а не от хакера.
    """
    if not init_data:
        raise HTTPException(status_code=400, detail="No initData")
        
    try:
        # Парсим строку данных
        parsed_data = dict(x.split('=') for x in unquote(init_data).split('&'))
        
        # Достаем хэш, который прислал Телеграм
        hash_check = parsed_data.pop('hash')
        
        # Сортируем параметры и собираем строку для проверки
        data_check_string = '\n'.join(f'{k}={v}' for k, v in sorted(parsed_data.items()))
        
        # Создаем секретный ключ HMAC
        secret_key = hmac.new(b"WebAppData", settings.BOT_TOKEN.encode(), hashlib.sha256).digest()
        
        # Считаем хэш сами
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        
        # Сравниваем
        if calculated_hash != hash_check:
            raise ValueError("Invalid hash")
            
        # Возвращаем данные юзера (из JSON строки)
        return json.loads(parsed_data['user'])
        
    except Exception as e:
        print(f"Auth Error: {e}")
        raise HTTPException(status_code=403, detail="Auth failed")

# === API: АВТОРИЗАЦИЯ ===
@app.post("/api/login")
async def login(data: InitDataSchema, db: AsyncSession = Depends(get_db)):
    # Проверяем валидность
    tg_user = validate_telegram_data(data.initData)
    user_id = tg_user['id']
    username = tg_user.get('username', 'Player')
    
    # Ищем пользователя в БД
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    # Если нет - регистрируем
    if not user:
        user = User(id=user_id, username=username)
        db.add(user)
        await db.commit()
    
    return {"status": "ok", "balance": user.balance, "username": user.username}

# === API: ЗАВЕРШЕНИЕ ИГРЫ ===
@app.post("/api/game/finish")
async def finish_game(data: GameResultSchema, db: AsyncSession = Depends(get_db)):
    # Проверка безопасности
    tg_user = validate_telegram_data(data.initData)
    user_id = tg_user['id']
    
    # Получаем юзера
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Считаем деньги
    profit = 0
    if data.win:
        win_amount = data.bet * data.multiplier
        profit = win_amount - data.bet # Чистая прибыль (с учетом возврата ставки на клиенте)
        user.balance += profit # Добавляем чистую прибыль (так как ставку списали на фронте, здесь надо просто добавить разницу)
        # ВНИМАНИЕ: Логика зависит от фронта.
        # Если фронт списал ставку, то при победе нужно вернуть ставку + выигрыш.
        # Упростим: просто пересчитаем баланс.
        # Предполагаем, что фронт просто шлет результат, а мы честно считаем.
        # Корректная логика: Баланс = Баланс + (Ставка * Кэф) (если ставку списали заранее)
        # Но чтобы не усложнять, считаем просто изменение:
        # User.balance уже уменьшен на ставку в момент нажатия?
        # Обычно безопаснее списывать на сервере ПЕРЕД игрой, но для простоты WebApp:
        # Мы просто начисляем выигрыш.
    else:
        # При проигрыше ничего не делаем, так как деньги списались на клиенте? 
        # НЕТ! На клиенте это просто цифры. Нужно списать в БД.
        # Но подождите, если мы списываем в конце, игрок может перезагрузить страницу и деньги вернутся.
        # ПРАВИЛЬНЫЙ ВАРИАНТ (Упрощенный для MVP):
        # 1. Приходим сюда с результатом.
        # 2. Если WIN: баланс += (bet * multiplier) - bet
        # 3. Если LOSE: баланс -= bet
        pass 

    # Корректировка логики транзакций для MVP:
    # Игрок нажал "Старт" -> JS уменьшил визуально.
    # Игра кончилась -> JS шлет запрос.
    # Сервер должен реально изменить баланс.
    
    change = 0
    if data.win:
        # Игрок выиграл. Ему нужно начислить: (bet * mult) - bet (т.к. ставку он уже "потратил" как бы)
        # Или проще: Баланс -= bet (списание ставки)
        #            Баланс += bet * mult (начисление выигрыша)
        total_win = data.bet * data.multiplier
        change = total_win - data.bet
        user.balance += change
    else:
        # Игрок проиграл.
        change = -data.bet
        user.balance -= data.bet
        
    # Пишем в историю
    tx = Transaction(user_id=user_id, amount=change, game_type=data.game)
    db.add(tx)
    await db.commit()
    
    return {"new_balance": user.balance}

# === ГЛАВНАЯ СТРАНИЦА ===
@app.get("/")
async def root():
    # Открываем наш index.html
    return HTMLResponse(content=open("static/index.html", encoding="utf-8").read())

# === ЗАПУСК (Если запускать локально, а не через gunicorn) ===
if __name__ == "__main__":
    import uvicorn
    # 0.0.0.0 и порт 8000 - стандарт для контейнеров
    uvicorn.run(app, host="0.0.0.0", port=8000)
