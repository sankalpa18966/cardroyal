const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['admin', 'manager', 'player'], default: 'player' },
  points:   { type: Number, default: 100 },
  isBanned: { type: Boolean, default: false },
  playerId: { type: String, unique: true }
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.playerId) {
    this.playerId = 'P' + Math.random().toString(36).substr(2, 8).toUpperCase();
  }
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);
