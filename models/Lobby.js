// server/models/Lobby.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Function to generate a random word between 5-10 letters
const generateRandomWord = () => {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const wordLength = Math.floor(Math.random() * 6) + 5; // Random length between 5 and 10
  let word = '';
  for (let i = 0; i < wordLength; i++) {
    word += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return word;
};

const LobbySchema = new mongoose.Schema({
  lobbyId: { type: String, default: uuidv4, unique: true }, // Generate a unique lobbyId
  lobbyCode: { type: String, default: generateRandomWord, unique: true }, // Generate a random lobbyCode
  players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }], // Reference to Player model
  spectators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }], // Reference to Player model
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' }, // Host reference
  status: { type: String, enum: ['waiting', 'in-progress', 'finished'], default: 'waiting' },
  game: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' }, // Reference to the Game model
  createdAt: { type: Date, default: Date.now },
});

// Method to add a player to the lobby
LobbySchema.methods.addPlayer = function (player) {
  this.removeSpectator(player._id); // Remove from spectators if present
  if (!this.players.some(p => p.equals(player._id))) {
    this.players.push(player._id);
  }
};

// Method to remove a player from the lobby
LobbySchema.methods.removePlayer = function (playerId) {
  this.players = this.players.filter(id => !id.equals(playerId));
};

// Method to add a spectator to the lobby
LobbySchema.methods.addSpectator = function (spectator) {
  this.removePlayer(spectator._id); // Remove from players if present
  if (!this.spectators.some(s => s.equals(spectator._id))) {
    this.spectators.push(spectator._id);
  }
};

// Method to remove a spectator from the lobby
LobbySchema.methods.removeSpectator = function (spectatorId) {
  this.spectators = this.spectators.filter(id => !id.equals(spectatorId));
};

// Method to check if the lobby is empty
LobbySchema.methods.isEmpty = function () {
  return this.players.length === 0 && this.spectators.length === 0;
};

// Method to assign a new host
LobbySchema.methods.assignNewHost = function () {
  const eligibleHosts = [...this.players, ...this.spectators]; // Combine players and spectators
  if (eligibleHosts.length > 0) {
    // Randomly pick a new host from eligible hosts
    const randomIndex = Math.floor(Math.random() * eligibleHosts.length);
    this.host = eligibleHosts[randomIndex];
  } else {
    // No players or spectators left, set host to null
    this.host = null;
  }

};

module.exports = mongoose.model('Lobby', LobbySchema);
