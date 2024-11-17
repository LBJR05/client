// models/Player.js
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  uuid: { type: String, required: true, unique: true },
  nickname: { type: String, required: true },
  lastActive: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Player', playerSchema);