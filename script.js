// ════════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════════
const S = {
    // Persistent
    level: 1, xp: 0, streak: 0, bestLevel: 1, bestXP: 0, bestStreak: 0,
    difficulty: 'easy', soundOn: true, vibOn: true,
    // Per-level
    arrows: [], gridSize: 5, hintId: null, hintsLeft: 3,
    moves: 0, totalArrows: 0, hearts: 3, maxHearts: 3,
    history: [], combo: 0, comboTimer: null,
    removed: 0,
};

function loadPersist() {
    try {
        const d = JSON.parse(localStorage.getItem('tapaway_v4') || '{}');
        ['level', 'xp', 'streak', 'bestLevel', 'bestXP', 'bestStreak', 'difficulty', 'soundOn', 'vibOn'].forEach(k => {
            if (d[k] !== undefined) S[k] = d[k];
        });
    } catch (e) { }
}
function savePersist() {
    localStorage.setItem('tapaway_v4', JSON.stringify({
        level: S.level, xp: S.xp, streak: S.streak,
        bestLevel: S.bestLevel, bestXP: S.bestXP, bestStreak: S.bestStreak,
        difficulty: S.difficulty, soundOn: S.soundOn, vibOn: S.vibOn,
    }));
}
loadPersist();

// ════════════════════════════════════════════════════════════
//  GAME LOGIC ENGINE
// ════════════════════════════════════════════════════════════
const DIRS = ['up', 'down', 'left', 'right'];
const OFF = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const FA_ICONS = { up: 'fa-arrow-up', down: 'fa-arrow-down', left: 'fa-arrow-left', right: 'fa-arrow-right' };

function uid() { return Math.random().toString(36).slice(2, 9); }
function oob(x, y, gs) { return x < 0 || x >= gs || y < 0 || y >= gs; }

function getPath(arrow, arrows, gs) {
    // Returns the array of positions along the path (excluding origin)
    const { x: dx, y: dy } = OFF[arrow.dir];
    const path = [];
    let cx = arrow.x + dx, cy = arrow.y + dy;
    while (!oob(cx, cy, gs)) {
        path.push({ x: cx, y: cy });
        cx += dx; cy += dy;
    }
    return path;
}

function canRemove(arrow, arrows, gs) {
    const { x: dx, y: dy } = OFF[arrow.dir];
    let cx = arrow.x + dx, cy = arrow.y + dy;
    while (!oob(cx, cy, gs)) {
        if (arrows.find(a => a.x === cx && a.y === cy && !a.removing)) return false;
        cx += dx; cy += dy;
    }
    return true;
}

function canAnyMove() {
    return S.arrows.some(a => !a.removing && canRemove(a, S.arrows, S.gridSize));
}

// Returns info about WHY a move is blocked: which arrow is blocking & the free cells before it
function getBlockInfo(arrow, arrows, gs) {
    const { x: dx, y: dy } = OFF[arrow.dir];
    let cx = arrow.x + dx, cy = arrow.y + dy;
    const freePath = [];
    const blockers = [];
    while (!oob(cx, cy, gs)) {
        const blocker = arrows.find(a => a.x === cx && a.y === cy && !a.removing);
        if (blocker) { blockers.push(blocker); break; }
        freePath.push({ x: cx, y: cy });
        cx += dx; cy += dy;
    }
    return { blockers, freePath };
}

// Difficulty grid size table: [easy, medium, hard]
// Returns grid size for given level and difficulty
function getGridSize(level, diff) {
    if (diff === 'easy') {
        if (level <= 10) return 5;
        if (level <= 25) return 6;
        if (level <= 50) return 7;
        return Math.min(5 + Math.floor(level / 15), 9);
    }
    if (diff === 'medium') {
        if (level <= 5) return 6;
        if (level <= 15) return 7;
        if (level <= 30) return 8;
        if (level <= 60) return 9;
        return 10;
    }
    // hard
    if (level <= 3) return 7;
    if (level <= 8) return 8;
    if (level <= 14) return 10; // Hard hits 10x10 by level 14
    return 10;
}

function getArrowCount(level, diff, gs) {
    const base = { easy: 0.52, medium: 0.68, hard: 0.82 }[diff];
    const levelScale = 1 + level * 0.012; // +1.2% per level
    return Math.min(Math.floor(gs * gs * base * levelScale), Math.floor(gs * gs * 0.90));
}

