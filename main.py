import asyncio
import json
import random
import hmac
import hashlib
from urllib.parse import unquote
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from config import settings

# === ГЛОБАЛЬНОЕ СОСТОЯНИЕ ИГРЫ ===
class GameState:
    multiplier = 1.00
    status = "waiting" # waiting, flying, crashed
    history = [1.45, 2.10, 1.05, 12.50, 1.88] # История последних игр
    time_left = 5 # Секунд до старта

game = GameState()

# Менеджер подключений (игроков)
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        # Отправляем всем подключенным игрокам
        msg_json = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(msg_json)
            except:
                pass

manager = ConnectionManager()

# === ИГРОВОЙ ЦИКЛ (КРАШ) ===
async def crash_loop():
    while True:
        # 1. ОЖИДАНИЕ СТАВОК
        game.status = "waiting"
        game.multiplier = 1.00
        for i in range(5, 0, -1):
            game.time_left = i
            await manager.broadcast({
                "type": "tick", 
                "status": "waiting", 
                "time": i, 
                "history": game.history[-7:] # Последние 7 игр
            })
            await asyncio.sleep(1)

        # 2. ПОЛЕТ (РОСТ ИКСА)
        game.status = "flying"
        
        # Генерируем точку краша заранее (честная математика)
        # Шанс 3% на моментальный краш (1.00x)
        if random.random() < 0.03:
            crash_point = 1.00
        else:
            # Генерация (E = 100 / (1-rnd)) / 100
            crash_point = 0.99 / (1 - random.random())
            if crash_point > 100: crash_point = 100 # Макс x100
        
        crash_point = float(f"{crash_point:.2f}")
        
        start_time = asyncio.get_event_loop().time()
        
        while game.multiplier < crash_point:
            now = asyncio.get_event_loop().time()
            elapsed = now - start_time
            # Формула роста (экспонента)
            game.multiplier = 1.00 + (elapsed ** 2) * 0.1
            
            if game.multiplier >= crash_point:
                game.multiplier = crash_point
                break
                
            await manager.broadcast({
                "type": "fly", 
                "status": "flying", 
                "multiplier": float(f"{game.multiplier:.2f}")
            })
            await asyncio.sleep(0.1) # Обновление 10 раз в секунду

        # 3. КРАШ
        game.status = "crashed"
        game.history.append(crash_point)
        await manager.broadcast({
            "type": "crash", 
            "status": "crashed", 
            "multiplier": crash_point,
            "history": game.history[-7:]
        })
        
        # Пауза после краша
        await asyncio.sleep(3)

# === ЗАПУСК ===
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Запускаем игровой цикл в фоне
    asyncio.create_task(crash_loop())
    print("🚀 CRASH ENGINE STARTED")
    yield

app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get():
    return HTMLResponse(open("static/index.html", encoding="utf-8").read())

# WebSocket Endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Тут можно обрабатывать ставки от клиента
            # msg = json.loads(data)
            # if msg['action'] == 'bet': ...
    except WebSocketDisconnect:
        manager.disconnect(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
