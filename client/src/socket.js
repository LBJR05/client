import { io } from 'socket.io-client';

const socket = io(window.location.origin, {
  reconnection: true,            // Enable reconnection
  reconnectionAttempts: 5,       // Retry 5 times
  reconnectionDelay: 1000,       // 1 second between attempts
  timeout: 5000,                 // Disconnect after 5 seconds of inactivity
});

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', (reason) => {
  console.log(`Disconnected: ${reason}`);
  if (reason === 'io server disconnect') {
    console.log('Server forced the disconnection.');
  } else if (reason === 'io client disconnect') {
    console.log('Client manually disconnected.');
  } else {
    console.log('Connection lost. Attempting to reconnect...');
  }
});

export default socket;
