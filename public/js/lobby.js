// ── Auth Guard ────────────────────────────────────────────────────────────────
const token = localStorage.getItem('token');
const user  = JSON.parse(localStorage.getItem('user') || 'null');
if (!token || !user) { location.href = '/'; }

document.getElementById('nav-user').textContent   = user.username;
document.getElementById('nav-points').textContent = '🏆 ' + (user.points ?? 0) + ' pts';

function logout() { localStorage.clear(); location.href = '/'; }

// ── Socket ────────────────────────────────────────────────────────────────────
const socket = io({ auth: { token } });

socket.on('connect_error', (e) => { if (e.message.includes('auth') || e.message.includes('banned')) { localStorage.clear(); location.href = '/'; } });

// ── Rooms State ───────────────────────────────────────────────────────────────
let rooms = [];

const container = document.getElementById('rooms-container');

function renderRooms() {
  if (rooms.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🃏</div><p style="font-size:1rem;font-weight:600;margin-bottom:6px;">No rooms yet</p><p>Create the first room and invite friends!</p></div>`;
    return;
  }
  container.innerHTML = `<div class="rooms-grid">${rooms.map(r => roomCard(r)).join('')}</div>`;
}

function roomCard(r) {
  const statusBadge = r.status === 'playing'
    ? `<span class="badge badge-playing">Playing</span>`
    : `<span class="badge badge-waiting">Waiting</span>`;
  const isFull = r.playerCount >= r.maxPlayers;
  return `
    <div class="room-card" onclick="joinRoom('${r.roomCode}')">
      <div class="room-card-top">
        <div><div class="room-name">${escHtml(r.name)}</div><div class="room-code">${r.roomCode}</div></div>
        ${statusBadge}
      </div>
      <div class="room-meta">
        <span>👥 ${r.playerCount}/${r.maxPlayers}</span>
        <span>${r.status === 'playing' ? '🎮 In Progress' : '🕐 Open'}</span>
      </div>
      <div class="room-action">
        <button class="btn btn-gold btn-sm btn-full" ${isFull ? 'disabled' : ''}>
          ${isFull ? 'Room Full' : 'Join Room'}
        </button>
      </div>
    </div>`;
}

function escHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

// ── Join Room ─────────────────────────────────────────────────────────────────
function joinRoom(roomCode) {
  socket.emit('join-room', { roomCode });
}

socket.on('room-state', (room) => {
  localStorage.setItem('currentRoom', room.roomCode);
  location.href = '/game?room=' + room.roomCode;
});

socket.on('room-created', (room) => {
  localStorage.setItem('currentRoom', room.roomCode);
  location.href = '/game?room=' + room.roomCode;
});

socket.on('error', (e) => {
  const err = document.getElementById('create-err');
  if (err) { err.textContent = e.message; err.classList.add('show'); }
  else alert(e.message);
});

// ── Lobby updates ─────────────────────────────────────────────────────────────
socket.on('lobby-rooms', (data) => { rooms = data; renderRooms(); });

socket.on('lobby-update', ({ type, room, roomCode }) => {
  if (type === 'added')   { rooms.unshift(room); }
  if (type === 'updated') { const i = rooms.findIndex(r => r.roomCode === room.roomCode); if (i !== -1) rooms[i] = room; else rooms.unshift(room); }
  if (type === 'removed') { rooms = rooms.filter(r => r.roomCode !== roomCode); }
  renderRooms();
});

socket.on('connect', () => socket.emit('get-lobby'));

// ── Create Modal ──────────────────────────────────────────────────────────────
function openCreate() {
  document.getElementById('create-modal').classList.add('show');
  document.getElementById('room-name').focus();
}
function closeCreate() {
  document.getElementById('create-modal').classList.remove('show');
  document.getElementById('create-err').classList.remove('show');
}

document.getElementById('create-confirm-btn').addEventListener('click', () => {
  const name = document.getElementById('room-name').value.trim();
  const err  = document.getElementById('create-err');
  err.classList.remove('show');
  if (!name) { err.textContent = 'Please enter a room name'; err.classList.add('show'); return; }
  document.getElementById('create-confirm-btn').disabled = true;
  socket.emit('create-room', { name });
  setTimeout(() => { document.getElementById('create-confirm-btn').disabled = false; }, 2000);
});

document.getElementById('room-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('create-confirm-btn').click(); });