function generateLevel(level, diff) {
    const gs = getGridSize(level, diff);
    const targetCount = getArrowCount(level, diff, gs);
    let arrows = [];
    const occupied = new Set();

    // We generate by starting with an empty grid and adding arrows that *would* be removable
    // if we were playing the game in REVERSE. This guarantees solvability while allowing
    // for complex dependency chains.

    let attempts = 0;
    const maxAttempts = gs * gs * 10;

    while (arrows.length < targetCount && attempts < maxAttempts) {
        attempts++;
        const x = Math.floor(Math.random() * gs);
        const y = Math.floor(Math.random() * gs);

        if (occupied.has(`${x},${y}`)) continue;

        const dir = DIRS[Math.floor(Math.random() * 4)];
        const candidate = { id: uid(), x, y, dir, removing: false };

        // In "Reverse Generation": An arrow can be placed if its path is clear 
        // to the edge of the board, considering currently placed arrows as obstacles
        // that represent the sequence of moves.
        if (canRemove(candidate, arrows, gs)) {
            arrows.push(candidate);
            occupied.add(`${x},${y}`);
        }
    }

    // Shuffle to ensure no predictable patterns in removal order
    arrows = arrows.sort(() => Math.random() - 0.5);

    return { arrows, gridSize: gs };
}

// ════════════════════════════════════════════════════════════
//  SOUND ENGINE (Web Audio API)
// ════════════════════════════════════════════════════════════
let actx = null;
function actxGet() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    return actx;
}
function beep(freq, type, dur, vol, delay = 0) {
    if (!S.soundOn) return;
    try {
        const c = actxGet();
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + delay);
        g.gain.setValueAtTime(0, c.currentTime + delay);
        g.gain.linearRampToValueAtTime(vol, c.currentTime + delay + 0.008);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + dur);
        o.start(c.currentTime + delay);
        o.stop(c.currentTime + delay + dur + 0.02);
    } catch (e) { }
}
function sfxTap() { beep(700, 'sine', .07, .18); }
function sfxOk() {
    beep(500, 'sine', .09, .22);
    beep(750, 'sine', .09, .18, .07);
}
function sfxCombo(n) {
    const f = 400 + n * 55;
    beep(f, 'sine', .08, .25);
    beep(f * 1.5, 'sine', .07, .2, .06);
    beep(f * 2, 'sine', .07, .15, .12);
}
function sfxErr() {
    beep(220, 'triangle', .12, .3);
    beep(190, 'triangle', .1, .22, .09);
}
function sfxHint() {
    beep(900, 'sine', .07, .18);
    beep(1200, 'sine', .07, .14, .09);
}
function sfxUndo() { beep(440, 'triangle', .1, .18); }
function sfxWin() {
    [523, 659, 784, 1047].forEach((f, i) => beep(f, 'sine', .22, .3, i * 0.11));
}
function vibe(ms) { if (S.vibOn && navigator.vibrate) navigator.vibrate(ms); }

// ════════════════════════════════════════════════════════════
//  CONFETTI
// ════════════════════════════════════════════════════════════
function confetti() {
    const cv = document.getElementById('confetti-canvas');
    cv.width = window.innerWidth; cv.height = window.innerHeight;
    const ctx = cv.getContext('2d');
    const clrs = ['#00d4ff', '#7c3aed', '#f43f5e', '#34d399', '#f59e0b', '#fff', '#a78bfa'];
    const pts = [];
    for (let i = 0; i < 130; i++) pts.push({
        x: cv.width / 2 + (Math.random() - .5) * 160,
        y: cv.height * .42,
        vx: (Math.random() - .5) * 13,
        vy: -Math.random() * 15 - 3,
        r: Math.random() * 5 + 2,
        c: clrs[Math.floor(Math.random() * clrs.length)],
        rot: Math.random() * Math.PI * 2,
        rv: (Math.random() - .5) * .3,
        a: 1,
    });
    let raf;
    function draw() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        let live = false;
        pts.forEach(p => {
            if (p.a <= 0) return;
            live = true;
            p.x += p.vx; p.y += p.vy; p.vy += .42; p.vx *= .99;
            p.rot += p.rv; p.a -= .012;
            ctx.save(); ctx.globalAlpha = Math.max(0, p.a);
            ctx.translate(p.x, p.y); ctx.rotate(p.rot);
            ctx.fillStyle = p.c;
            ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.8);
            ctx.restore();
        });
        if (live) raf = requestAnimationFrame(draw);
        else ctx.clearRect(0, 0, cv.width, cv.height);
    }
    raf = requestAnimationFrame(draw);
    setTimeout(() => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, cv.width, cv.height); }, 4500);
}

