const tg = window.Telegram.WebApp;
tg.expand();

// === ПЕРЕМЕННЫЕ ===
let balance = 1000.00;
let currentBet = 0;
let isBetting = false;     // Поставили ли мы на следующий раунд
let inGame = false;        // В игре ли мы прямо сейчас
let ws = null;

// Элементы UI
const els = {
    balance: document.getElementById('balance'),
    status: document.getElementById('status-text'),
    bigMult: document.getElementById('big-multiplier'),
    btn: document.getElementById('actionBtn'),
    input: document.getElementById('betInput'),
    history: document.getElementById('history-container'),
    canvas: document.getElementById('crashCanvas'),
    feed: document.getElementById('feed-list')
};

// Canvas
const ctx = els.canvas.getContext('2d');
let animFrame;

// === WEBSOCKET ===
// Автоматически определяем протокол (ws или wss)
const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${window.location.host}/ws`;

function connect() {
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
    };

    ws.onclose = () => {
        setTimeout(connect, 1000); // Реконнект
    };
}
connect();

function handleWsMessage(data) {
    if (data.type === 'tick') {
        // ОЖИДАНИЕ
        renderWaiting(data.time);
        updateHistory(data.history);
        resetGraph();
        
        // Генерируем фейковые ставки ботов
        if(Math.random() > 0.3) addFakeBotBet();

    } else if (data.type === 'fly') {
        // ПОЛЕТ
        renderFlying(data.multiplier);
        drawGraph(data.multiplier);
        
        // Боты забирают выигрыш
        checkBotsCashout(data.multiplier);

    } else if (data.type === 'crash') {
        // КРАШ
        renderCrash(data.multiplier);
        updateHistory(data.history); // Обновить историю сразу
        
        if (inGame) {
            // Мы проиграли
            inGame = false;
            tg.HapticFeedback.notificationOccurred('error');
            resetButtonState();
        }
    }
}

// === ЛОГИКА ИГРОКА ===

window.handleAction = () => {
    const val = parseFloat(els.input.value);
    
    // Сценарий 1: Мы ждем начала игры, ставим ставку
    if (!inGame && !isBetting) {
        if (val > balance) return tg.showAlert("Недостаточно средств!");
        isBetting = true;
        currentBet = val;
        balance -= val;
        updateBalance();
        
        // Меняем кнопку
        els.btn.style.background = "#da3633"; // Красный (Отмена)
        els.btn.innerHTML = `<span class="btn-title">ОТМЕНА</span><span class="btn-subtitle">${val}$</span>`;
        
    } 
    // Сценарий 2: Отмена ставки (пока ждем)
    else if (!inGame && isBetting) {
        isBetting = false;
        balance += currentBet;
        updateBalance();
        resetButtonState();
    } 
    // Сценарий 3: ЗАБРАТЬ ДЕНЬГИ (в полете)
    else if (inGame) {
        // Отправляем сигнал на сервер (в реальности), тут симулируем
        const currentMult = parseFloat(els.bigMult.innerText);
        const win = currentBet * currentMult;
        balance += win;
        updateBalance();
        inGame = false;
        isBetting = false;
        
        tg.HapticFeedback.notificationOccurred('success');
        els.btn.classList.add('btn-disabled');
        els.btn.innerHTML = `<span class="btn-title">ПОБЕДА</span><span class="btn-subtitle">+${win.toFixed(2)}$</span>`;
    }
};

window.adjustBet = (factor) => {
    let val = parseFloat(els.input.value);
    val = val * factor;
    if (val < 1) val = 1;
    els.input.value = val.toFixed(0);
};

// === ОТРИСОВКА (RENDER) ===

function renderWaiting(time) {
    els.status.innerText = `СТАРТ ЧЕРЕЗ ${time.toFixed(1)}c`;
    els.status.className = 'status-text waiting-text';
    els.bigMult.className = 'big-digits';
    els.bigMult.innerText = '1.00x';
    
    // Если мы ставили, то входим в игру
    if (isBetting && !inGame && time <= 0.2) {
        inGame = true;
        // Кнопка превращается в CASHOUT
        els.btn.className = 'btn-main btn-cashout';
        els.btn.innerHTML = `<span class="btn-title">ЗАБРАТЬ</span><span class="btn-subtitle">ВЫИГРЫШ</span>`;
        els.btn.style.background = ""; // Сброс красного
    } else if (!isBetting) {
        resetButtonState();
    }
    
    // Очищаем таблицу ботов перед новой игрой
    if (time > 4.5) els.feed.innerHTML = '';
}

function renderFlying(mult) {
    els.status.innerText = 'В ПОЛЕТЕ';
    els.status.className = 'status-text';
    els.bigMult.innerText = mult.toFixed(2) + 'x';
    
    if (inGame) {
        const winNow = (currentBet * mult).toFixed(2);
        els.btn.innerHTML = `<span class="btn-title">ЗАБРАТЬ</span><span class="btn-subtitle">${winNow}$</span>`;
    }
}

function renderCrash(mult) {
    els.status.innerText = 'САМОЛЕТ УЛЕТЕЛ';
    els.bigMult.className = 'big-digits crashed-text';
    els.bigMult.innerText = mult.toFixed(2) + 'x';
}

function resetButtonState() {
    els.btn.className = 'btn-main';
    els.btn.style.background = "";
    els.btn.innerHTML = `<span class="btn-title">СТАВКА</span><span class="btn-subtitle">СЛЕД. РАУНД</span>`;
}

function updateBalance() {
    els.balance.innerText = balance.toFixed(2);
}

function updateHistory(history) {
    els.history.innerHTML = '';
    history.reverse().forEach(h => {
        const el = document.createElement('div');
        el.className = `hist-badge ${h >= 2 ? 'hist-win' : 'hist-lose'}`;
        el.innerText = h.toFixed(2) + 'x';
        els.history.appendChild(el);
    });
}

// === CANVAS GRAPH (КРАСИВЫЙ ГРАФИК) ===
function resizeCanvas() {
    els.canvas.width = els.canvas.offsetWidth;
    els.canvas.height = els.canvas.offsetHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function resetGraph() {
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
}

function drawGraph(mult) {
    const width = els.canvas.width;
    const height = els.canvas.height;
    
    // Масштабирование: чем больше икс, тем "шире" график
    // Простая логика для визуализации
    const t = (mult - 1) / 5; // нормализация (до x6 будет красиво, потом уходит)
    
    // Кривая Безье
    const x = Math.min(width * 0.9, width * (t * 2)); 
    const y = Math.min(height * 0.9, height * t);
    
    resetGraph();
    
    // Линия
    ctx.beginPath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#58a6ff';
    ctx.lineCap = 'round';
    
    // Стартовая точка (низ лево)
    ctx.moveTo(0, height);
    // Кривая (парабола)
    ctx.quadraticCurveTo(x / 2, height, x, height - y);
    ctx.stroke();
    
    // Градиент под графиком
    const grad = ctx.createLinearGradient(0, height - y, 0, height);
    grad.addColorStop(0, 'rgba(88, 166, 255, 0.4)');
    grad.addColorStop(1, 'rgba(88, 166, 255, 0)');
    
    ctx.fillStyle = grad;
    ctx.lineTo(0, height);
    ctx.fill();
    
    // Точка (Самолетик)
    ctx.beginPath();
    ctx.fillStyle = 'white';
    ctx.arc(x, height - y, 6, 0, Math.PI * 2);
    ctx.fill();
    // Свечение точки
    ctx.shadowColor = 'white';
    ctx.shadowBlur = 15;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

// === FAKE BOTS (ФЕЙК ОНЛАЙН) ===
const botNames = ["Alex", "CryptoKing", "Winner777", "Masha", "Ivan_Pro", "ElonMusk", "User123", "LuckyGuy"];
let currentBots = [];

function addFakeBotBet() {
    const name = botNames[Math.floor(Math.random() * botNames.length)];
    const bet = (Math.random() * 100 + 10).toFixed(0);
    const id = Math.random();
    
    // Целевой кэшаут бота (от 1.1 до 5.0)
    const target = 1 + Math.random() * 4;
    
    const botObj = { id, name, bet, target, cashed: false, el: null };
    currentBots.push(botObj);
    
    // Добавляем в DOM
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `
        <span>${name}</span>
        <span>${bet}$</span>
        <span class="coef">-</span>
        <span>-</span>
    `;
    els.feed.prepend(row);
    botObj.el = row;
    
    // Ограничение списка (удаляем старых)
    if (els.feed.children.length > 10) els.feed.lastChild.remove();
}

function checkBotsCashout(currentMult) {
    currentBots.forEach(bot => {
        if (!bot.cashed && currentMult >= bot.target) {
            bot.cashed = true;
            const win = (bot.bet * bot.target).toFixed(0);
            bot.el.classList.add('is-winner');
            bot.el.innerHTML = `
                <span>${bot.name}</span>
                <span>${bot.bet}$</span>
                <span class="coef">x${bot.target.toFixed(2)}</span>
                <span class="win-sum">+${win}$</span>
            `;
        }
    });
}
