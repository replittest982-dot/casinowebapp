const tg = window.Telegram.WebApp;
tg.expand(); // Разворачиваем на весь экран

// Переменные состояния
let userBalance = 0;
let isPlaying = false;

// === СВЯЗЬ С СЕРВЕРОМ ===
async function api(method, data = {}) {
    // Автоматически добавляем данные Телеграм для проверки на сервере
    const payload = { initData: tg.initData, ...data };
    try {
        const res = await fetch(method, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        return await res.json();
    } catch (e) {
        tg.showAlert("Ошибка соединения с сервером!");
        return null;
    }
}

// === СТАРТ ПРИЛОЖЕНИЯ ===
async function init() {
    // 1. Логинимся
    const data = await api('/api/login');
    if (data && data.status === 'ok') {
        userBalance = data.balance;
        document.getElementById('username').innerText = data.username || 'Игрок';
        updateBalance();
    }
}
init();

function updateBalance() {
    document.getElementById('balance').innerText = userBalance.toFixed(2);
}

// === НАВИГАЦИЯ ===
function openGame(game) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`screen-${game}`).classList.add('active');
    tg.BackButton.show();
    tg.BackButton.onClick(goHome);
}

function goHome() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-menu').classList.add('active');
    tg.BackButton.hide();
    isPlaying = false;
    // Сброс интерфейсов
    resetCrash();
    resetMines();
}

// ===========================
// 🚀 ЛОГИКА CRASH
// ===========================
let crashTimer;
let multiplier = 1.00;
let crashBet = 0;

function crashAction() {
    const btn = document.getElementById('crashBtn');
    
    if (!isPlaying) {
        // СТАРТ ИГРЫ
        crashBet = parseFloat(document.getElementById('crashBet').value);
        if (crashBet > userBalance) return tg.showAlert("Недостаточно денег!");
        if (crashBet <= 0) return tg.showAlert("Некорректная ставка!");

        userBalance -= crashBet;
        updateBalance();
        
        isPlaying = true;
        multiplier = 1.00;
        
        btn.innerText = "ЗАБРАТЬ";
        btn.classList.add('btn-cashout');
        btn.style.background = "#ffcc00"; 
        
        document.getElementById('crashMultiplier').style.color = "white";

        // Запускаем цикл роста
        crashTimer = setInterval(() => {
            multiplier += 0.01 + (multiplier * 0.005);
            document.getElementById('crashMultiplier').innerText = multiplier.toFixed(2) + 'x';
            
            // Имитация краша (реальный результат должен приходить с сервера)
            // Шанс краша увеличивается
            if (Math.random() < 0.01 * multiplier) {
                gameOverCrash(false);
            }
        }, 50);
        
    } else {
        // ЗАБРАТЬ ДЕНЬГИ
        gameOverCrash(true);
    }
}

async function gameOverCrash(win) {
    clearInterval(crashTimer);
    const btn = document.getElementById('crashBtn');
    isPlaying = false;
    
    // Возвращаем кнопку
    btn.innerText = "СТАВКА";
    btn.classList.remove('btn-cashout');
    btn.style.background = "";

    if (win) {
        const winAmount = crashBet * multiplier;
        tg.showPopup({ title: 'ПОБЕДА!', message: `Вы выиграли ${winAmount.toFixed(2)}$` });
        
        // Отправляем на сервер
        await api('/api/game/finish', { 
            game: 'crash', 
            bet: crashBet, 
            multiplier: multiplier, 
            win: true 
        });
        
        userBalance += winAmount;
        updateBalance();
    } else {
        document.getElementById('crashMultiplier').style.color = "#ff3b30";
        document.getElementById('crashMultiplier').innerText = "CRASHED";
        
        // Отправляем проигрыш
        await api('/api/game/finish', { 
            game: 'crash', 
            bet: crashBet, 
            multiplier: 0, 
            win: false 
        });
    }
}

function resetCrash() {
    clearInterval(crashTimer);
    document.getElementById('crashMultiplier').innerText = "1.00x";
    document.getElementById('crashMultiplier').style.color = "white";
    isPlaying = false;
}

// ===========================
// 💣 ЛОГИКА MINES
// ===========================
let minesMap = [];
let minesOpened = 0;
let minesBetValue = 0;

function startMines() {
    if (isPlaying) return; // Нельзя начать новую, пока идет старая
    
    minesBetValue = parseFloat(document.getElementById('minesBet').value);
    if (minesBetValue > userBalance) return tg.showAlert("Нет денег!");
    
    userBalance -= minesBetValue;
    updateBalance();
    isPlaying = true;
    minesOpened = 0;
    
    // Блокируем кнопку
    const btn = document.getElementById('minesBtn');
    btn.innerText = "ИГРА ИДЕТ...";
    btn.style.opacity = "0.5";
    
    // Генерируем поле (5 бомб)
    minesMap = Array(25).fill(0);
    for(let i=0; i<5; i++) {
        let idx;
        do { idx = Math.floor(Math.random() * 25); } while(minesMap[idx] === 1);
        minesMap[idx] = 1;
    }
    
    // Рисуем сетку
    const board = document.getElementById('minesBoard');
    board.innerHTML = '';
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.onclick = () => clickMine(i, cell);
        board.appendChild(cell);
    }
}

async function clickMine(index, cell) {
    if (!isPlaying || cell.classList.contains('open')) return;
    
    cell.classList.add('open');
    
    if (minesMap[index] === 1) {
        // БОМБА
        cell.classList.add('bomb');
        cell.innerHTML = '💥';
        tg.HapticFeedback.notificationOccurred('error');
        
        await api('/api/game/finish', { game: 'mines', bet: minesBetValue, multiplier: 0, win: false });
        endMines(false);
        
    } else {
        // АЛМАЗ
        cell.classList.add('gem');
        cell.innerHTML = '💎';
        tg.HapticFeedback.impactOccurred('medium');
        minesOpened++;
        
        // Авто-выигрыш после 3 алмазов (для примера)
        if (minesOpened >= 3) {
            const mult = 1.5;
            const winSum = minesBetValue * mult;
            tg.showPopup({ title: 'ПОБЕДА!', message: `+${winSum.toFixed(2)}$` });
            
            await api('/api/game/finish', { game: 'mines', bet: minesBetValue, multiplier: mult, win: true });
            
            userBalance += winSum;
            updateBalance();
            endMines(true);
        }
    }
}

function endMines(win) {
    isPlaying = false;
    const btn = document.getElementById('minesBtn');
    btn.innerText = "СТАВКА";
    btn.style.opacity = "1";
    
    if (!win) {
        // Показать все бомбы
        const cells = document.querySelectorAll('.mine-cell');
        cells.forEach((c, i) => {
            if (minesMap[i] === 1) {
                c.classList.add('open', 'bomb');
                c.innerHTML = '💥';
            }
        });
    }
}

function resetMines() {
    document.getElementById('minesBoard').innerHTML = '';
    endMines(false);
}
