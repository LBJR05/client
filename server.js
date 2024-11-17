// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const Player = require('./models/Player');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost", "http://localhost:3000", "http://192.168.0.181", "http://192.168.0.181:3000"],
    methods: ["GET", "POST"]
  }
});

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000 // Increase timeout to 5 seconds
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

app.use(cors({
  origin: ["http://localhost", "http://localhost:3000", "http://192.168.0.181", "http://192.168.0.181:3000"]
}));

app.get('/', (req, res) => {
  res.send('Server is running');
});

const adjectives = ["Quick", "Lazy", "Happy", "Sad", "Angry", "Bright"];
const nouns = ["Fox", "Dog", "Cat", "Mouse", "Bear", "Lion"];

const generateRandomNickname = () => {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective}${noun}`;
};

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('getOrCreatePlayer', async ({ playerId }) => {
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
  });

  socket.on('updateNickname', async ({ playerId, newNickname }) => {
    if (newNickname.length < 3) {
      socket.emit('nicknameUpdateFailed', { message: 'Nickname must be at least 3 characters long.' });
      return;
    }

    try {
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
      socket.emit('nicknameUpdateFailed', { message: 'An error occurred while updating the nickname.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));