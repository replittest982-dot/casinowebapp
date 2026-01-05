const tg = window.Telegram.WebApp;
tg.expand();

let userBalance = 0;
let currentGame = null;

// === API HELPER ===
async function apiCall(endpoint, body) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData, ...body })
    });
    return await response.json();
}

// === INIT ===
async function init() {
    try {
        const data = await apiCall('/api/login', {});
        userBalance = data.balance;
        document.getElementById('username').innerText = data.username || 'Player';
        updateBalanceUI();
    } catch (e) {
        alert("Ошибка авторизации! Зайдите через Telegram.");
    }
}
init();

function updateBalanceUI() {
    document.getElementById('balance').innerText = userBalance.toFixed(2);
}

// === NAVIGATION ===
function openGame(gameId) {
    document.querySelectorAll('.container').forEach(el => el.classList.remove('active'));
    document.getElementById(`screen-${gameId}`).classList.add('active');
    currentGame = gameId;
}

function goHome() {
    document.querySelectorAll('.container').forEach(el => el.classList.remove('active'));
    document.getElementById('screen-menu').classList.add('active');
}

// =======================
// 🚀 CRASH GAME LOGIC
// =======================
let crashInterval;
let crashMult = 1.00;
let isCrashing = false;
let crashBetAmount = 0;

function crashAction() {
    const btn = document.getElementById('crashBtn');
    if (!isCrashing) {
        // START
        const bet = parseFloat(document.getElementById('crashBet').value);
        if (bet > userBalance) return tg.showAlert("Недостаточно средств!");
        
        crashBetAmount = bet;
        userBalance -= bet;
        updateBalanceUI();
        
        isCrashing = true;
        crashMult = 1.00;
        btn.innerText = "ЗАБРАТЬ";
        btn.classList.add('btn-cashout');
        
        // Simulation loop
        crashInterval = setInterval(() => {
            crashMult += 0.01 + (crashMult * 0.005); // Exponential growth
            document.getElementById('crashMultiplier').innerText = crashMult.toFixed(2) + 'x';
            
            // Random crash chance (Simulated)
            if (Math.random() < 0.01 * crashMult) {
                endCrash(false);
            }
        }, 50);
        
    } else {
        // CASHOUT
        endCrash(true);
    }
}

async function endCrash(win) {
    clearInterval(crashInterval);
    const btn = document.getElementById('crashBtn');
    isCrashing = false;
    btn.innerText = "СТАВКА";
    btn.classList.remove('btn-cashout');
    
    if (win) {
        const winAmount = crashBetAmount * crashMult;
        tg.showPopup({ title: 'ПОБЕДА!', message: `+${winAmount.toFixed(2)}$` });
        // Send to server
        await apiCall('/api/game/finish', { game: 'crash', bet: crashBetAmount, multiplier: crashMult, win: true });
        userBalance += (winAmount - crashBetAmount); // Client update sync
        init(); // Refresh exact from server
    } else {
        document.getElementById('crashMultiplier').innerText = "CRASHED";
        document.getElementById('crashMultiplier').style.color = "red";
        await apiCall('/api/game/finish', { game: 'crash', bet: crashBetAmount, multiplier: 0, win: false });
        init();
    }
}

// =======================
// 💣 MINES GAME LOGIC
// =======================
let minesActive = false;
let minesMap = []; // 0=safe, 1=bomb
let minesOpened = 0;
let minesBetAmount = 0;

function startMines() {
    if (minesActive) return; // Already playing
    
    const bet = parseFloat(document.getElementById('minesBet').value);
    if (bet > userBalance) return tg.showAlert("Не хватает денег!");
    
    userBalance -= bet;
    updateBalanceUI();
    minesBetAmount = bet;
    minesActive = true;
    minesOpened = 0;
    
    // Generate Board (Client side demo, Server side is better for production)
    minesMap = Array(25).fill(0);
    // Add 5 bombs
    for(let i=0; i<5; i++) {
        let idx;
        do { idx = Math.floor(Math.random() * 25); } while(minesMap[idx] === 1);
        minesMap[idx] = 1;
    }
    
    renderMinesBoard();
    document.getElementById('minesBtn').innerText = "ИГРА ИДЕТ...";
    document.getElementById('minesBtn').disabled = true;
}

function renderMinesBoard() {
    const board = document.getElementById('minesBoard');
    board.innerHTML = '';
    for(let i=0; i<25; i++) {
        const cell = document.createElement('div');
        cell.className = 'mine-cell';
        cell.onclick = () => clickMine(i, cell);
        board.appendChild(cell);
    }
}

async function clickMine(idx, cell) {
    if (!minesActive || cell.classList.contains('open')) return;
    
    cell.classList.add('open');
    
    if (minesMap[idx] === 1) {
        // BOOM
        cell.classList.add('bomb');
        cell.innerHTML = '💥';
        minesActive = false;
        tg.HapticFeedback.notificationOccurred('error');
        await apiCall('/api/game/finish', { game: 'mines', bet: minesBetAmount, multiplier: 0, win: false });
        
        setTimeout(() => {
            alert("Вы проиграли!");
            document.getElementById('minesBtn').innerText = "СТАВКА";
            document.getElementById('minesBtn').disabled = false;
            init();
        }, 500);
    } else {
        // GEM
        cell.classList.add('gem');
        cell.innerHTML = '💎';
        minesOpened++;
        tg.HapticFeedback.impactOccurred('medium');
        
        // Auto cashout logic or Manual? Let's make simplified auto-win for demo code
        if (minesOpened >= 3) { // Win after 3 gems for test
             minesActive = false;
             const mult = 1.5;
             tg.showPopup({ title: 'ПОБЕДА!', message: `Вы нашли 3 алмаза!` });
             await apiCall('/api/game/finish', { game: 'mines', bet: minesBetAmount, multiplier: mult, win: true });
             document.getElementById('minesBtn').innerText = "СТАВКА";
             document.getElementById('minesBtn').disabled = false;
             init();
        }
    }
}
