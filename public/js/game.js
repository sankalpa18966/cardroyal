// ── Auth & init ───────────────────────────────────────────────────────────────
const token = localStorage.getItem('token');
const ME    = JSON.parse(localStorage.getItem('user') || 'null');
if (!token || !ME) { location.href = '/'; }

// ── Pile state ────────────────────────────────────────────────────────────────
const pileState = { chooser: [], shuffler: [] };

const roomCode = new URLSearchParams(location.search).get('room');
if (!roomCode) { location.href = '/lobby'; }

document.getElementById('nav-user').textContent     = ME.username;
document.getElementById('nav-points').textContent   = '🏆 ' + (ME.points ?? 0) + ' pts';
document.getElementById('room-code-nav').textContent = roomCode;

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io({ auth: { token } });
socket.on('connect_error', () => { localStorage.clear(); location.href = '/'; });

let roomState   = null;
let timerInterval = null;
let cutPending   = false;  // true when cut point is visually selected (server picks actual cut)
let specTarget   = null;

// ── Room join ─────────────────────────────────────────────────────────────────
socket.on('connect', () => socket.emit('join-room', { roomCode }));

socket.on('room-state',   applyRoomState);
socket.on('game-started', applyRoomState);
socket.on('room-updated', applyRoomState);

socket.on('player-joined', ({ players }) => { if (roomState) { roomState.players = players; renderSeats(); renderPlayersList(); } addLog('A player joined', 'info'); SFX.join(); });
socket.on('player-left',   ({ username, players, gameState }) => {
  if (roomState) { roomState.players = players; if (gameState) roomState.gameState = gameState; renderSeats(); renderPlayersList(); applyPhase(); }
  addLog(username + ' left the room', 'info');
});

socket.on('phase-changed', ({ phase, timerEnd, chosenValue, cutIndex, gameState, autoChosen, chooserName }) => {
  if (roomState) { roomState.gameState = { ...roomState.gameState, ...gameState, phase }; }
  if (timerEnd)    roomState.gameState.timerEnd = timerEnd;
  if (chosenValue) roomState.gameState.chosenValue = chosenValue;

  if (phase === 'choosing') {
    // Show shuffle animation for 3 seconds, then switch to choosing UI
    showShuffleAnimation(3000, () => {
      applyPhase();
      if (timerEnd) startTimer(new Date(timerEnd));
    });
    if (autoChosen) addLog(`Time's up! Auto-chosen: ${chosenValue}`, 'gold');
    if (chooserName) addLog(`${chooserName} chose "${chosenValue}"`, 'gold');
    return;
  }

  applyPhase();
  if (phase === 'cutting' && autoChosen) addLog(`Time's up! Auto-chosen: ${chosenValue}`, 'gold');
  if (phase === 'cutting' && chooserName) addLog(`${chooserName} chose "${chosenValue}"`, 'gold');
  if (phase === 'betting') { stopTimer(); updateChosenDisplays(); showBetPanels(); }
  if (phase === 'running') { stopTimer(); showRunningPhase(); }
  if (phase === 'shuffling') { document.getElementById('result-overlay').classList.remove('show'); resetRunning(); applyPhase(); }
});

socket.on('timer-tick', ({ secondsLeft }) => updateTimerDisplay(secondsLeft));

socket.on('card-revealed', ({ card, rank, suit, recipient, cardIndex, recipientName, isWinCard }) => {
  addCardToTable(card, rank, suit, recipient, isWinCard);
  addLog(`Card ${cardIndex + 1}: ${card} → ${recipientName}`, isWinCard ? 'win' : '');
  if (isWinCard) setTimeout(() => SFX.winCard(), 190); // play after flip
});

socket.on('bet-updated', ({ activePlayerBets, betsReady }) => {
  if (roomState) roomState.gameState.activePlayerBets = activePlayerBets;
  if (roomState) roomState.gameState.betsReady = betsReady;
  updateBetStatus(activePlayerBets, betsReady);
});

socket.on('spectator-bet-placed', ({ bettorName, targetUserId, amount }) => {
  addLog(`${bettorName} bet ${amount} pts`, 'info');
  renderSpecBetsList();
});

socket.on('game-result', ({ winner, loser, winnerCard, betAmount, specResults, nextShuffler, nextChooser }) => {
  const isWinner = winner.userId === ME.id || winner.userId === ME._id;
  showResult(winner.username, loser.username, winnerCard, betAmount, isWinner, nextShuffler, nextChooser, specResults);
  // Update local points
  if (isWinner) { ME.points += betAmount; } else { ME.points -= betAmount; }
  localStorage.setItem('user', JSON.stringify(ME));
  document.getElementById('nav-points').textContent = '🏆 ' + ME.points + ' pts';
});