// ════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════
function renderBoard(animIn = false) {
    const grid = document.getElementById('board-grid');
    const gs = S.gridSize;

    // Update CSS var for dot grid spacing
    document.getElementById('dot-grid').style.setProperty('--gs', gs);
    // Adjust gap based on grid size
    const gap = gs <= 6 ? 5 : gs <= 8 ? 3 : 2;
    grid.style.gridTemplateColumns = `repeat(${gs},1fr)`;
    grid.style.gridTemplateRows = `repeat(${gs},1fr)`;
    grid.style.gap = `${gap}px`;
    grid.innerHTML = '';

    let idx = 0;
    for (let y = 0; y < gs; y++) {
        for (let x = 0; x < gs; x++) {
            const cell = document.createElement('div');
            cell.className = 'tile-cell';
            cell.dataset.cx = x; cell.dataset.cy = y;

            const arrow = S.arrows.find(a => a.x === x && a.y === y && !a.removing);
            if (arrow) {
                const tile = document.createElement('div');
                tile.className = 'arr-tile' + (S.hintId === arrow.id ? ' hint-glow' : '');
                if (animIn) {
                    tile.classList.add('entering');
                    tile.style.animationDelay = `${idx * 18}ms`;
                }
                tile.dataset.id = arrow.id;
                tile.innerHTML = `<i class="fa-solid ${FA_ICONS[arrow.dir]}"></i>`;
                tile.addEventListener('pointerdown', e => { e.preventDefault(); onTap(arrow.id, tile); });
                cell.appendChild(tile);
            }

            grid.appendChild(cell);
            idx++;
        }
    }

    updateBoardInfo();
    updateHeader();
    updateDeadEnds(false); // Update visuals immediately without "new" animation
}

function updateDeadEnds(animateNew = true) {
    S.arrows.forEach(a => {
        if (a.removing) return;
        const wasDead = a.isDeadEnd;
        const isDead = !canRemove(a, S.arrows, S.gridSize);
        a.isDeadEnd = isDead;

        const el = getTileEl(a.id);
        if (el) {
            el.classList.toggle('dead-end', isDead);
            if (animateNew && isDead && !wasDead) {
                el.classList.remove('dead-end-new');
                void el.offsetWidth;
                el.classList.add('dead-end-new');
            }
        }
    });
}

function getTileEl(id) {
    return document.querySelector(`.arr-tile[data-id="${id}"]`);
}

function updateHeader() {
    document.getElementById('hdr-level').textContent = `LEVEL ${S.level}`;
    const gs = S.gridSize;
    const diffLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[S.difficulty];
    document.getElementById('hdr-diff').textContent = `${diffLabel} · ${gs}×${gs}`;

    const xpInLv = S.xp % 100;
    document.getElementById('prog-fill').style.width = xpInLv + '%';
    document.getElementById('prog-label').textContent = `LV.${Math.floor(S.xp / 100) + 1}`;
    document.getElementById('xp-label').textContent = `${S.xp} XP`;

    // Hearts
    const hrow = document.getElementById('hearts-row');
    hrow.innerHTML = '';
    for (let i = 0; i < S.maxHearts; i++) {
        const h = document.createElement('i');
        h.className = 'fa-solid fa-heart heart-ico ' + (i < S.hearts ? 'full' : 'empty');
        hrow.appendChild(h);
    }

    // Hint badge
    document.getElementById('hint-badge').textContent = S.hintsLeft;
    if (S.hintsLeft <= 0) document.getElementById('hint-btn').classList.add('dimmed');
    else document.getElementById('hint-btn').classList.remove('dimmed');

    // Settings diff
    ['easy', 'medium', 'hard'].forEach(d => {
        document.getElementById(`sg-${d}`).className = 'diff-opt' + (S.difficulty === d ? ' active' : '');
    });
    document.getElementById('sound-tog').className = 'tog-track ' + (S.soundOn ? 'on' : 'off');
    document.getElementById('vib-tog').className = 'tog-track ' + (S.vibOn ? 'on' : 'off');
}

