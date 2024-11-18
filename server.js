// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const Player = require('./models/Player');
const Lobby = require('./models/Lobby');
const lobbyRoutes = require('./routes/lobbyRoutes');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost", "http://localhost:3000"],
    methods: ["GET", "POST"],
  },
  pingTimeout: 2000, // Increase timeout to 60 seconds
  pingInterval: 1000, // Send ping every 25 seconds
});

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000 // Increase timeout to 5 seconds
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

app.use(cors());
app.use(express.json());

// Use the lobby routes
app.use('/api', lobbyRoutes);

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.get('/api/player/:playerId', async (req, res) => {
  try {
    const player = await Player.findOne({ uuid: req.params.playerId });
    if (player) {
      res.json(player);
    } else {
      res.status(404).json({ message: 'Player not found' });
    }
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const activeSockets = new Map(); // Map to track active sockets and their players
const disconnectionTimeouts = new Map(); // Map to manage reconnection timeouts

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Initialize socket state
  socket.state = {
    isNavigating: false,
    playerId: null,
    lobbyCode: null
  };

  socket.on('getOrCreatePlayer', async ({ playerId, reconnect = false }) => {
    console.log(`[getOrCreatePlayer] Received for playerId: ${playerId}, reconnect: ${reconnect}`);
  
    socket.state.playerId = playerId;
  
    if (reconnect) {
      reconnectingSockets.add(socket.id); // Mark this socket as reconnecting
      setTimeout(() => reconnectingSockets.delete(socket.id), 5000); // Clear after 5 seconds
    }
  
    try {
      if (!playerId) {
        playerId = uuidv4();
        const nickname = generateRandomNickname();
        const newPlayer = new Player({ uuid: playerId, nickname });
        await newPlayer.save();
        socket.emit('playerData', { playerId, nickname });
      } else {
        const player = await Player.findOne({ uuid: playerId });
        if (player) {
          socket.emit('playerData', { playerId, nickname: player.nickname });
        } else {
          const nickname = generateRandomNickname();
          const newPlayer = new Player({ uuid: playerId, nickname });
          await newPlayer.save();
          socket.emit('playerData', { playerId, nickname });
        }
      }
  
      if (!activeSockets.has(playerId)) {
        activeSockets.set(playerId, new Set());
      }
      activeSockets.get(playerId).add(socket.id);
  
      console.log(`[getOrCreatePlayer] Active socket for playerId ${playerId}: ${socket.id}`);
    } catch (error) {
      console.error('Error in getOrCreatePlayer:', error);
      socket.emit('error', { message: 'Internal server error' });
    }
  });

  socket.on('deleteLobbyAndNavigate', async ({ lobbyCode, playerId }) => {
    socket.state.isNavigating = true; // Ensure state reflects navigation
    console.log(`Player ${playerId} is deleting lobby ${lobbyCode} and navigating away.`);
    try {
      const player = await Player.findOne({ uuid: playerId });
      if (player) {
        const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
        if (lobby) {
          console.log(`Removing player ${playerId} from lobby ${lobbyCode}`);
          lobby.removePlayer(player._id);
          await lobby.save();
  
          if (lobby.isEmpty()) {
            console.log(`Lobby ${lobbyCode} is empty and being deleted.`);
            await Lobby.deleteOne({ _id: lobby._id });
          } else {
            io.to(lobbyCode).emit('lobbyUpdated', lobby);
          }
          socket.emit('lobbyDeleted', { message: 'Lobby deleted successfully.' });
        }
      }
    } catch (error) {
      console.error('Error deleting lobby:', error);
      socket.emit('error', { message: 'Failed to delete the lobby.' });
    } finally {
      socket.state.isNavigating = false; // Reset navigation state
    }
  });

  socket.on('updateNickname', async ({ playerId, newNickname }) => {
    try {
      if (newNickname.length < 3) {
        socket.emit('nicknameUpdateFailed', { message: 'Nickname must be at least 3 characters long.' });
        return;
      }

      const player = await Player.findOneAndUpdate(
        { uuid: playerId },
        { nickname: newNickname, lastActive: Date.now() },
        { new: true }
      );

      if (player) {
        socket.emit('nicknameUpdated', { newNickname });
      } else {
        socket.emit('nicknameUpdateFailed', { message: 'Failed to update nickname.' });
      }
    } catch (error) {
      console.error('Error in updateNickname:', error);
      socket.emit('nicknameUpdateFailed', { message: 'An error occurred while updating the nickname.' });
    }
  });

  const reconnectingSockets = new Set(); // Track sockets that are reconnecting


  socket.on('disconnect', async () => {
    const playerId = socket.state.playerId;
    const socketId = socket.id;
  
    if (!playerId) {
      console.log(`[disconnect] Socket disconnected with no associated player: ${socketId}`);
      return;
    }
  
    console.log(`[disconnect] Handling disconnection for playerId: ${playerId}, socketId: ${socketId}`);
  
    // Remove the socket from active sockets map
    if (activeSockets.has(playerId)) {
      const sockets = activeSockets.get(playerId);
      sockets.delete(socketId);
  
      if (sockets.size === 0) {
        activeSockets.delete(playerId);
      }
    }
  
    console.log(`[disconnect] Removing player ${playerId} from their lobby (if any).`);
  
    // Remove the player from the lobby
    const player = await Player.findOne({ uuid: playerId });
    if (player) {
      const lobby = await Lobby.findOne({ players: player._id }).populate('players spectators');
      if (lobby) {
        console.log(`[disconnect] Removing player ${playerId} from lobby ${lobby.lobbyCode}`);
        lobby.removePlayer(player._id);
        await lobby.save();
  
        if (lobby.isEmpty()) {
          console.log(`[disconnect] Lobby ${lobby.lobbyCode} is empty. Starting 5-second cleanup timer.`);
          const timeout = setTimeout(async () => {
            const currentLobby = await Lobby.findById(lobby._id);
            if (currentLobby && currentLobby.isEmpty()) {
              console.log(`[disconnect] Deleting empty lobby ${currentLobby.lobbyCode}`);
              await Lobby.deleteOne({ _id: currentLobby._id });
            } else {
              console.log(`[disconnect] Lobby ${lobby.lobbyCode} is no longer empty. Cleanup aborted.`);
            }
          }, 5000);
  
          disconnectionTimeouts.set(lobby.lobbyCode, timeout);
        } else {
          console.log(`[disconnect] Lobby ${lobby.lobbyCode} still has players. No cleanup needed.`);
          io.to(lobby.lobbyCode).emit('lobbyUpdated', lobby); // Notify remaining players
        }
      }
    }
  });
  
  

  socket.on('joinLobby', async ({ lobbyCode, playerId }) => {
    try {
      const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
      if (!lobby) {
        socket.emit('error', { message: 'Lobby not found' });
        return;
      }
  
      const player = await Player.findOne({ uuid: playerId });
      if (!player) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }
  
      console.log(`[joinLobby] Player ${playerId} requested to join lobby ${lobbyCode}. Waiting 3 seconds...`);
  
      setTimeout(async () => {
        // Ensure lobby still exists after the delay
        const currentLobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
        if (!currentLobby) {
          console.log(`[joinLobby] Lobby ${lobbyCode} no longer exists after delay. Aborting.`);
          return;
        }
  
        // Cancel any pending cleanup for the lobby
        if (disconnectionTimeouts.has(lobbyCode)) {
          console.log(`[joinLobby] Player ${playerId} joined. Canceling cleanup for lobby ${lobbyCode}`);
          clearTimeout(disconnectionTimeouts.get(lobbyCode));
          disconnectionTimeouts.delete(lobbyCode);
        }
  
        console.log(`[joinLobby] Adding player ${playerId} to lobby ${lobbyCode} after 3-second delay.`);
        currentLobby.addPlayer(player);
        await currentLobby.save();
  
        const populatedLobby = await Lobby.findById(currentLobby._id).populate('players spectators');
        console.log(`[joinLobby] Player ${playerId} added to lobby ${lobbyCode}`);
        console.log('[joinLobby] Emitting updated lobby:', populatedLobby);
  
        socket.join(lobbyCode);
        io.to(lobbyCode).emit('lobbyUpdated', populatedLobby);
      }, 3000); // 3-second delay
    } catch (error) {
      console.error('[joinLobby] Error in joinLobby:', error);
      socket.emit('error', { message: 'Internal server error' });
    }
  });
  
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));