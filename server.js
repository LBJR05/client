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

async function deleteGame(gameId) {
  try {
    const game = await Game.findById(gameId);
    if (game) {
      console.log(`[Helper][deleteGame] Deleting game with ID: ${gameId}`);
      await Game.deleteOne({ _id: gameId });
    } else {
      console.log(`[Helper][deleteGame] Game with ID ${gameId} not found.`);
    }
  } catch (error) {
    console.error(`[Helper][deleteGame] Error deleting game with ID ${gameId}:`, error);
  }
}

// Helper functions
async function deleteLobby(lobby) {
  try {
    const currentLobby = await Lobby.findById(lobby._id).populate('game players spectators');
    if (currentLobby) {
      // Delete the associated game if it exists
      if (currentLobby.game) {
        await deleteGame(currentLobby.game._id);
      }

      // Check if the lobby is empty before deletion
      if (currentLobby.players.length === 0 && currentLobby.spectators.length === 0) {
        console.log(`[Helper][deleteLobby] Deleting empty lobby ${currentLobby.lobbyCode}`);
        await Lobby.deleteOne({ _id: currentLobby._id });
        io.to(lobby.lobbyCode).emit('lobbyDeleted', { message: `Lobby ${currentLobby.lobbyCode} has been deleted.` });
      }
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

          setTimeout(async () => {
              const refreshedLobby = await Lobby.findById(lobby._id).populate('players spectators game');
              if (refreshedLobby.players.length === 1 && refreshedLobby.status === 'in-progress') {
                  const game = await Game.findById(refreshedLobby.game._id);
                  if (game) {
                      game.end();
                      await game.save();
                  }

                  refreshedLobby.status = 'waiting';
                  refreshedLobby.game = null;
                  await refreshedLobby.save();

                  console.log(`[Helper][removePlayerFromLobby] Game canceled in lobby ${lobbyCode}.`);
const updatedLobby = await Lobby.findById(lobby._id)
  .populate({
    path: 'game',
    populate: {
      path: 'hotseat',
      model: 'Player',
    },
  })
  .populate('players spectators host');

io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
              }
          }, 10000); // 10-second delay
      }

      // Add 10-second delayed logic to check if the lobby is empty and delete it
      setTimeout(async () => {
          const currentLobby = await Lobby.findById(lobby._id).populate('players spectators');
          if (currentLobby && currentLobby.players.length === 0 && currentLobby.spectators.length === 0) {
              console.log(`[Helper][removePlayerFromLobby] Lobby ${lobbyCode} is empty. Attempting to delete.`);
              await deleteLobby(currentLobby); // Call deleteLobby function
          }
      }, 10000); // 10-second delay

      // Notify all clients about the updated lobby state
      const updatedLobby = await Lobby.findById(lobby._id)
      .populate({
        path: 'game',
        populate: {
          path: 'hotseat',
          model: 'Player',
        },
      })
      .populate('players spectators host');
    
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

const clearDatabases = async () => {
  try {
    await Lobby.deleteMany({});
    await Game.deleteMany({});
    console.log('[Server] Cleared Lobby and Game databases');
  } catch (error) {
    console.error('[Server] Error clearing databases:', error);
  }
};

// GAME FUNCTIONS
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const startRound = async (lobby, roundNumber) => {
  try {
    console.log(`[startRound] Starting round ${roundNumber + 1} for lobbyCode: ${lobby.lobbyCode}`);
    const game = await Game.findById(lobby.game).populate('hotseat');
    if (!game) {
      throw new Error('Game not found');
    }

    // Check if all rounds are completed
    if (roundNumber >= game.rounds) {
      game.status = 'finished';
      await game.save();
      console.log(`[startRound] All rounds completed for lobbyCode: ${lobby.lobbyCode}`);
      return;
    }

    // Determine the hotseat player for this round using the shuffled order
    const hotseatPlayerId = game.shuffledPlayers[roundNumber];
    const hotseatPlayer = await Player.findById(hotseatPlayerId);
    game.hotseat = hotseatPlayer;

    // Generate a new secret number only if it's the first round or a new round
    if (roundNumber === game.roundsPlayed) {
      game.generateSecretNumber(); // Generate a new secret number for each round
    }

    await game.save();

    console.log(`[startRound] Round ${roundNumber + 1} started for lobbyCode: ${lobby.lobbyCode}`);
    console.log(`[startRound] Hotseat player: ${hotseatPlayer.nickname}`);
    console.log(`[startRound] Secret number: ${game.secretNumber}`);

    // Emit the round event to all clients in the lobby except the hotseat player
    lobby.players.forEach(player => {
      if (player.equals(hotseatPlayer._id)) {
        io.to(player.socketId).emit('roundStarted', {
          roundNumber,
          hotseatPlayer,
          secretNumber: null, // Do not send the secret number to the hotseat player
        });
      } else {
        io.to(player.socketId).emit('roundStarted', {
          roundNumber,
          hotseatPlayer,
          secretNumber: game.secretNumber,
        });
      }
    });

    // Emit the updated lobby to all clients
    const updatedLobby = await Lobby.findById(lobby._id)
      .populate({
        path: 'game',
        populate: {
          path: 'hotseat',
          model: 'Player',
        },
      })
      .populate('players spectators host');

    io.to(lobby.lobbyCode).emit('lobbyUpdated', updatedLobby);
    console.log(`[startRound] Lobby updated for lobbyCode: ${lobby.lobbyCode}`);
  } catch (error) {
    console.error(`[startRound] Error starting round for lobbyCode ${lobby.lobbyCode}:`, error);
  }
};
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
  
      const updatedLobby = await Lobby.findById(lobby._id)
      .populate({
        path: 'game',
        populate: {
          path: 'hotseat',
          model: 'Player',
        },
      })
      .populate('players spectators host');
    
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

    // Add the event listener for 'removePlayerFromLobby'
    socket.on('removePlayerFromLobby', async ({ playerId, lobbyCode }) => {
      console.log(`[Socket][removePlayerFromLobby] playerId: ${playerId}, lobbyCode: ${lobbyCode}`);
      try {
          // Call the helper function to remove the player
          await removePlayerFromLobby(playerId, lobbyCode);

          const updatedLobby = await Lobby.findOne({ lobbyCode }).populate({
            path: 'game',
            populate: {
              path: 'hotseat',
              model: 'Player',
            },
          })
          .populate('players spectators host');
        
        io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);

          // Optionally notify the specific socket that emitted the event
          socket.emit('playerRemoved', { message: 'Player successfully removed.' });
      } catch (error) {
          console.error(`[Socket][removePlayerFromLobby] Error:`, error);
          socket.emit('error', { message: 'Failed to remove the player from the lobby.' });
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
  
      const updatedLobby = await Lobby.findById(lobby._id)
      .populate({
        path: 'game',
        populate: {
          path: 'hotseat',
          model: 'Player',
        },
      })
      .populate('players spectators host');
    
    io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
    } catch (error) {
      console.error(`[Socket][toggleSpectate] Error toggling spectate for player ${playerId}:`, error);
      socket.emit('error', { message: 'Failed to toggle role.' });
    }
  });

  socket.on('startGame', async ({ lobbyCode, playerId }) => {
    console.log(`[startGame] Received start game request for lobbyCode: ${lobbyCode}, playerId: ${playerId}`);
  
    try {
      const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators host');
      const player = await Player.findOne({ uuid: playerId });
  
      if (!lobby || !player) {
        console.log('[startGame] Invalid lobby or player ID');
        return socket.emit('error', { message: 'Invalid lobby or player ID' });
      }
  
      // Check if the player is the host
      if (!lobby.host.equals(player._id)) {
        console.log('[startGame] Only the host can start the game');
        return socket.emit('error', { message: 'Only the host can start the game' });
      }
  
      // Shuffle the players
      const shuffledPlayers = shuffleArray([...lobby.players]);
  
      // Create a new Game object
      const newGame = new Game({
        lobby: lobby._id,
        status: 'in-progress',
        rounds: lobby.players.length, // Set the number of rounds to match the number of players
        shuffledPlayers, // Store the shuffled order of players
      });
  
      // Save the new Game object
      await newGame.save();
  
      // Update the lobby with the new game and change its status
      lobby.game = newGame._id;
      lobby.status = 'in-progress';
      await lobby.save();
  
      // Populate the lobby with the new game details
      const updatedLobby = await Lobby.findById(lobby._id)
        .populate({
          path: 'game',
          populate: {
            path: 'hotseat',
            model: 'Player',
          },
        })
        .populate('players spectators host');
  
      // Emit the updated lobby to all clients in the lobby
      io.to(lobbyCode).emit('lobbyUpdated', updatedLobby);
      console.log(`[startGame] Game started for lobbyCode: ${lobbyCode}`);
      console.log(`[startGame] Lobby Details:`, JSON.stringify(updatedLobby, null, 2));
      console.log(`[startGame] Game Details:`, JSON.stringify(newGame, null, 2));
  
      // Start the first round
      startRound(lobby, 0);
    } catch (error) {
      console.error(`[startGame] Error starting game for lobbyCode ${lobbyCode}:`, error);
      socket.emit('error', { message: 'Failed to start the game.' });
    }
  });
  socket.on('nextRound', async ({ lobbyCode, roundNumber }) => {
    console.log(`[nextRound] Received next round request for lobbyCode: ${lobbyCode}, roundNumber: ${roundNumber}`);
  
    try {
      const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators host');
      if (!lobby) {
        console.log('[nextRound] Invalid lobby code');
        return socket.emit('error', { message: 'Invalid lobby code' });
      }
  
      const game = await Game.findById(lobby.game);
      if (!game) {
        console.log('[nextRound] Game not found');
        return socket.emit('error', { message: 'Game not found' });
      }
  
      // Validate the round number
      if (roundNumber !== game.roundsPlayed + 1) {
        console.log(`[nextRound] Invalid round number: ${roundNumber}, expected: ${game.roundsPlayed + 1}`);
        return socket.emit('error', { message: 'Invalid round number' });
      }
  
      // Increment the rounds played
      game.roundsPlayed += 1;
  
      // Check if all rounds are completed
      if (game.roundsPlayed >= game.rounds) {
        game.status = 'finished';
        await game.save();
        console.log(`[nextRound] All rounds completed for lobbyCode: ${lobbyCode}`);
        io.to(lobbyCode).emit('gameFinished', { message: 'Game finished' });
  
        // Delete the game and update the lobby
        await Game.deleteOne({ _id: game._id });
        lobby.status = 'finished';
        lobby.game = null;
        await lobby.save();
  
        // Emit the updated lobby to all clients
        const updatedLobby = await Lobby.findById(lobby._id)
          .populate('players spectators host');
  
        io.to(lobby.lobbyCode).emit('lobbyUpdated', updatedLobby);
        console.log(`[nextRound] Lobby updated for lobbyCode: ${lobby.lobbyCode}`);
        return;
      }
  
      await game.save();
  
      console.log(`[nextRound] Starting next round ${game.roundsPlayed} for lobbyCode: ${lobbyCode}`);
      startRound(lobby, game.roundsPlayed);
    } catch (error) {
      console.error(`[nextRound] Error starting next round for lobbyCode ${lobbyCode}:`, error);
      socket.emit('error', { message: 'Failed to start the next round.' });
    }
  });
});
// Start server
const PORT = process.env.PORT || 4000;

clearDatabases().then(() => {
  server.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));
});