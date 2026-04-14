const mongoose = require('mongoose');

const playerSlotSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  username:    String,
  points:      Number,
  seatIndex:   Number,
  socketId:    String,
  isConnected: { type: Boolean, default: true }
}, { _id: false });

const betSchema = new mongoose.Schema({
  bettorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  bettorName:   String,
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  amount:       Number
}, { _id: false });

const revealedCardSchema = new mongoose.Schema({
  card:      String,
  recipient: { type: String, enum: ['chooser', 'shuffler'] }
}, { _id: false });

const gameStateSchema = new mongoose.Schema({
  deck:           { type: [String], default: [] },
  shufflerIndex:  { type: Number, default: 0 },
  chooserIndex:   { type: Number, default: 1 },
  chosenValue:    { type: String, default: null },
  phase: {
    type: String,
    enum: ['waiting', 'shuffling', 'choosing', 'cutting', 'betting', 'running', 'result'],
    default: 'waiting'
  },
  revealedCards:   { type: [revealedCardSchema], default: [] },
  winner:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  winnerCard:      { type: String, default: null },
  activePlayerBets: {
    shufflerBet: { type: Number, default: 0 },
    chooserBet:  { type: Number, default: 0 }
  },
  betsReady: { type: Boolean, default: false },
  roundBets: { type: [betSchema], default: [] },
  timerEnd:  { type: Date, default: null }
}, { _id: false });

const roomSchema = new mongoose.Schema({
  roomCode:   { type: String, unique: true, required: true },
  name:       { type: String, required: true },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  players:    { type: [playerSlotSchema], default: [] },
  maxPlayers: { type: Number, default: 20 },
  status:     { type: String, enum: ['waiting', 'playing', 'finished'], default: 'waiting' },
  gameState:  { type: gameStateSchema, default: () => ({}) }
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
