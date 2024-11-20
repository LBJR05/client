// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Player = require('./models/Player');
const Lobby = require('./models/Lobby');
const lobbyRoutes = require('./routes/lobbyRoutes');

// Load environment variables
dotenv.config();

// Initialize app and server
const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost", "http://localhost:3000"],
    methods: ["GET", "POST"],
  },
  pingTimeout: 15000,
  pingInterval: 2500,
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
})
  .then(() => console.log('[Server] MongoDB connected'))
  .catch(err => console.error('[Server] MongoDB connection error:', err));

// Middleware
app.use(cors());
app.use(express.json());

// API routes
app.use('/api', lobbyRoutes);

// Serve React app
app.use(express.static(path.join(__dirname, 'client', 'build')));

// Health check
app.get('/api/status', (req, res) => res.send('API is running'));

// Fallback to React frontend
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client', 'build', 'index.html')));

// Fetch player by ID
app.get('/api/player/:playerId', async (req, res) => {
  try {
    const player = await Player.findOne({ uuid: req.params.playerId });
    if (player) {
      console.log(`[API][GetPlayer] Player found: ${req.params.playerId}`);
      res.json(player);
    } else {
      console.log(`[API][GetPlayer] Player not found: ${req.params.playerId}`);
      res.status(404).json({ message: 'Player not found' });
    }
  } catch (error) {
    console.error('[API][GetPlayer] Error fetching player:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Helper maps
const activeSockets = new Map();
const disconnectionTimeouts = new Map();
const reconnectingSockets = new Set();

// Helper functions
async function deleteLobby(lobby) {
  try {
    const currentLobby = await Lobby.findById(lobby._id).populate('players spectators');
    if (currentLobby && currentLobby.isEmpty()) {
      console.log(`[Helper][deleteLobby] Deleting empty lobby ${currentLobby.lobbyCode}`);
      await Lobby.deleteOne({ _id: currentLobby._id });
      io.to(lobby.lobbyCode).emit('lobbyDeleted', { message: `Lobby ${lobby.lobbyCode} has been deleted.` });
    }
  } catch (error) {
    console.error(`[Helper][deleteLobby] Error deleting lobby ${lobby.lobbyCode}:`, error);
  }
}

async function removePlayerFromLobby(playerId, lobbyCode) {
  try {
    const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
    if (!lobby) {
      console.log(`[Helper][removePlayerFromLobby] Lobby ${lobbyCode} not found.`);
      return;
    }

    const player = await Player.findOne({ uuid: playerId });
    if (!player) {
      console.log(`[Helper][removePlayerFromLobby] Player ${playerId} not found.`);
      return;
    }

    // Remove the player from the players list
    lobby.players = lobby.players.filter((p) => !p.equals(player._id));

    // Remove the player from the spectators list
    lobby.spectators = lobby.spectators.filter((s) => !s.equals(player._id));

    // If the player is the current host, assign a new host
    if (lobby.host && lobby.host.equals(player._id)) {
      lobby.assignNewHost();
      await lobby.save(); // Save the lobby to persist the new host
      console.log(`[Helper][removePlayerFromLobby] New host assigned: ${lobby.host}`);
    }

    // If no players or spectators remain, delete the lobby
    if (lobby.isEmpty()) {
      console.log(`[Helper][removePlayerFromLobby] Lobby ${lobbyCode} is empty. Deleting lobby.`);
      await deleteLobby(lobby); // Call the deleteLobby helper
    } else {
      // Broadcast updated lobby to all connected clients
      const updatedLobby = await Lobby.findById(lobby._id).populate('players spectators host');
      io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
    }
  } catch (error) {
    console.error(`[Helper][removePlayerFromLobby] Error removing player ${playerId} from lobby ${lobbyCode}:`, error);
  }
}



function generateRandomNickname() {
  const adjectives = ['Quick', 'Brave', 'Clever', 'Jolly', 'Sneaky'];
  const animals = ['Fox', 'Lion', 'Rabbit', 'Hawk', 'Bear'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${animals[Math.floor(Math.random() * animals.length)]}`;
}

/**
 * Toggles a player's status between "Player" and "Spectator" in a lobby.
 * Moves the player to the spectators list if they are in players, and vice versa.
 * @param {string} playerId - The UUID of the player.
 * @param {string} lobbyCode - The unique code of the lobby.
 * @returns {Promise<object>} - The updated lobby object.
 * @throws {Error} - If the lobby or player is not found.
 */
async function togglePlayerSpectate(playerId, lobbyCode) {
  try {
    const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
    if (!lobby) throw new Error(`Lobby with code ${lobbyCode} not found.`);
    
    const player = await Player.findOne({ uuid: playerId });
    if (!player) throw new Error(`Player with ID ${playerId} not found.`);

    // Toggle player between players and spectators
    if (lobby.players.some(p => p.equals(player._id))) {
      lobby.addSpectator(player); // Move to spectators
    } else if (lobby.spectators.some(s => s.equals(player._id))) {
      lobby.addPlayer(player); // Move to players
    } else {
      throw new Error(`Player ${playerId} is neither a player nor a spectator in lobby ${lobbyCode}.`);
    }

    await lobby.save();
    return await Lobby.findById(lobby._id).populate('players spectators'); // Return the updated lobby
  } catch (error) {
    console.error(`[Helper][togglePlayerSpectate] Error: ${error.message}`);
    throw error;
  }
}

// WebSocket connections
io.on('connection', (socket) => {
  console.log('[Socket][Connection] New client connected:', socket.id);

  socket.state = { playerId: null };

  socket.on('getOrCreatePlayer', async ({ playerId, reconnect = false }) => {
    console.log(`[Socket][getOrCreatePlayer] Received playerId: ${playerId}, reconnect: ${reconnect}`);
  
    try {
      // If the socket already has a playerId, emit the existing playerData
      if (socket.state.playerId) {
        console.log(`[Socket][getOrCreatePlayer] Socket ${socket.id} already has playerId ${socket.state.playerId}`);
        
        const existingPlayer = await Player.findOne({ uuid: socket.state.playerId });
        if (existingPlayer) {
          socket.emit('playerData', { playerId: existingPlayer.uuid, nickname: existingPlayer.nickname });
        } else {
          console.warn(`[Socket][getOrCreatePlayer] No matching player found for playerId ${socket.state.playerId}.`);
        }
        return;
      }
  
      let player;
      if (!playerId) {
        // Create a new player if no playerId is provided
        playerId = uuidv4();
        const nickname = generateRandomNickname();
        player = new Player({ uuid: playerId, nickname });
        await player.save();
        console.log(`[Socket][getOrCreatePlayer] New player created: ${playerId} (${nickname})`);
      } else {
        // Attempt to find an existing player by ID
        player = await Player.findOne({ uuid: playerId });
        if (!player) {
          // Create a new player if the provided ID does not exist
          const nickname = generateRandomNickname();
          player = new Player({ uuid: playerId, nickname });
          await player.save();
          console.log(`[Socket][getOrCreatePlayer] New player created with provided ID: ${playerId} (${nickname})`);
        } else {
          console.log(`[Socket][getOrCreatePlayer] Existing player found: ${playerId} (${player.nickname})`);
        }
      }
  
      // Emit playerData for the client
      socket.emit('playerData', { playerId, nickname: player.nickname });
  
      // Handle duplicate sessions
      if (activeSockets.has(playerId)) {
        const existingSocketIds = Array.from(activeSockets.get(playerId));
        for (const existingSocketId of existingSocketIds) {
          if (existingSocketId !== socket.id) {
            const existingSocket = io.sockets.sockets.get(existingSocketId);
            if (existingSocket) {
              const { lobbyCode } = existingSocket.state;
  
              // Remove player from lobby if they were in one
              if (lobbyCode) {
                console.log(`[Socket][sessionLost] Removing player ${playerId} from lobby ${lobbyCode}`);
                await removePlayerFromLobby(playerId, lobbyCode);
              }
  
              // Notify and disconnect the duplicate socket
              existingSocket.emit('sessionLost', { message: 'Your session has expired. You have been removed from the lobby.' });
              existingSocket.disconnect(true);
              console.log(`[Socket][sessionLost] Disconnected duplicate socket ${existingSocketId} for player ${playerId}`);
            }
          }
        }
      }
  
      // Register the new socket for the player
      if (!activeSockets.has(playerId)) {
        activeSockets.set(playerId, new Set());
      }
      activeSockets.get(playerId).add(socket.id);
  
      // Update the socket's state
      socket.state.playerId = playerId;
      console.log(`[Socket][getOrCreatePlayer] Player ${playerId} connected with socket ${socket.id}`);
    } catch (error) {
      console.error(`[Socket][getOrCreatePlayer] Error handling playerId ${playerId}:`, error);
      socket.emit('error', { message: 'Internal server error while processing player creation or retrieval.' });
    }
  });
  

  socket.on('deleteLobbyAndNavigate', async ({ lobbyCode, playerId }) => {
    console.log(`[Socket][deleteLobbyAndNavigate] Received lobbyCode: ${lobbyCode}, playerId: ${playerId}`);
  
    try {
      const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
      if (!lobby) {
        console.log(`[Socket][deleteLobbyAndNavigate] Lobby ${lobbyCode} not found.`);
        return socket.emit('error', { message: 'Lobby not found.' });
      }
  
      // Use removePlayerFromLobby to handle everything, including host reassignment and empty lobby deletion
      await removePlayerFromLobby(playerId, lobbyCode);
  
      // Notify the client that the operation was successful
      socket.emit('lobbyDeleted', { message: 'Lobby deleted successfully.' });
    } catch (error) {
      console.error(`[Socket][deleteLobbyAndNavigate] Error:`, error);
      socket.emit('error', { message: 'Failed to delete the lobby.' });
    }
  });

  socket.on('joinLobby', async ({ lobbyCode, playerId }) => {
    console.log(`[Socket][joinLobby] Received lobbyCode: ${lobbyCode}, playerId: ${playerId}`);
    const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators host');
    const player = await Player.findOne({ uuid: playerId });
  
    if (!lobby || !player) {
      console.log('[Socket][joinLobby] Invalid lobby or player ID');
      return socket.emit('error', { message: 'Invalid lobby or player ID' });
    }
  
    if (!lobby.players.some((p) => p.equals(player._id))) {
      lobby.players.push(player._id);
      await lobby.save();
      console.log(`[Socket][joinLobby] Player ${playerId} added to lobby ${lobbyCode}`);
    } else {
      console.log(`[Socket][joinLobby] Player ${playerId} is already in lobby ${lobbyCode}`);
    }
  
    socket.state.lobbyCode = lobbyCode;
    socket.join(lobbyCode);
  
    // Broadcast updated lobby to all connected clients
    io.to(lobbyCode).emit('lobbyUpdated', await Lobby.findById(lobby._id).populate('players spectators host'));
  });
  

  socket.on('updateNickname', async ({ playerId, newNickname }) => {
    if (newNickname.length < 3) {
      return socket.emit('nicknameUpdateFailed', { message: 'Nickname must be at least 3 characters long.' });
    }
  
    try {
      const player = await Player.findOneAndUpdate(
        { uuid: playerId },
        { nickname: newNickname, lastActive: Date.now() },
        { new: true }
      );
      player
        ? socket.emit('nicknameUpdated', { newNickname })
        : socket.emit('nicknameUpdateFailed', { message: 'Failed to update nickname.' });
    } catch (error) {
      console.error('Error in updateNickname:', error);
      socket.emit('nicknameUpdateFailed', { message: 'An error occurred while updating the nickname.' });
    }
  });

  socket.on('disconnect', async () => {
    console.log('[Socket][disconnect] Client disconnected:', socket.id);
    const { playerId, lobbyCode } = socket.state;
  
    if (playerId) {
      console.log(`[Socket][disconnect] Handling disconnect for player ${playerId}`);
      if (activeSockets.has(playerId)) {
        const playerSockets = activeSockets.get(playerId);
        playerSockets.delete(socket.id);
        if (playerSockets.size === 0) {
          activeSockets.delete(playerId);
          console.log(`[Socket][disconnect] Removed player ${playerId} from activeSockets`);
        }
      }
      if (lobbyCode) {
        await removePlayerFromLobby(playerId, lobbyCode);
      }
    }
  });

  socket.on('toggleSpectate', async ({ playerId, lobbyCode }) => {
    try {
      const updatedLobby = await togglePlayerSpectate(playerId, lobbyCode);
      io.to(lobbyCode).emit('lobbyUpdated', updatedLobby); // Broadcast updated lobby
      console.log(`[Socket][toggleSpectate] Player ${playerId} toggled status in lobby ${lobbyCode}`);
    } catch (error) {
      console.error(`[Socket][toggleSpectate] Error toggling spectate status:`, error.message);
      socket.emit('error', { message: error.message });
    }
  });
});

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));
