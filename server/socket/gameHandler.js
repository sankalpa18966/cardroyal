const jwt = require('jsonwebtoken');
const Room = require('../models/Room');
const User = require('../models/User');

// ─── Card Helpers ────────────────────────────────────────────────────────────
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const SUITS = ['♠','♥','♦','♣'];

const createDeck = () => {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(rank + suit);
  return deck;
};

const shuffleDeck = (deck) => {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

const getRank = (card) => card.length === 3 ? card.slice(0, 2) : card.slice(0, 1);

// ─── Active room timers ───────────────────────────────────────────────────────
const roomTimers = {};

const clearTimer = (roomCode) => {
  if (roomTimers[roomCode]) { clearInterval(roomTimers[roomCode]); delete roomTimers[roomCode]; }
};

// ─── Sanitizers ───────────────────────────────────────────────────────────────
const sanitizeGameState = (gs) => ({
  shufflerIndex:    gs.shufflerIndex,
  chooserIndex:     gs.chooserIndex,
  chosenValue:      gs.chosenValue,
  phase:            gs.phase,
  revealedCards:    gs.revealedCards,
  winner:           gs.winner,
  winnerCard:       gs.winnerCard,
  activePlayerBets: gs.activePlayerBets,
  betsReady:        gs.betsReady,
  roundBets:        gs.roundBets,
  timerEnd:         gs.timerEnd,
  deckSize:         gs.deck?.length || 0   // never send the actual deck
});

const sanitizeRoom = (room) => ({
  _id:        room._id,
  roomCode:   room.roomCode,
  name:       room.name,
  createdBy:  room.createdBy,
  players:    room.players,
  maxPlayers: room.maxPlayers,
  status:     room.status,
  gameState:  sanitizeGameState(room.gameState)
});

const lobbyRoom = (room) => ({
  roomCode:    room.roomCode,
  name:        room.name,
  playerCount: room.players.length,
  maxPlayers:  room.maxPlayers,
  status:      room.status
});

// ─── Turn rotation ────────────────────────────────────────────────────────────
const nextTurn = (players, shufflerIdx, chooserIdx, chooserWon) => {
  const n = players.length;
  let newShufflerIdx, newChooserIdx;

  if (chooserWon) {
    newShufflerIdx = chooserIdx;
  } else {
    newShufflerIdx = shufflerIdx;
  }
  // new chooser = next clockwise from new shuffler, skip the shuffler
  newChooserIdx = (newShufflerIdx + 1) % n;
  if (newChooserIdx === newShufflerIdx) newChooserIdx = (newChooserIdx + 1) % n;

  return { newShufflerIdx, newChooserIdx };
};

// ─── Main setup ───────────────────────────────────────────────────────────────
const setupGameHandler = (io) => {

  // Socket auth middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user || user.isBanned) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch { next(new Error('Auth failed')); }
  });

  io.on('connection', (socket) => {
    const uid = socket.user._id.toString();

    // ── Lobby ────────────────────────────────────────────────────────────────
    socket.on('get-lobby', async () => {
      try {
        const rooms = await Room.find({ status: { $ne: 'finished' } }).sort({ createdAt: -1 });
        socket.emit('lobby-rooms', rooms.map(lobbyRoom));
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Create Room ───────────────────────────────────────────────────────────
    socket.on('create-room', async ({ name }) => {
      try {
        if (!name || name.trim().length < 2)
          return socket.emit('error', { message: 'Room name too short' });

        const user = await User.findById(uid);

        let roomCode, existing;
        do {
          roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
          existing = await Room.findOne({ roomCode });
        } while (existing);

        const room = await Room.create({
          roomCode, name: name.trim(), createdBy: uid,
          players: [{ userId: uid, username: user.username, points: user.points, seatIndex: 0, socketId: socket.id }],
          gameState: { phase: 'waiting', shufflerIndex: 0, chooserIndex: 1 }
        });

        socket.join(roomCode);
        socket.emit('room-created', sanitizeRoom(room));
        io.emit('lobby-update', { type: 'added', room: lobbyRoom(room) });
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Join Room ─────────────────────────────────────────────────────────────
    socket.on('join-room', async ({ roomCode }) => {
      try {
        const room = await Room.findOne({ roomCode });
        if (!room) return socket.emit('error', { message: 'Room not found' });
        if (room.status === 'finished') return socket.emit('error', { message: 'Room has ended' });
        if (room.players.length >= room.maxPlayers) return socket.emit('error', { message: 'Room is full' });

        const user = await User.findById(uid);
        if (user.isBanned) return socket.emit('error', { message: 'You are banned' });

        const existingIdx = room.players.findIndex(p => p.userId.toString() === uid);
        if (existingIdx !== -1) {
          room.players[existingIdx].socketId = socket.id;
          room.players[existingIdx].isConnected = true;
        } else {
          room.players.push({ userId: uid, username: user.username, points: user.points, seatIndex: room.players.length, socketId: socket.id });
        }

        await room.save();
        socket.join(roomCode);
        socket.emit('room-state', sanitizeRoom(room));
        socket.to(roomCode).emit('player-joined', { username: user.username, players: room.players });
        io.emit('lobby-update', { type: 'updated', room: lobbyRoom(room) });
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Leave Room ────────────────────────────────────────────────────────────
    socket.on('leave-room', async ({ roomCode }) => {
      try { await handleLeave(io, socket, roomCode); }
      catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Start Game ────────────────────────────────────────────────────────────
    socket.on('start-game', async ({ roomCode }) => {
      try {
        const room = await Room.findOne({ roomCode });
        if (!room) return socket.emit('error', { message: 'Room not found' });
        if (room.createdBy.toString() !== uid) return socket.emit('error', { message: 'Only creator can start' });
        if (room.players.length < 2) return socket.emit('error', { message: 'Need at least 2 players' });
        if (room.status === 'playing') return;

        room.status = 'playing';
        room.gameState.phase = 'shuffling';
        room.gameState.shufflerIndex = 0;
        room.gameState.chooserIndex = 1;
        await room.save();

        io.to(roomCode).emit('game-started', sanitizeRoom(room));
        io.emit('lobby-update', { type: 'updated', room: lobbyRoom(room) });
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Shuffle Deck ──────────────────────────────────────────────────────────
    socket.on('shuffle-deck', async ({ roomCode }) => {
      try {
        const room = await Room.findOne({ roomCode });
        if (!room || room.gameState.phase !== 'shuffling') return;
        const shuffler = room.players[room.gameState.shufflerIndex];
        if (!shuffler || shuffler.userId.toString() !== uid)
          return socket.emit('error', { message: 'Not your turn to shuffle' });

        room.gameState.deck = shuffleDeck(createDeck());
        room.gameState.phase = 'choosing';
        room.gameState.timerEnd = new Date(Date.now() + 120_000);
        room.gameState.revealedCards = [];
        room.gameState.winner = null; room.gameState.winnerCard = null;
        room.gameState.roundBets = []; room.gameState.betsReady = false;
        room.gameState.activePlayerBets = { shufflerBet: 0, chooserBet: 0 };
        await room.save();

        io.to(roomCode).emit('phase-changed', { phase: 'choosing', timerEnd: room.gameState.timerEnd, gameState: sanitizeGameState(room.gameState) });

        // 2-minute countdown
        clearTimer(roomCode);
        let secs = 120;
        roomTimers[roomCode] = setInterval(async () => {
          secs--;
          io.to(roomCode).emit('timer-tick', { secondsLeft: secs });
          if (secs <= 0) {
            clearTimer(roomCode);
            const r = await Room.findOne({ roomCode });
            if (r && r.gameState.phase === 'choosing') {
              const auto = RANKS[Math.floor(Math.random() * RANKS.length)];
              r.gameState.chosenValue = auto;
              r.gameState.phase = 'cutting';
              await r.save();
              io.to(roomCode).emit('phase-changed', { phase: 'cutting', chosenValue: auto, autoChosen: true, gameState: sanitizeGameState(r.gameState) });
            }
          }
        }, 1000);
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Choose Value ──────────────────────────────────────────────────────────
    socket.on('choose-value', async ({ roomCode, value }) => {
      try {
        if (!RANKS.includes(value)) return socket.emit('error', { message: 'Invalid value' });
        const room = await Room.findOne({ roomCode });
        if (!room || room.gameState.phase !== 'choosing') return;
        const chooser = room.players[room.gameState.chooserIndex];
        if (!chooser || chooser.userId.toString() !== uid)
          return socket.emit('error', { message: 'Not your turn to choose' });

        clearTimer(roomCode);
        room.gameState.chosenValue = value;
        room.gameState.phase = 'cutting';
        await room.save();

        io.to(roomCode).emit('phase-changed', { phase: 'cutting', chosenValue: value, chooserName: chooser.username, gameState: sanitizeGameState(room.gameState) });
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Cut Deck ──────────────────────────────────────────────────────────────
    socket.on('cut-deck', async ({ roomCode, cutIndex }) => {
      try {
        const room = await Room.findOne({ roomCode });
        if (!room || room.gameState.phase !== 'cutting') return;
        const chooser = room.players[room.gameState.chooserIndex];
        if (!chooser || chooser.userId.toString() !== uid)
          return socket.emit('error', { message: 'Not your turn to cut' });

        const deck = room.gameState.deck;
        const ci = Math.max(1, Math.min(parseInt(cutIndex) || 1, deck.length - 1));
        room.gameState.deck = [...deck.slice(ci), ...deck.slice(0, ci)];
        room.gameState.phase = 'betting';
        await room.save();

        io.to(roomCode).emit('phase-changed', { phase: 'betting', cutIndex: ci, gameState: sanitizeGameState(room.gameState) });
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Place Active Player Bet ───────────────────────────────────────────────
    socket.on('place-active-bet', async ({ roomCode, amount }) => {
      try {
        const room = await Room.findOne({ roomCode });
        if (!room || room.gameState.phase !== 'betting') return;
        const amt = parseInt(amount);
        if (isNaN(amt) || amt < 1) return socket.emit('error', { message: 'Invalid amount' });

        const shuffler = room.players[room.gameState.shufflerIndex];
        const chooser  = room.players[room.gameState.chooserIndex];
        const isShuffler = shuffler.userId.toString() === uid;
        const isChooser  = chooser.userId.toString() === uid;
        if (!isShuffler && !isChooser) return socket.emit('error', { message: 'Not an active player' });

        const user = await User.findById(uid);
        if (user.points < amt) return socket.emit('error', { message: 'Not enough points' });

        if (isShuffler) room.gameState.activePlayerBets.shufflerBet = amt;
        else            room.gameState.activePlayerBets.chooserBet  = amt;

        const { shufflerBet, chooserBet } = room.gameState.activePlayerBets;
        room.gameState.betsReady = (shufflerBet > 0 && chooserBet > 0 && shufflerBet === chooserBet);
        await room.save();

        io.to(roomCode).emit('bet-updated', { activePlayerBets: room.gameState.activePlayerBets, betsReady: room.gameState.betsReady });
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Place Spectator Bet ───────────────────────────────────────────────────
    socket.on('place-spectator-bet', async ({ roomCode, targetUserId, amount }) => {
      try {
        const room = await Room.findOne({ roomCode });
        if (!room || room.gameState.phase !== 'betting') return;
        const amt = parseInt(amount);
        if (isNaN(amt) || amt < 1) return socket.emit('error', { message: 'Invalid amount' });

        const shuffler = room.players[room.gameState.shufflerIndex];
        const chooser  = room.players[room.gameState.chooserIndex];
        if (shuffler.userId.toString() === uid || chooser.userId.toString() === uid)
          return socket.emit('error', { message: 'Active players cannot place spectator bets' });
        if (shuffler.userId.toString() !== targetUserId && chooser.userId.toString() !== targetUserId)
          return socket.emit('error', { message: 'Invalid target' });

        const user = await User.findById(uid);
        if (user.points < amt) return socket.emit('error', { message: 'Not enough points' });

        // Replace any existing bet from this bettor
        room.gameState.roundBets = room.gameState.roundBets.filter(b => b.bettorId.toString() !== uid);
        room.gameState.roundBets.push({ bettorId: uid, bettorName: socket.user.username, targetUserId, amount: amt });
        await room.save();

        io.to(roomCode).emit('spectator-bet-placed', { bettorName: socket.user.username, targetUserId, amount: amt });
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Run Game ──────────────────────────────────────────────────────────────
    socket.on('run-game', async ({ roomCode }) => {
      try {
        const room = await Room.findOne({ roomCode });
        if (!room || room.gameState.phase !== 'betting') return;
        const shuffler = room.players[room.gameState.shufflerIndex];
        if (!shuffler || shuffler.userId.toString() !== uid)
          return socket.emit('error', { message: 'Only shuffler can run' });

        const { shufflerBet, chooserBet } = room.gameState.activePlayerBets;
        if (!shufflerBet || !chooserBet) return socket.emit('error', { message: 'Both players must bet first' });
        if (shufflerBet !== chooserBet)  return socket.emit('error', { message: 'Bets must be equal' });

        room.gameState.phase = 'running';
        await room.save();
        io.to(roomCode).emit('phase-changed', { phase: 'running', gameState: sanitizeGameState(room.gameState) });

        revealCards(io, room.roomCode);
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Manager kick via socket ───────────────────────────────────────────────
    socket.on('manager-kick', async ({ roomCode, userId }) => {
      try {
        if (!['manager', 'admin'].includes(socket.user.role))
          return socket.emit('error', { message: 'Not authorized' });
        const room = await Room.findOne({ roomCode });
        if (!room) return;
        const idx = room.players.findIndex(p => p.userId.toString() === userId);
        if (idx === -1) return;
        const kickedSid = room.players[idx].socketId;
        room.players.splice(idx, 1);
        await room.save();
        if (kickedSid) io.to(kickedSid).emit('kicked', { message: 'You were removed by a manager' });
        io.to(roomCode).emit('room-updated', sanitizeRoom(room));
      } catch (e) { socket.emit('error', { message: e.message }); }
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      try {
        const rooms = await Room.find({ 'players.socketId': socket.id, status: { $ne: 'finished' } });
        for (const room of rooms) {
          const idx = room.players.findIndex(p => p.socketId === socket.id);
          if (idx !== -1) {
            room.players[idx].isConnected = false;
            room.players[idx].socketId = '';
            await room.save();
            io.to(room.roomCode).emit('player-left', { username: socket.user.username, players: room.players });
          }
        }
      } catch (e) { console.error('Disconnect err:', e.message); }
    });
  });
};

// ─── Card Reveal Logic ────────────────────────────────────────────────────────
const revealCards = async (io, roomCode) => {
  let cardIndex = 0;

  const step = async () => {
    const room = await Room.findOne({ roomCode });
    if (!room || room.gameState.phase !== 'running') return;

    const deck = room.gameState.deck;
    if (cardIndex >= deck.length) return; // no match found (shouldn't happen with 52 cards)

    const card      = deck[cardIndex];
    const rank      = getRank(card);
    const suit      = card.slice(-1);
    const recipient = cardIndex % 2 === 0 ? 'chooser' : 'shuffler';

    const shuffler = room.players[room.gameState.shufflerIndex];
    const chooser  = room.players[room.gameState.chooserIndex];

    room.gameState.revealedCards.push({ card, recipient });

    const isWin = rank === room.gameState.chosenValue;

    io.to(roomCode).emit('card-revealed', {
      card, rank, suit, recipient, cardIndex,
      recipientName: recipient === 'chooser' ? chooser.username : shuffler.username,
      isWinCard: isWin
    });

    if (isWin) {
      const winner = recipient === 'chooser' ? chooser : shuffler;
      const loser  = recipient === 'chooser' ? shuffler : chooser;
      room.gameState.winner    = winner.userId;
      room.gameState.winnerCard = card;
      room.gameState.phase     = 'result';
      await room.save();
      await processResult(io, roomCode, winner, loser);
      return;
    }

    await room.save();
    cardIndex++;
    setTimeout(step, 600);
  };

  setTimeout(step, 800);
};

// ─── Process Round Result ─────────────────────────────────────────────────────
const processResult = async (io, roomCode, winner, loser) => {
  const room = await Room.findOne({ roomCode });
  const betAmt = room.gameState.activePlayerBets.shufflerBet;

  // Update DB points
  await User.findByIdAndUpdate(winner.userId, { $inc: { points:  betAmt } });
  await User.findByIdAndUpdate(loser.userId,  { $inc: { points: -betAmt } });

  // Update in-room points
  const wi = room.players.findIndex(p => p.userId.toString() === winner.userId.toString());
  const li = room.players.findIndex(p => p.userId.toString() === loser.userId.toString());
  if (wi !== -1) room.players[wi].points += betAmt;
  if (li !== -1) room.players[li].points -= betAmt;

  // Spectator bets
  const specResults = [];
  for (const bet of room.gameState.roundBets) {
    const won = bet.targetUserId.toString() === winner.userId.toString();
    const delta = won ? bet.amount : -bet.amount;
    await User.findByIdAndUpdate(bet.bettorId, { $inc: { points: delta } });
    const si = room.players.findIndex(p => p.userId.toString() === bet.bettorId.toString());
    if (si !== -1) room.players[si].points += delta;
    specResults.push({ bettorName: bet.bettorName, won, amount: bet.amount });
  }

  // Turn rotation
  const chooserWon = winner.userId.toString() === room.players[room.gameState.chooserIndex].userId.toString();
  const { newShufflerIdx, newChooserIdx } = nextTurn(room.players, room.gameState.shufflerIndex, room.gameState.chooserIndex, chooserWon);

  io.to(roomCode).emit('game-result', {
    winner: { userId: winner.userId, username: winner.username },
    loser:  { userId: loser.userId,  username: loser.username },
    winnerCard: room.gameState.winnerCard,
    betAmount: betAmt,
    specResults,
    nextShuffler: room.players[newShufflerIdx]?.username,
    nextChooser:  room.players[newChooserIdx]?.username
  });

  // Reset for next round
  room.gameState.shufflerIndex = newShufflerIdx;
  room.gameState.chooserIndex  = newChooserIdx;
  room.gameState.phase         = 'shuffling';
  room.gameState.deck          = [];
  room.gameState.revealedCards = [];
  room.gameState.chosenValue   = null;
  room.gameState.winner        = null;
  room.gameState.winnerCard    = null;
  room.gameState.betsReady     = false;
  room.gameState.activePlayerBets = { shufflerBet: 0, chooserBet: 0 };
  room.gameState.roundBets     = [];
  await room.save();

  // Transition to next round after 5s
  setTimeout(async () => {
    const r = await Room.findOne({ roomCode });
    if (r && r.gameState.phase === 'shuffling') {
      io.to(roomCode).emit('phase-changed', { phase: 'shuffling', gameState: sanitizeGameState(r.gameState) });
    }
  }, 5000);
};

// ─── Handle Player Leave ──────────────────────────────────────────────────────
const handleLeave = async (io, socket, roomCode) => {
  const room = await Room.findOne({ roomCode });
  if (!room) return;
  const idx = room.players.findIndex(p => p.userId.toString() === socket.user._id.toString());
  if (idx === -1) return;

  room.players.splice(idx, 1);
  socket.leave(roomCode);

  if (room.players.length === 0) {
    room.status = 'finished';
    await room.save();
    io.emit('lobby-update', { type: 'removed', roomCode });
    return;
  }

  if (room.gameState.phase !== 'waiting' && room.players.length < 2) {
    clearTimer(roomCode);
    room.gameState.phase = 'waiting';
    room.status = 'waiting';
  } else {
    if (room.gameState.shufflerIndex >= room.players.length) room.gameState.shufflerIndex = 0;
    if (room.gameState.chooserIndex  >= room.players.length ||
        room.gameState.chooserIndex  === room.gameState.shufflerIndex) {
      room.gameState.chooserIndex = (room.gameState.shufflerIndex + 1) % room.players.length;
    }
  }

  await room.save();
  io.to(roomCode).emit('player-left', { username: socket.user.username, players: room.players, gameState: sanitizeGameState(room.gameState) });
  io.emit('lobby-update', { type: 'updated', room: lobbyRoom(room) });
};

module.exports = { setupGameHandler };
