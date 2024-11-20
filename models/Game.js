const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
  lobby: { type: mongoose.Schema.Types.ObjectId, ref: 'Lobby', required: true }, // Link the game to the lobby
  secretNumber: { type: Number, default: null }, // The secret number for the game
  rounds: { type: Number, default: 1 }, // Example: Number of rounds in the game
  status: { type: String, enum: ['waiting', 'in-progress', 'finished'], default: 'waiting' }, // Game status
  createdAt: { type: Date, default: Date.now },
});

// Method to generate a random secret number
GameSchema.methods.generateSecretNumber = function () {
  this.secretNumber = Math.floor(Math.random() * 10) + 1;
  return this.secretNumber;
};

// Method to start the game
GameSchema.methods.start = function () {
  if (this.status !== 'waiting') {
    throw new Error('Game is already in progress or finished.');
  }
  this.status = 'in-progress';
  this.generateSecretNumber(); // Generate a secret number when the game starts
};

// Method to end the game
GameSchema.methods.end = function () {
  this.status = 'finished';
  this.secretNumber = null; // Reset the secret number
};

module.exports = mongoose.model('Game', GameSchema);
