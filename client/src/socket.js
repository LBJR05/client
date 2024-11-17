// client/src/socket.js
import io from 'socket.io-client';

const playerId = localStorage.getItem('playerId');
const socket = io(window.location.origin, {
  query: { playerId }
});

export default socket;