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
const Game = require('./models/Game');

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

const disconnectedPlayers = new Map(); // Key: lobbyCode, Value: { playerId, disconnectTime }
const REJOIN_TIME_LIMIT = 10000; // 10 seconds

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
      // Find the lobby
      const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators host game');
      if (!lobby) {
          console.log(`[Helper][removePlayerFromLobby] Lobby ${lobbyCode} not found.`);
          return;
      }

      // Find the player
      const player = await Player.findOne({ uuid: playerId });
      if (!player) {
          console.log(`[Helper][removePlayerFromLobby] Player ${playerId} not found.`);
          return;
      }

      // Remove player from players or spectators
      const wasPlayer = lobby.players.some((p) => p.equals(player._id));
      if (wasPlayer) {
          lobby.removePlayer(player._id);
      } else {
          lobby.removeSpectator(player._id);
      }

      // Reassign host if necessary
      if (lobby.host && lobby.host.equals(player._id)) {
          lobby.assignNewHost();
          console.log(`[Helper][removePlayerFromLobby] New host assigned: ${lobby.host}`);
      }

      // Save changes to the lobby
      await lobby.save();

      // If the game is in progress and only one player is left, start cancellation logic
      if (lobby.status === 'in-progress' && lobby.players.length === 1) {
          console.log(`[Helper][removePlayerFromLobby] Only one player remains in lobby ${lobbyCode}. Starting cancellation timer.`);

          // Wait 10 seconds before canceling the game
          setTimeout(async () => {
              const refreshedLobby = await Lobby.findById(lobby._id).populate('players spectators game');
              if (refreshedLobby.players.length === 1 && refreshedLobby.status === 'in-progress') {
                  // Cancel the game and reset the lobby
                  const game = await Game.findById(refreshedLobby.game._id);
                  if (game) {
                      game.end();
                      await game.save();
                  }

                  refreshedLobby.status = 'waiting';
                  refreshedLobby.game = null;
                  await refreshedLobby.save();

                  console.log(`[Helper][removePlayerFromLobby] Game canceled in lobby ${lobbyCode}.`);

                  // Notify clients of the updated lobby state
                  const updatedLobby = await Lobby.findById(refreshedLobby._id).populate('players spectators host game');
                  io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
              }
          }, 10000); // 10-second delay
      }

      // Notify all clients about the updated lobby state
      const updatedLobby = await Lobby.findById(lobby._id).populate('players spectators host game');
      io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
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

        // Handle duplicate sessions (reconnect and session expiration)
        if (activeSockets.has(playerId)) {
            const existingSocketIds = Array.from(activeSockets.get(playerId));
            for (const existingSocketId of existingSocketIds) {
                if (existingSocketId !== socket.id) {
                    const existingSocket = io.sockets.sockets.get(existingSocketId);
                    if (existingSocket) {
                        const { lobbyCode } = existingSocket.state;

                        // If the player is already in a lobby, remove them from the lobby
                        if (lobbyCode) {
                            console.log(`[Socket][sessionLost] Removing player ${playerId} from lobby ${lobbyCode}`);
                            await removePlayerFromLobby(playerId, lobbyCode);
                        }

                        // Notify the duplicate socket and disconnect it
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
    
    try {
      const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
      const player = await Player.findOne({ uuid: playerId });
  
      if (!lobby || !player) {
        console.log('[Socket][joinLobby] Invalid lobby or player ID');
        return socket.emit('error', { message: 'Invalid lobby or player ID' });
      }
  
      // Check if the player was disconnected during the game
      const disconnectedInfo = disconnectedPlayers.get(lobbyCode);
      const currentTime = Date.now();
  
      if (
        lobby.status === 'in-progress' && 
        disconnectedInfo?.playerId === playerId &&
        currentTime - disconnectedInfo.disconnectTime <= REJOIN_TIME_LIMIT
      ) {
        // Rejoin as a player if within the rejoin time limit
        console.log(`[Socket][joinLobby] Rejoining player ${playerId} as a player.`);
        if (!lobby.players.some((p) => p.equals(player._id))) {
          lobby.addPlayer(player);
        }
      } else if (lobby.status === 'in-progress') {
        // Add as a spectator if the game is already in progress
        console.log(`[Socket][joinLobby] Adding player ${playerId} as a spectator.`);
        lobby.addSpectator(player);
      } else {
        // Add as a player if the game is not in progress
        console.log(`[Socket][joinLobby] Adding player ${playerId} as a player.`);
        lobby.addPlayer(player);
      }
  
      await lobby.save();
      socket.state.lobbyCode = lobbyCode;
      socket.join(lobbyCode);
  
      const updatedLobby = await Lobby.findById(lobby._id).populate('players spectators host game');
      io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
    } catch (error) {
      console.error(`[Socket][joinLobby] Error:`, error);
      socket.emit('error', { message: 'Failed to join the lobby.' });
    }
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

    if (playerId && lobbyCode) {
        console.log(`[Socket][disconnect] Player ${playerId} disconnected from lobby ${lobbyCode}.`);

        // Track the disconnected player
        disconnectedPlayers.set(lobbyCode, {
            playerId,
            disconnectTime: Date.now(),
        });

        // Remove player immediately
        await removePlayerFromLobby(playerId, lobbyCode);

        // Allow rejoin within the grace period
        setTimeout(async () => {
            try {
                const disconnectedInfo = disconnectedPlayers.get(lobbyCode);
                if (disconnectedInfo && disconnectedInfo.playerId === playerId) {
                    console.log(`[Server] Clearing disconnected player ${playerId} from lobby ${lobbyCode}.`);
                    disconnectedPlayers.delete(lobbyCode);
                }
            } catch (error) {
                console.error(`[Server] Error during disconnect cleanup for player ${playerId}:`, error);
            }
        }, REJOIN_TIME_LIMIT);
    }
});
  
  

  socket.on('toggleSpectate', async ({ lobbyCode, playerId }) => {
    try {
      const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
  
      if (!lobby) {
        console.log(`[Socket][toggleSpectate] Lobby not found for code: ${lobbyCode}`);
        return socket.emit('error', { message: 'Lobby not found.' });
      }
  
      // Prevent switching roles if the game is in progress
      if (lobby.status === 'in-progress') {
        console.log('[Socket][toggleSpectate] Cannot toggle roles while the game is in progress.');
        return socket.emit('error', { message: 'Cannot toggle roles while the game is in progress.' });
      }
  
      const player = await Player.findOne({ uuid: playerId });
  
      if (!player) {
        console.log(`[Socket][toggleSpectate] Player not found: ${playerId}`);
        return socket.emit('error', { message: 'Player not found.' });
      }
  
      if (lobby.players.some((p) => p.equals(player._id))) {
        lobby.removePlayer(player._id);
        lobby.addSpectator(player);
      } else if (lobby.spectators.some((s) => s.equals(player._id))) {
        lobby.removeSpectator(player._id);
        lobby.addPlayer(player);
      }
  
      await lobby.save();
  
      const updatedLobby = await Lobby.findById(lobby._id).populate('players spectators host game');
      io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
    } catch (error) {
      console.error(`[Socket][toggleSpectate] Error toggling spectate for player ${playerId}:`, error);
      socket.emit('error', { message: 'Failed to toggle role.' });
    }
  });

  socket.on('startGame', async ({ lobbyCode, player }) => {
    try {
        const lobby = await Lobby.findOne({ lobbyCode }).populate('players host game');
        if (!lobby) {
            return socket.emit('error', { message: 'Lobby not found.' });
        }

        if (!lobby.host.equals(player._id)) {
            return socket.emit('error', { message: 'Only the host can start the game.' });
        }

        if (lobby.players.length < 2) {
            return socket.emit('error', { message: 'At least 2 players are required to start the game.' });
        }

        if (lobby.game) {
            return socket.emit('error', { message: 'A game is already in progress.' });
        }

        // Create and start the game
        const game = new Game({ lobby: lobby._id });
        game.start(); // Set the game state to in-progress and generate secret number
        await game.save();

        lobby.status = 'in-progress';
        lobby.game = game._id;
        await lobby.save();

        console.log(`[Socket][startGame] Game started for lobby: ${lobbyCode}, player: ${player.uuid}`);

        // Notify all clients
        const updatedLobby = await Lobby.findById(lobby._id).populate('players spectators host game');
        io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
    } catch (error) {
        console.error(`[Socket][startGame] Error: ${error.message}`);
        socket.emit('error', { message: error.message || 'Failed to start the game.' });
    }
});

  
  socket.on('endGame', async ({ lobbyCode }) => {
    try {
      const lobby = await Lobby.findOne({ lobbyCode }).populate('game');
      if (!lobby || !lobby.game) {
        return socket.emit('error', { message: 'No active game found.' });
      }
  
      const playerId = socket.state.playerId;
      if (!playerId || !lobby.host.equals(playerId)) {
        return socket.emit('error', { message: 'Only the host can end the game.' });
      }
  
      // End the game
      const game = await Game.findById(lobby.game._id);
      game.end();
      await game.save();
  
      // Reset the lobby's game reference and status
      lobby.status = 'waiting';
      lobby.game = null;
      await lobby.save();
  
      console.log(`[Game][endGame] Game ended for lobby ${lobbyCode}.`);
  
      // Notify all clients
      io.to(lobbyCode).emit('lobbyUpdated', {
        lobbyCode,
        game: null,
        lobbyStatus: lobby.status,
      });
    } catch (error) {
      console.error(`[Socket][endGame] Error:`, error);
      socket.emit('error', { message: error.message || 'Failed to end the game.' });
    }
  });
  
});

// Start server
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));
