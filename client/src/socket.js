import { io } from 'socket.io-client'; // Import io from socket.io-client

const playerId = localStorage.getItem('playerId');
const socket = io(window.location.origin, {
  query: { playerId },
  reconnection: true, // Enable automatic reconnection
  reconnectionAttempts: 5, // Limit reconnection attempts
  reconnectionDelay: 1000, // Delay between reconnection attempts
  timeout: 20000, // Connection timeout duration
});

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', (reason) => {
  console.log(`Disconnected: ${reason}`);
  if (reason === 'io server disconnect') {
    // The disconnection was initiated by the server; attempt to reconnect
    socket.connect();
  }
});

export default socket;
