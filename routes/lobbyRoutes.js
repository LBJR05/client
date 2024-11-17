// server/routes/lobbyRoutes.js
const express = require('express');
const router = express.Router();
const Lobby = require('../models/Lobby');
const Player = require('../models/Player');

// Endpoint to create a new lobby
router.post('/lobbies', async (req, res) => {
    try {
      const { playerId } = req.body; // Include the player's ID in the request body
      const newLobby = new Lobby(); // Create a new lobby
      await newLobby.save();
  
      // Automatically add the creator to the lobby
      const lobbyCode = newLobby.lobbyCode;
      const player = await Player.findOne({ uuid: playerId }); // Find the player
      if (player) {
        newLobby.addPlayer(player); // Add the player to the lobby
        await newLobby.save();
      }
  
      const populatedLobby = await Lobby.findById(newLobby._id).populate('players spectators');
      res.status(201).json(populatedLobby); // Return the updated lobby with the player
    } catch (error) {
      console.error('Error creating lobby:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });
  
// Endpoint to get a lobby by lobbyCode
router.get('/lobbies/:lobbyCode', async (req, res) => {
  try {
    const lobby = await Lobby.findOne({ lobbyCode: req.params.lobbyCode }).populate('players spectators');
    if (!lobby) {
      return res.status(404).json({ message: 'Lobby not found' });
    }
    res.json(lobby);
  } catch (error) {
    console.error('Error fetching lobby:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('/lobbies/:lobbyCode/join', async (req, res) => {
    try {
      const { playerId } = req.body;
      const lobby = await Lobby.findOne({ lobbyCode: req.params.lobbyCode }).populate('players spectators');
      if (!lobby) {
        return res.status(404).json({ message: 'Lobby not found' });
      }
      const player = await Player.findOne({ uuid: playerId });
      if (!player) {
        return res.status(404).json({ message: 'Player not found' });
      }
      lobby.addPlayer(player); // Add player to the lobby
      await lobby.save();
      const updatedLobby = await Lobby.findById(lobby._id).populate('players spectators');
      res.json(updatedLobby);
    } catch (error) {
      console.error('Error adding player to lobby:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

// Endpoint to add a spectator to a lobby
router.post('/lobbies/:lobbyCode/spectators', async (req, res) => {
  try {
    const { spectatorId } = req.body;
    const lobby = await Lobby.findOne({ lobbyCode: req.params.lobbyCode });
    if (!lobby) {
      return res.status(404).json({ message: 'Lobby not found' });
    }
    const spectator = await Player.findById(spectatorId);
    if (!spectator) {
      return res.status(404).json({ message: 'Spectator not found' });
    }
    lobby.addSpectator(spectator);
    await lobby.save();
    const populatedLobby = await Lobby.findById(lobby._id).populate('players spectators');
    res.json(populatedLobby);
  } catch (error) {
    console.error('Error adding spectator to lobby:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;