const express = require('express');
const User = require('../models/User');
const Room = require('../models/Room');
const { protect, managerOrAdmin } = require('../middleware/auth');
const router = express.Router();

router.use(protect, managerOrAdmin);

// GET /api/manager/rooms
router.get('/rooms', async (req, res) => {
  try {
    const rooms = await Room.find({ status: { $ne: 'finished' } })
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/manager/users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({ role: 'player' }).select('-password').sort({ points: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/manager/users/points  { playerId, amount, operation: 'add'|'subtract' }
router.post('/users/points', async (req, res) => {
  try {
    const { playerId, amount, operation } = req.body;
    if (!playerId || amount === undefined)
      return res.status(400).json({ message: 'playerId and amount required' });

    const user = await User.findOne({ playerId });
    if (!user) return res.status(404).json({ message: 'Player not found with that ID' });

    const amt = parseInt(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ message: 'Invalid amount' });

    if (operation === 'subtract') {
      if (user.points < amt) return res.status(400).json({ message: 'Insufficient points' });
      user.points -= amt;
    } else {
      user.points += amt;
    }
    await user.save();
    res.json({ message: `Points updated for ${user.username}`, username: user.username, points: user.points });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/manager/users/:id/ban
router.patch('/users/:id/ban', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role === 'admin') return res.status(400).json({ message: 'Cannot ban admin' });
    user.isBanned = !user.isBanned;
    await user.save();
    res.json({ message: `${user.username} ${user.isBanned ? 'banned' : 'unbanned'}`, isBanned: user.isBanned });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/manager/rooms/:code/kick/:userId
router.post('/rooms/:code/kick/:userId', async (req, res) => {
  try {
    const room = await Room.findOne({ roomCode: req.params.code });
    if (!room) return res.status(404).json({ message: 'Room not found' });
    const idx = room.players.findIndex(p => p.userId.toString() === req.params.userId);
    if (idx === -1) return res.status(404).json({ message: 'Player not in room' });
    const kickedSocketId = room.players[idx].socketId;
    room.players.splice(idx, 1);
    await room.save();
    res.json({ message: 'Player kicked', kickedSocketId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