function updateBoardInfo() {
    const remaining = S.arrows.filter(a => !a.removing).length;
    const done = S.totalArrows - remaining;
    document.getElementById('info-left').textContent = `${done} / ${S.totalArrows} cleared`;
    document.getElementById('info-right').textContent = `${S.moves} move${S.moves !== 1 ? 's' : ''}`;

    const dotsCont = document.getElementById('info-dots');
    const show = Math.min(S.totalArrows, 16);
    dotsCont.innerHTML = '';
    for (let i = 0; i < show; i++) {
        const d = document.createElement('div');
        const ratio = (i / show);
        const doneFrac = done / S.totalArrows;
        d.className = 'i-dot' + (ratio < doneFrac ? ' done' : '');
        dotsCont.appendChild(d);
    }
}

// ════════════════════════════════════════════════════════════
//  SNAKE REMOVAL ANIMATION
//  Arrow disappears INSTANTLY from state, then animates its
//  path segments lighting up and fading like a snake trail
// ════════════════════════════════════════════════════════════
function animateSnakeRemoval(arrow, onDone) {
    // Mark tile with removing class immediately
    const tile = getTileEl(arrow.id);
    if (tile) {
        tile.style.pointerEvents = 'none';
        // Change icon to match direction for trail
        tile.classList.add('path-lit');
    }

    // Get path cells
    const pathPositions = getPath(arrow, S.arrows, S.gridSize);

    // Light up path cells sequentially, then remove
    const STEP = 60; // ms per segment
    pathPositions.forEach((pos, i) => {
        setTimeout(() => {
            const cell = document.querySelector(`.tile-cell[data-cx="${pos.x}"][data-cy="${pos.y}"]`);
            if (!cell) return;
            // If there's a tile there (shouldn't be in valid path) skip
            // Otherwise create a brief trail dot
            const trail = document.createElement('div');
            trail.style.cssText = `
        position:absolute;inset:2px;border-radius:8px;
        background:rgba(0,212,255,0.18);
        border:1px solid rgba(0,212,255,0.4);
        pointer-events:none;z-index:3;
        animation:trail-fade .3s ease forwards;
      `;
            cell.style.position = 'relative';
            cell.appendChild(trail);
            setTimeout(() => trail.remove(), 320);
        }, i * STEP);
    });

    // After trail, animate the arrow tile itself out
    const totalDelay = Math.max(60, pathPositions.length * STEP);
    setTimeout(() => {
        if (tile) {
            tile.classList.remove('path-lit');
            tile.classList.add('removing-snake');
            setTimeout(() => {
                tile.remove();
                onDone();
            }, 300);
        } else {
            onDone();
        }
    }, totalDelay);
}

// Add trail-fade keyframe dynamically
(() => {
    const s = document.createElement('style');
    s.textContent = `@keyframes trail-fade{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(0.7)}}`;
    document.head.appendChild(s);
})();

