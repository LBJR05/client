import { io } from 'socket.io-client';

const socket = io(window.location.origin, {
  reconnection: true,            // Enable reconnection
  reconnectionAttempts: Infinity, // Unlimited attempts
  reconnectionDelay: 1000,       // 1 second between attempts
});

const HEARTBEAT_INTERVAL = 2500; // Match the server's pingInterval


let heartbeatInterval;

function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval); // Clear any existing intervals
  }

  heartbeatInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('heartbeat'); // Always send heartbeat
      console.log('Heartbeat sent');
    }
  }, HEARTBEAT_INTERVAL); // Match server's pingInterval
}

socket.on('connect', () => {
  console.log('Socket connected, starting heartbeat');
  startHeartbeat();

  // Check if the player is on a lobby route
  const path = window.location.pathname;
  if (path.startsWith('/room/')) {
    const lobbyCode = path.split('/room/')[1];
    const playerId = localStorage.getItem('playerId');
    console.log(`Reconnecting to lobby ${lobbyCode}`);
    socket.emit('reconnectToLobby', { lobbyCode, playerId });
  }
});

socket.on('disconnect', (reason) => {
  console.log('Socket disconnected, clearing heartbeat');
  clearInterval(heartbeatInterval); // Ensure the interval is cleared
  heartbeatInterval = null; // Prevent duplicate intervals
  if (reason === 'io server disconnect') {
    console.log('Server forced the disconnection.');
  } else if (reason === 'io client disconnect') {
    console.log('Client manually disconnected.');
  } else {
    console.log('Connection lost. Attempting to reconnect...');
  }
});


export default socket;


