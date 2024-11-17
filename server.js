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
  pingTimeout: 60000, // Increase timeout to 60 seconds
  pingInterval: 25000, // Send ping every 25 seconds
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

io.on('connection', (socket) => {
  console.log('New client connected: ', socket.id);

  // Handle player connection and track their socket
  socket.on('getOrCreatePlayer', async ({ playerId }) => {
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

      // Track the playerId with the socket
      activeSockets.set(socket.id, playerId);
    } catch (error) {
      console.error('Error in getOrCreatePlayer:', error);
      socket.emit('error', { message: 'Internal server error' });
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

  // Handle leaveLobby
  socket.on('leaveLobby', async ({ lobbyCode, playerId }) => {
    console.log(`Player ${playerId} leaving lobby ${lobbyCode}`);
    try {
      const player = await Player.findOne({ uuid: playerId });
      if (player) {
        const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
        if (lobby) {
          lobby.removePlayer(player._id);
          await lobby.save();
  
          if (lobby.isEmpty()) {
            console.log(`Lobby ${lobbyCode} is empty and can be closed.`);
            await Lobby.deleteOne({ _id: lobby._id });
          } else {
            io.to(lobbyCode).emit('lobbyUpdated', lobby);
          }
        }
      }
    } catch (error) {
      console.error('Error handling leaveLobby:', error);
    }
  });

  socket.on('joinLobby', async ({ lobbyCode, playerId }) => {
    try {
      const lobby = await Lobby.findOne({ lobbyCode }).populate('players spectators');
      if (!lobby) {
        socket.emit('error', { message: 'Lobby not found' });
        return;
      }
  
      const player = await Player.findOne({ uuid: playerId }); // Find by UUID
      if (!player) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }
  
      console.log(`Adding player ${playerId} to lobby ${lobbyCode}`);
      lobby.addPlayer(player);
      await lobby.save();
  
      const populatedLobby = await Lobby.findById(lobby._id).populate('players spectators');
      console.log(`Player ${playerId} added to lobby ${lobbyCode}`);
      console.log('Emitting updated lobby:', populatedLobby);
  
      socket.join(lobbyCode); // Join the room
      io.to(lobbyCode).emit('lobbyUpdated', populatedLobby); // Broadcast to the room
    } catch (error) {
      console.error('Error in joinLobby:', error);
      socket.emit('error', { message: 'Internal server error' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log(`Client disconnected: ${socket.id}`);
    const playerId = activeSockets.get(socket.id);

    if (playerId) {
      try {
        const player = await Player.findOne({ uuid: playerId });
        if (player) {
          const lobby = await Lobby.findOne({ players: player._id }).populate('players spectators');
          if (lobby) {
            console.log(`Removing player ${playerId} from lobby ${lobby.lobbyCode}`);
            lobby.removePlayer(player._id);
            await lobby.save();

            if (lobby.isEmpty()) {
              console.log(`Lobby ${lobby.lobbyCode} is empty and can be closed.`);
              await Lobby.deleteOne({ _id: lobby._id });
            } else {
              io.to(lobby.lobbyCode).emit('lobbyUpdated', lobby);
            }
          }
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    }

    activeSockets.delete(socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));