// ════════════════════════════════════════════════════════════
//  GAME ACTIONS
// ════════════════════════════════════════════════════════════
function onTap(id, tileEl) {
    const arrow = S.arrows.find(a => a.id === id);
    if (!arrow || arrow.removing) return;

    sfxTap();
    if (S.hintId === id) S.hintId = null;

    if (canRemove(arrow, S.arrows, S.gridSize)) {
        // Save undo snapshot BEFORE removing
        S.history.push(S.arrows.map(a => ({ ...a })));
        if (S.history.length > 8) S.history.shift();

        // Mark as removing immediately so game logic excludes it
        arrow.removing = true;
        S.moves++;
        S.removed++;
        S.combo++;

        clearTimeout(S.comboTimer);

        // Sound
        if (S.combo >= 3) {
            sfxCombo(Math.min(S.combo - 3, 6));
            showComboBanner(S.combo);
        } else {
            sfxOk();
        }
        vibe(18);

        // Reset combo after 1.5s idle
        S.comboTimer = setTimeout(() => { S.combo = 0; }, 1500);

        // Snake removal animation
        animateSnakeRemoval(arrow, () => {
            // Permanently remove from array
            S.arrows = S.arrows.filter(a => a.id !== id);
            const remaining = S.arrows.filter(a => !a.removing).length;
            updateBoardInfo();
            updateDeadEnds(true); // Check for new dead-ends after move
            if (remaining === 0) {
                onLevelComplete();
            }
        });

    } else {
        // ── INVALID TAP: show boundary / blocker error feedback ──
        S.combo = 0;
        S.hearts--;

        const { blockers, freePath } = getBlockInfo(arrow, S.arrows, S.gridSize);

        // 1. Self tile: red shake + blocked-self flash
        if (tileEl) {
            tileEl.classList.remove('blocked-self', 'shake');
            void tileEl.offsetWidth;
            tileEl.classList.add('blocked-self');

            // Show floating error tooltip above tile
            const dirLabel = { up: 'BLOCKED ABOVE', down: 'BLOCKED BELOW', left: 'BLOCKED LEFT', right: 'BLOCKED RIGHT' }[arrow.dir];
            const tip = document.createElement('div');
            tip.className = 'err-tooltip';
            tip.textContent = blockers.length ? dirLabel : 'WALL';
            tileEl.style.position = 'relative';
            tileEl.appendChild(tip);
            setTimeout(() => { tip.remove(); tileEl.classList.remove('blocked-self'); }, 600);
        }

        // 2. Show free path cells with a faint red trail
        const STEP = 40;
        freePath.forEach((pos, i) => {
            setTimeout(() => {
                const cell = document.querySelector(`.tile-cell[data-cx="${pos.x}"][data-cy="${pos.y}"]`);
                if (!cell) return;
                cell.classList.add('blocked-path-trail');
                setTimeout(() => cell.classList.remove('blocked-path-trail'), 520);
            }, i * STEP);
        });

        // 3. Blocker arrow: bold red pulse to clearly show WHY
        const blockerDelay = freePath.length * STEP;
        blockers.forEach(blocker => {
            setTimeout(() => {
                const bTile = document.querySelector(`.arr-tile[data-id="${blocker.id}"]`);
                if (!bTile) return;
                bTile.classList.remove('blocker-flash');
                void bTile.offsetWidth;
                bTile.classList.add('blocker-flash');
                setTimeout(() => bTile.classList.remove('blocker-flash'), 650);
            }, blockerDelay);
        });

        sfxErr();
        vibe([50, 30, 50]);
        renderHearts();

        if (!canAnyMove()) {
            const board = document.getElementById('board-outer');
            if (board) {
                board.classList.remove('board-stuck');
                void board.offsetWidth;
                board.classList.add('board-stuck');
                setTimeout(() => board.classList.remove('board-stuck'), 600);
            }
        }

        if (S.hearts <= 0) setTimeout(onGameOver, 700);
    }
}

function renderHearts() {
    const hrow = document.getElementById('hearts-row');
    hrow.innerHTML = '';
    for (let i = 0; i < S.maxHearts; i++) {
        const h = document.createElement('i');
        h.className = 'fa-solid fa-heart heart-ico ' + (i < S.hearts ? 'full' : 'empty');
        if (i === S.hearts) h.classList.add('burst');
        hrow.appendChild(h);
    }
}

function showComboBanner(n) {
    const el = document.getElementById('combo-banner');
    el.innerHTML = `🔥 ${n}x COMBO!`;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1400);
}

function useHint() {
    if (S.hintsLeft <= 0) { sfxErr(); return; }
    sfxHint();
    const hint = S.arrows.find(a => !a.removing && canRemove(a, S.arrows, S.gridSize));
    if (hint) {
        S.hintsLeft--;
        S.hintId = hint.id;
        updateHeader();
        // Update tile visually
        document.querySelectorAll('.arr-tile').forEach(t => {
            t.classList.toggle('hint-glow', t.dataset.id === hint.id);
        });
        vibe(35);
    }
}

function undoMove() {
    if (S.history.length === 0) { sfxErr(); return; }
    sfxUndo(); vibe(25);
    S.arrows = S.history.pop();
    S.moves = Math.max(0, S.moves - 1);
    S.removed = Math.max(0, S.removed - 1);
    S.combo = 0;
    if (S.hearts < S.maxHearts) S.hearts++;
    S.hintId = null;
    renderBoard(false);
}

function restartLevel() {
    closeAllModals();
    initLevel(true);
}

function initLevel(animIn = true) {
    const { arrows, gridSize } = generateLevel(S.level, S.difficulty);
    S.arrows = arrows;
    S.gridSize = gridSize;
    S.hintId = null;
    S.hintsLeft = 3;
    S.moves = 0;
    S.removed = 0;
    S.hearts = S.maxHearts;
    S.history = [];
    S.combo = 0;
    S.totalArrows = arrows.length;
    savePersist(); // Level is always saved on init
    closeAllModals();
    updateHeader();
    renderBoard(animIn);
    updateDeadEnds(false); // Initial dead-end check
}