socket.on('kicked', () => { alert('You have been removed from the room.'); location.href = '/lobby'; });
socket.on('error',  (e) => { addLog('Error: ' + e.message, 'lose'); });

// ── Apply full room state ─────────────────────────────────────────────────────
function applyRoomState(room) {
  roomState = room;
  renderSeats();
  renderPlayersList();
  applyPhase();
  updateChosenDisplays();

  const isCreator = room.createdBy === ME.id || room.createdBy === ME._id ||
    (room.createdBy && room.createdBy.toString && room.createdBy.toString() === (ME.id || ME._id));
  const canStart = isCreator && room.players.length >= 2 && room.status === 'waiting';
  document.getElementById('start-btn').style.display = canStart ? 'inline-flex' : 'none';
}

// ── Phase display ─────────────────────────────────────────────────────────────
const PHASES = ['waiting','shuffling','choosing','cutting','betting','running'];
function applyPhase() {
  if (!roomState) return;
  const gs = roomState.gameState;
  const phase = gs.phase;

  document.getElementById('phase-label').textContent = phase.charAt(0).toUpperCase() + phase.slice(1);

  PHASES.forEach(p => {
    const el = document.getElementById('phase-' + p);
    if (el) el.style.display = 'none';
  });
  const activeEl = document.getElementById('phase-' + phase);
  if (activeEl) activeEl.style.display = 'flex';
  document.getElementById('phase-running').style.display = (phase === 'running') ? 'flex' : 'none';

  const players = roomState.players;
  const shuffler = players[gs.shufflerIndex];
  const chooser  = players[gs.chooserIndex];
  const myId     = ME.id || ME._id;
  const isMe     = (p) => p && p.userId && (p.userId === myId || p.userId.toString() === myId);

  if (phase === 'shuffling') {
    document.getElementById('shuffler-label').textContent = shuffler ? `${shuffler.username} must shuffle` : '…';
    document.getElementById('shuffle-btn').style.display = isMe(shuffler) ? 'inline-flex' : 'none';
  }
  if (phase === 'choosing') {
    document.getElementById('chooser-label').textContent = chooser ? `${chooser.username} must choose a value` : '…';
    buildValueGrid(isMe(chooser));
    if (gs.timerEnd) startTimer(new Date(gs.timerEnd));
  }
  if (phase === 'cutting') {
    document.getElementById('chosen-val-display').textContent = gs.chosenValue || '—';
    document.getElementById('cut-label').textContent = chooser ? `${chooser.username} must cut the deck` : '…';
    document.getElementById('cut-btn').style.display = isMe(chooser) ? 'inline-flex' : 'none';
  }
  if (phase === 'betting') { showBetPanels(); }
  if (phase === 'running') { showRunningPhase(); }

  // waiting: show start button for creator if 2+ players
  if (phase === 'waiting') {
    const isCreator = roomState.createdBy === myId;
    document.getElementById('start-btn').style.display = (isCreator && roomState.players.length >= 2) ? 'inline-flex' : 'none';
    document.getElementById('waiting-msg').textContent = `Players: ${roomState.players.length}/20 (need at least 2)`;
  }
}

// ── Seat layout (circular) ────────────────────────────────────────────────────
function renderSeats() {
  if (!roomState) return;
  const players = roomState.players;
  const gs = roomState.gameState;
  const container = document.getElementById('seats-container');
  const n = players.length;

  container.innerHTML = players.map((p, i) => {
    const angle  = (i / n) * 2 * Math.PI - Math.PI / 2;
    // Place seats on an ellipse around the table (as % of container)
    const rx = 44, ry = 40; // percent radii
    const x = 50 + rx * Math.cos(angle);
    const y = 50 + ry * Math.sin(angle);
    const isShuffler = i === gs.shufflerIndex;
    const isChooser  = i === gs.chooserIndex;
    const roleClass  = isShuffler ? 'shuffler' : isChooser ? 'chooser' : '';
    const suits = ['♠','♥','♦','♣'];
    const emoji = suits[i % 4];
    const isMe  = p.userId === (ME.id || ME._id);
    return `
      <div class="seat ${roleClass} ${!p.isConnected ? 'disconnected' : ''}"
           style="left:${x}%;top:${y}%;transform:translate(-50%,-50%);" title="${p.username}">
        <div class="seat-avatar">${emoji}</div>
        <div class="seat-name">${isMe ? '⭐ ' : ''}${p.username}</div>
        <div class="seat-points">🏆 ${p.points}</div>
        ${isShuffler ? '<div class="seat-role-badge">Shuffler</div>' : isChooser ? '<div class="seat-role-badge" style="background:rgba(91,141,238,0.15);color:var(--blue);">Chooser</div>' : ''}
      </div>`;
  }).join('');
}