function onLevelComplete() {
    sfxWin();
    vibe([40, 20, 40, 20, 80]);
    confetti();

    const xpGain = Math.floor(50 * S.level * (S.difficulty === 'medium' ? 1.5 : S.difficulty === 'hard' ? 2.5 : 1));
    S.xp += xpGain;
    S.streak++;
    if (S.level > S.bestLevel) S.bestLevel = S.level;
    if (S.xp > S.bestXP) S.bestXP = S.xp;
    if (S.streak > S.bestStreak) S.bestStreak = S.streak;
    savePersist();

    document.getElementById('lc-sub').textContent = `Level ${S.level} complete!`;
    document.getElementById('lc-moves').textContent = S.moves;
    document.getElementById('lc-xp').textContent = `+${xpGain}`;
    document.getElementById('lc-streak').textContent = `${S.streak}x`;

    setTimeout(() => openModal('lc-modal'), 600);
}

function nextLevel() {
    S.level++;
    savePersist();
    closeAllModals();
    setTimeout(() => initLevel(true), 300);
}

function onGameOver() {
    S.streak = 0;
    savePersist();
    document.getElementById('go-sub').textContent = `Level ${S.level} — you ran out of lives`;
    openModal('go-modal');
}

// ════════════════════════════════════════════════════════════
//  SCREEN TRANSITIONS
// ════════════════════════════════════════════════════════════
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        if (s.id === id) {
            s.classList.remove('exit');
            s.classList.add('active');
        } else {
            s.classList.remove('active');
            s.classList.add('exit');
            setTimeout(() => s.classList.remove('exit'), 400);
        }
    });
}

// ════════════════════════════════════════════════════════════
//  MODALS
// ════════════════════════════════════════════════════════════
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function closeAllModals() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); }

// ════════════════════════════════════════════════════════════
//  START SCREEN BACKGROUND (animated arrow rain)
// ════════════════════════════════════════════════════════════
(function initStartBg() {
    const cv = document.getElementById('start-bg-canvas');
    const ctx = cv.getContext('2d');
    let W, H;
    function resize() { W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight; }
    resize();
    new ResizeObserver(resize).observe(cv);

    const symbols = ['↑', '↓', '←', '→'];
    const cols = [];
    function init() {
        cols.length = 0;
        const n = Math.floor(W / 32);
        for (let i = 0; i < n; i++) cols.push({
            x: i * 32 + 16, y: Math.random() * H,
            speed: 0.4 + Math.random() * 0.6,
            sym: symbols[Math.floor(Math.random() * 4)],
            alpha: 0.04 + Math.random() * 0.06,
            size: 10 + Math.random() * 6,
        });
    }
    init();

    function draw() {
        ctx.clearRect(0, 0, W, H);
        cols.forEach(c => {
            ctx.fillStyle = `rgba(0,212,255,${c.alpha})`;
            ctx.font = `${c.size}px monospace`;
            ctx.fillText(c.sym, c.x, c.y);
            c.y += c.speed;
            if (c.y > H + 20) { c.y = -20; c.sym = symbols[Math.floor(Math.random() * 4)]; }
        });
        requestAnimationFrame(draw);
    }
    draw();
})();

// ════════════════════════════════════════════════════════════
//  SETTINGS SYNC
// ════════════════════════════════════════════════════════════
function syncDiffUI() {
    // Start screen tabs
    document.querySelectorAll('#start-diff-tabs .diff-opt').forEach(b => {
        b.classList.toggle('active', b.dataset.d === S.difficulty);
    });
    // Settings modal
    ['easy', 'medium', 'hard'].forEach(d => {
        document.getElementById(`sg-${d}`).classList.toggle('active', d === S.difficulty);
    });

    // Update start screen status chip
    const diffLabel = { easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' }[S.difficulty];
    document.getElementById('last-level-val').textContent = `LEVEL ${S.level} · ${diffLabel}`;
}

// ════════════════════════════════════════════════════════════
//  EVENT WIRING
// ════════════════════════════════════════════════════════════

// Start screen diff tabs
document.querySelectorAll('#start-diff-tabs .diff-opt').forEach(b => {
    b.addEventListener('click', () => {
        S.difficulty = b.dataset.d;
        savePersist(); syncDiffUI();
    });
});

// Start button (NEW GAME)
document.getElementById('start-btn').addEventListener('click', () => {
    try { actxGet(); } catch (e) { }
    S.level = 1; S.hearts = S.maxHearts;
    initLevel(true);
    showScreen('game-screen');
});

// Continue button
document.getElementById('continue-btn').addEventListener('click', () => {
    try { actxGet(); } catch (e) { }
    initLevel(true);
    showScreen('game-screen');
});

// Back to menu
document.getElementById('back-btn').addEventListener('click', () => {
    // Update start screen best scores
    document.getElementById('best-level').textContent = S.bestLevel;
    document.getElementById('best-xp').textContent = S.bestXP;
    document.getElementById('best-streak').textContent = S.bestStreak;
    syncDiffUI();
    showScreen('start-screen');
    closeAllModals();
});

// Header settings
document.getElementById('settings-btn').addEventListener('click', () => openModal('settings-modal'));
document.getElementById('settings-close').addEventListener('click', () => closeModal('settings-modal'));

// Footer actions
document.getElementById('hint-btn').addEventListener('click', useHint);
document.getElementById('undo-btn').addEventListener('click', undoMove);
document.getElementById('restart-btn').addEventListener('click', restartLevel);

// Level complete
document.getElementById('lc-next-btn').addEventListener('click', nextLevel);

// Game over
document.getElementById('go-retry-btn').addEventListener('click', restartLevel);
document.getElementById('go-menu-btn').addEventListener('click', () => {
    closeAllModals();
    S.streak = 0;
    document.getElementById('best-level').textContent = S.bestLevel;
    document.getElementById('best-xp').textContent = S.bestXP;
    document.getElementById('best-streak').textContent = S.bestStreak;
    syncDiffUI();
    showScreen('start-screen');
});

// Settings toggles
document.getElementById('sound-tog').addEventListener('click', () => {
    S.soundOn = !S.soundOn; savePersist(); updateHeader();
    if (S.soundOn) sfxTap();
});
document.getElementById('vib-tog').addEventListener('click', () => {
    S.vibOn = !S.vibOn; savePersist(); updateHeader();
    vibe(40);
});

// Settings diff
['easy', 'medium', 'hard'].forEach(d => {
    document.getElementById(`sg-${d}`).addEventListener('click', () => {
        S.difficulty = d; savePersist(); syncDiffUI(); updateHeader();
    });
});

// Reset
document.getElementById('reset-progress-btn').addEventListener('click', () => {
    if (confirm('Reset ALL progress? This cannot be undone.')) {
        S.level = 1; S.xp = 0; S.streak = 0; S.bestLevel = 1; S.bestXP = 0; S.bestStreak = 0;
        S.difficulty = 'easy'; savePersist();
        closeAllModals();
        syncDiffUI();
        showScreen('start-screen');
    }
});

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(o => {
    o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

// Prevent default scroll/zoom
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

// ════════════════════════════════════════════════════════════
//  PWA: Service Worker + Install Prompt
// ════════════════════════════════════════════════════════════
let deferredPrompt = null;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW Registered'))
            .catch(err => console.log('SW Registration Failed', err));
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Show the install modal after a small delay on the start screen
    setTimeout(() => {
        if (document.getElementById('start-screen').classList.contains('active')) {
            openModal('install-modal');
        }
    }, 3000);
});

document.getElementById('install-confirm-btn').addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        deferredPrompt = null;
        closeModal('install-modal');
    }
});

document.getElementById('install-cancel-btn').addEventListener('click', () => {
    closeModal('install-modal');
});

window.addEventListener('appinstalled', (evt) => {
    console.log('Tap Away was installed.');
    closeModal('install-modal');
});

// ════════════════════════════════════════════════════════════
//  INIT: update start screen from saved data, hide splash
// ════════════════════════════════════════════════════════════
document.getElementById('best-level').textContent = S.bestLevel;
document.getElementById('best-xp').textContent = S.bestXP;
document.getElementById('best-streak').textContent = S.bestStreak;
syncDiffUI();

// init AudioContext on first touch
document.addEventListener('touchstart', () => { try { actxGet(); } catch (e) { } }, { once: true });

// Hide splash
setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 600);
}, 1400);