function renderPlayersList() {
  if (!roomState) return;
  const list = document.getElementById('players-list');
  list.innerHTML = roomState.players.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.82rem;">
      <span style="color:var(--text);">${p.username} ${p.userId === (ME.id || ME._id) ? '(you)' : ''}</span>
      <span style="color:var(--gold);font-weight:700;">🏆 ${p.points}</span>
    </div>`).join('');
}

function renderSpecBetsList() {
  if (!roomState) return;
  const bets = roomState.gameState.roundBets || [];
  const el   = document.getElementById('spec-bets-list');
  el.innerHTML = bets.length === 0 ? 'None yet' :
    bets.map(b => `<div style="margin-bottom:4px;">${b.bettorName}: ${b.amount} pts</div>`).join('');
}

// ── Value Grid ────────────────────────────────────────────────────────────────
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
let selectedValue = null;

function buildValueGrid(isChooser) {
  const grid = document.getElementById('value-grid');
  grid.style.display = isChooser ? 'grid' : 'none';
  if (!isChooser) return;
  grid.innerHTML = RANKS.map(r => `<button class="value-btn" onclick="selectValue('${r}')">${r}</button>`).join('');
}

function selectValue(v) {
  selectedValue = v;
  document.querySelectorAll('.value-btn').forEach(b => b.classList.toggle('selected', b.textContent === v));
  socket.emit('choose-value', { roomCode, value: v });
}

// ── Timer ─────────────────────────────────────────────────────────────────────
const TOTAL = 120;
const CIRC  = 2 * Math.PI * 34; // 213.6

function startTimer(endTime) {
  stopTimer();
  function tick() {
    const left = Math.max(0, Math.round((new Date(endTime) - Date.now()) / 1000));
    updateTimerDisplay(left);
    if (left <= 0) stopTimer();
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

function updateTimerDisplay(secs) {
  const circle = document.getElementById('timer-circle');
  const text   = document.getElementById('timer-text');
  const ring   = document.getElementById('timer-ring');
  if (!circle || !text) return;
  const frac   = secs / TOTAL;
  circle.style.strokeDashoffset = CIRC * (1 - frac);
  const m = Math.floor(secs / 60), s = secs % 60;
  text.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  const urgent = secs <= 30;
  ring.classList.toggle('urgent', urgent);
  if (urgent && secs > 0) SFX.tick();
}

// ── Cut UI ────────────────────────────────────────────────────────────────────
let cutY = null;

function showCutUI() { document.getElementById('cut-overlay').classList.add('show'); }
function hideCutUI() { document.getElementById('cut-overlay').classList.remove('show'); cutY = null; document.getElementById('cut-indicator').classList.remove('show'); document.getElementById('cut-confirm-btn').style.display = 'none'; }

document.getElementById('cut-stack').addEventListener('mousemove', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const y    = e.clientY - rect.top;
  const ind  = document.getElementById('cut-indicator');
  ind.style.top = y + 'px';
  ind.classList.add('show');
});

document.getElementById('cut-stack').addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  cutY = e.clientY - rect.top;
  // Visual only — server generates the actual secure random cut point
  cutPending = true;
  document.getElementById('cut-confirm-btn').style.display = 'inline-flex';
  addLog('Cut point selected — server will apply a secure random cut', 'info');
});

function confirmCut() {
  if (!cutPending) return;
  // Only roomCode sent — server ignores any cutIndex and picks its own crypto-random point
  socket.emit('cut-deck', { roomCode });
  hideCutUI();
  addLog('Deck cut! 🔀', 'gold');
}

// ── Bet panels ────────────────────────────────────────────────────────────────
function showBetPanels() {
  if (!roomState) return;
  const gs = roomState.gameState;
  const myId = ME.id || ME._id;
  const shuffler = roomState.players[gs.shufflerIndex];
  const chooser  = roomState.players[gs.chooserIndex];
  const isActive = (shuffler && shuffler.userId === myId) || (chooser && chooser.userId === myId);
  const isShuffler = shuffler && shuffler.userId === myId;

  document.getElementById('active-bet-panel').style.display = isActive ? 'block' : 'none';
  document.getElementById('spec-bet-panel').style.display   = !isActive ? 'block' : 'none';
  updateChosenDisplays();
  updateBetStatus(gs.activePlayerBets, gs.betsReady);

  // Spectator targets
  const targets = document.getElementById('spec-targets');
  if (targets && shuffler && chooser) {
    targets.innerHTML = `
      <button class="btn btn-sm ${specTarget === shuffler.userId ? 'btn-gold' : 'btn-ghost'}" onclick="selectSpecTarget('${shuffler.userId}')">🔀 ${shuffler.username}</button>
      <button class="btn btn-sm ${specTarget === chooser.userId ? 'btn-blue' : 'btn-ghost'}"  onclick="selectSpecTarget('${chooser.userId}')">🎯 ${chooser.username}</button>`;
  }

  // Run button for shuffler only
  document.getElementById('run-btn').style.display = isShuffler ? 'inline-flex' : 'none';
}

function selectSpecTarget(userId) {
  specTarget = userId;
  showBetPanels();
}

function placeActiveBet() {
  const amt = parseInt(document.getElementById('active-bet-input').value);
  if (!amt || amt < 1) return addLog('Enter a valid bet amount', 'lose');
  socket.emit('place-active-bet', { roomCode, amount: amt });
  SFX.coin();
  addLog('Bet placed: ' + amt + ' pts', 'info');
}

function placeSpecBet() {
  if (!specTarget) return addLog('Select a player to bet on first', 'lose');
  const amt = parseInt(document.getElementById('spec-bet-input').value);
  if (!amt || amt < 1) return addLog('Enter a valid bet amount', 'lose');
  socket.emit('place-spectator-bet', { roomCode, targetUserId: specTarget, amount: amt });
  SFX.coin();
  addLog('Spectator bet placed: ' + amt + ' pts', 'info');
}

function updateBetStatus(bets, ready) {
  const el = document.getElementById('active-bet-status');
  if (!el) return;
  if (ready) { el.textContent = '✅ Bets matched! Shuffler can now RUN.'; el.className = 'bet-status matched'; }
  else        { el.textContent = `Shuffler: ${bets.shufflerBet || 0} pts | Chooser: ${bets.chooserBet || 0} pts`; el.className = 'bet-status'; }
  document.getElementById('run-status').textContent = ready ? 'Both bets placed — click RUN' : 'Waiting for equal bets…';
}

function updateChosenDisplays() {
  const v = roomState?.gameState?.chosenValue || '—';
  ['chosen-val-display','chosen-val-bet','chosen-val-run'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = v;
  });
}

// ── Running / card reveal ─────────────────────────────────────────────────────
let dealtCount = 0;

function showRunningPhase() {
  PHASES.forEach(p => { const el = document.getElementById('phase-' + p); if (el) el.style.display = 'none'; });
  document.getElementById('phase-running').style.display = 'flex';

  pileState.chooser  = [];
  pileState.shuffler = [];
  dealtCount = 0;

  document.getElementById('chooser-cards').innerHTML  = '';
  document.getElementById('shuffler-cards').innerHTML = '';

  const cp = document.getElementById('center-pack');
  if (cp) cp.classList.remove('depleted', 'empty');

  if (roomState) {
    const gs = roomState.gameState;
    const shuffler = roomState.players[gs.shufflerIndex];
    const chooser  = roomState.players[gs.chooserIndex];
    document.getElementById('chooser-pile-label').textContent  = (chooser?.username  || 'Chooser')  + ' (Chooser)';
    document.getElementById('shuffler-pile-label').textContent = (shuffler?.username || 'Shuffler') + ' (Shuffler)';
    updateChosenDisplays();
  }
}

function resetRunning() {
  document.getElementById('chooser-cards').innerHTML  = '';
  document.getElementById('shuffler-cards').innerHTML = '';
  document.getElementById('phase-running').style.display = 'none';
  pileState.chooser  = [];
  pileState.shuffler = [];
  dealtCount = 0;
  const flyEl = document.getElementById('deal-fly-card');
  if (flyEl) flyEl.style.display = 'none';
  specTarget = null; cutPending = false;
}


// ── Card HTML builder ─────────────────────────────────────────────────────────
function buildCardHTML(rank, suit, isWin, noAnim = false) {
  const isRed    = suit === '♥' || suit === '♦';
  const colorCls = isRed ? 'red' : 'black';
  const winCls   = isWin ? ' win-card' : '';
  const animCls  = noAnim ? ' no-anim' : '';
  let inner = '';

  if (rank === 'A') {
    inner = `
      <div class="card-corner tl"><span class="corner-rank">A</span><span class="corner-suit">${suit}</span></div>
      <div class="card-ace-center"><span class="ace-pip">${suit}</span></div>
      <div class="card-corner br"><span class="corner-rank">A</span><span class="corner-suit">${suit}</span></div>`;
  } else if (['J','Q','K'].includes(rank)) {
    inner = `
      <div class="card-corner tl"><span class="corner-rank">${rank}</span><span class="corner-suit">${suit}</span></div>
      <div class="card-face-badge">
        <span class="face-letter">${rank}</span>
        <span class="face-suit-row">${suit} ${suit}</span>
      </div>
      <div class="card-corner br"><span class="corner-rank">${rank}</span><span class="corner-suit">${suit}</span></div>`;
    return `<div class="playing-card ${colorCls} face-card${winCls}${animCls}">${inner}</div>`;
  } else {
    inner = `
      <div class="card-corner tl"><span class="corner-rank">${rank}</span><span class="corner-suit">${suit}</span></div>
      <div class="card-center-pip">${suit}</div>
      <div class="card-corner br"><span class="corner-rank">${rank}</span><span class="corner-suit">${suit}</span></div>`;
  }
  return `<div class="playing-card ${colorCls}${winCls}${animCls}">${inner}</div>`;
}

function renderPile(pKey) {
  const cards = pileState[pKey];
  if (!cards.length) return '';
  const top   = cards[cards.length - 1];
  const count = cards.length;
  // Top card always no-anim (animation handled by fly card)
  const cardHTML = buildCardHTML(top.rank, top.suit, top.isWin, true);
  return `<div class="card-pile">
    ${count >= 3 ? '<div class="pile-ghost pile-ghost-2"></div>' : ''}
    ${count >= 2 ? '<div class="pile-ghost pile-ghost-1"></div>' : ''}
    <div class="pile-top-card">${cardHTML}</div>
    ${count > 1 ? `<div class="pile-count-badge">×${count}</div>` : ''}
  </div>`;
}

function addCardToTable(card, rank, suit, recipient, isWin) {
  animateDeal(rank, suit, recipient, isWin, () => {
    pileState[recipient].push({ card, rank, suit, isWin });
    const pileEl = document.getElementById(recipient === 'chooser' ? 'chooser-cards' : 'shuffler-cards');
    pileEl.innerHTML = renderPile(recipient);
    // Update center deck visual depletion
    dealtCount++;
    const cp = document.getElementById('center-pack');
    if (cp) {
      if (dealtCount >= 40) cp.classList.add('empty');
      else if (dealtCount >= 20) cp.classList.add('depleted');
    }
  });
}

// Deal card fly animation from center deck to target pile
function animateDeal(rank, suit, recipient, isWin, onLand) {
  const flyEl    = document.getElementById('deal-fly-card');
  const deckEl   = document.getElementById('center-pack');
  const targetEl = document.getElementById(recipient === 'chooser' ? 'chooser-cards' : 'shuffler-cards');

  if (!flyEl || !deckEl || !targetEl) { onLand(); return; }

  const deckRect   = deckEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  const tx = targetRect.left + (targetRect.width  / 2) - 35;
  const ty = targetRect.top  + (targetRect.height / 2) - 50;
  const rot = recipient === 'chooser' ? -8 : 8;

  flyEl.style.cssText = `
    position:fixed; z-index:1000; width:70px; height:100px;
    border-radius:8px; pointer-events:none; overflow:hidden;
    left:${deckRect.left}px; top:${deckRect.top}px;
    background:linear-gradient(145deg,#1e4db7 0%,#2e82ff 50%,#1a3a8c 100%);
    border:1.5px solid rgba(255,255,255,0.25);
    box-shadow:4px 6px 20px rgba(0,0,0,0.8);
    display:block; transition:none; transform:rotate(0deg); opacity:1;`;
  flyEl.innerHTML = '<div class="card-back-pattern"></div>';

  SFX.cardWhoosh(); // 🔊 whoosh on departure

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flyEl.style.transition =
        'left 0.38s cubic-bezier(0.23,1,0.32,1),'
      + 'top 0.38s cubic-bezier(0.23,1,0.32,1),'
      + 'transform 0.38s ease';
      flyEl.style.left      = tx + 'px';
      flyEl.style.top       = ty + 'px';
      flyEl.style.transform = `rotate(${rot}deg) scale(0.95)`;

      setTimeout(() => {
        SFX.cardFlip(); // 🔊 flip sound at midpoint
        flyEl.style.background = '';
        flyEl.style.border     = '';
        flyEl.innerHTML = buildCardHTML(rank, suit, isWin, true);
      }, 190);

      setTimeout(() => {
        SFX.cardLand(); // 🔊 thud on landing
        flyEl.style.display = 'none';
        onLand();
      }, 420);
    });
  });
}

// ── Shuffle Animation ─────────────────────────────────────────────────────────
function showShuffleAnimation(durationMs, onDone) {
  const overlay  = document.getElementById('shuffle-anim');
  const bar      = document.getElementById('shuffle-bar');
  const hint     = document.getElementById('shuffle-hint');
  const flyCard  = document.getElementById('fly-card');
  overlay.classList.add('show');

  SFX.shuffle(durationMs); // 🔊 card shuffle sounds
  const hints = ['Randomizing order…', 'Mixing cards…', 'Almost ready…', 'Deck is ready!'];
  let hintIdx = 0;

  // Progress bar
  const startTime = Date.now();
  const barInterval = setInterval(() => {
    const pct = Math.min(100, ((Date.now() - startTime) / durationMs) * 100);
    bar.style.width = pct + '%';
    if (pct >= 100) clearInterval(barInterval);
  }, 80);

  // Hint text cycle
  const hintInterval = setInterval(() => {
    hintIdx = (hintIdx + 1) % hints.length;
    hint.textContent = hints[hintIdx];
  }, durationMs / hints.length);

  // Flying card animation loop
  let flyCount = 0;
  const maxFlies = Math.floor(durationMs / 400);
  const flyInterval = setInterval(() => {
    flyCard.classList.remove('flying');
    void flyCard.offsetWidth; // reflow
    flyCard.classList.add('flying');
    flyCount++;
    if (flyCount >= maxFlies) clearInterval(flyInterval);
  }, 400);

  setTimeout(() => {
    clearInterval(barInterval);
    clearInterval(hintInterval);
    clearInterval(flyInterval);
    overlay.classList.remove('show');
    bar.style.width = '0%';
    hint.textContent = 'Preparing your deck…';
    if (onDone) onDone();
  }, durationMs);
}

// ── Result overlay ────────────────────────────────────────────────────────────
function showResult(winner, loser, winnerCard, betAmt, isWinner, nextShuffler, nextChooser, specResults) {
  document.getElementById('result-emoji').textContent = isWinner ? '🏆' : '😢';
  const title = document.getElementById('result-title');
  title.textContent = isWinner ? 'You Won!' : winner + ' Wins!';
  title.className = 'result-title ' + (isWinner ? 'win' : 'lose');
  document.getElementById('result-detail').textContent =
    `Winning card: ${winnerCard} | Bet: ${betAmt} points`;
  document.getElementById('result-next').textContent =
    `Next round → Shuffler: ${nextShuffler} | Chooser: ${nextChooser}`;
  document.getElementById('result-overlay').classList.add('show');
  // Sound
  setTimeout(() => isWinner ? SFX.win() : SFX.lose(), 100);

  let secs = 5;
  const cdEl = document.getElementById('result-countdown');
  const cd = setInterval(() => {
    secs--;
    cdEl.textContent = secs;
    if (secs <= 0) clearInterval(cd);
  }, 1000);

  addLog(isWinner ? `🏆 You won ${betAmt} pts!` : `😢 ${winner} wins. You lost ${betAmt} pts.`, isWinner ? 'win' : 'lose');
}

// ── Actions ───────────────────────────────────────────────────────────────────
function startGame()  { SFX.click(); socket.emit('start-game',  { roomCode }); SFX.gameStart(); }
function shuffleDeck(){ SFX.click(); socket.emit('shuffle-deck', { roomCode }); addLog('Deck shuffled!', 'gold'); }
function runGame()    { SFX.click(); socket.emit('run-game',     { roomCode }); }
function leaveRoom()  { socket.emit('leave-room',   { roomCode }); location.href = '/lobby'; }

function toggleMute() {
  const muted = SFX.toggleMute();
  document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog(msg, type = '') {
  const log = document.getElementById('game-log');
  const el  = document.createElement('div');
  el.className = 'log-entry ' + type;
  el.textContent = msg;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}
