import React, { useEffect, useState, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket';
import { useLoading } from '../LoadingContext';
import LoadingScreen from './LoadingScreen';
import { SessionContext } from '../SessionContext'; // Import SessionContext
import './Lobby.css';

const Lobby = () => {
  const { lobbyCode } = useParams();
  const navigate = useNavigate();
  const { isLoading, showLoading, hideLoading } = useLoading();
  const { sessionLost, alertMessage, resetSession } = useContext(SessionContext); // Access session context

  const [lobby, setLobby] = useState({
    game: null,
    players: [], // Initialize as empty array
    spectators: [], // Initialize as empty array
    lobbyCode: '',
    status: 'waiting',
  });

  const [message, setMessage] = useState('');
  const [loadingComplete, setLoadingComplete] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const [isHost, setIsHost] = useState(false); // Track if the current player is the host\
  const playerId = localStorage.getItem('playerId');
  const isHotseat = lobby?.game?.hotseat && lobby?.game?.hotseat.uuid === playerId;

useEffect(() => {
  console.log('Lobby.js mounted');

    console.log('Emitting getOrCreatePlayer');
    socket.emit('getOrCreatePlayer', { playerId, reconnect: true });

  socket.on('playerData', ({ playerId }) => {
    localStorage.setItem('playerId', playerId);
  });

  socket.on('lobbyUpdated', (updatedLobby) => {
    console.log('Lobby updated:', updatedLobby);
    setLobby({
      ...updatedLobby,
      players: updatedLobby?.players || [], // Default to an empty array
      spectators: updatedLobby?.spectators || [], // Default to an empty array
      game: updatedLobby?.game || null, // Default to null
    });
    setMessage('');
  
    const playerId = localStorage.getItem('playerId');
  
    // Determine if the current player is the host
    setIsHost(updatedLobby?.host?.uuid === playerId);
  
    // Determine if the player is a spectator
    const player = updatedLobby?.players?.find((p) => p.uuid === playerId);
    const spectator = updatedLobby?.spectators?.find((s) => s.uuid === playerId);
    setIsSpectator(!!spectator && !player);
  });
  

  return () => {
    console.log('Lobby.js unmounting');
    socket.off('lobbyUpdated');
    socket.off('playerData');
  };
}, [lobbyCode]);


const handleReturnToHomepage = () => {
  console.log('Return to Homepage button clicked');
  const playerId = localStorage.getItem('playerId');
  socket.emit('removePlayerFromLobby', { playerId, lobbyCode });

  socket.once('playerRemoved', (response) => {
    console.log(response.message);
    navigate('/'); // Navigate to homepage
  });

  socket.once('error', (err) => {
    console.error(err);
    alert('Error removing the player. Please try again.');
  });
};

  useEffect(() => {
    showLoading();
    const fetchLobby = async () => {
      try {
        const response = await fetch(`http://localhost:4000/api/lobbies/${lobbyCode}`);
        const data = await response.json();
        if (response.ok) {
          setLobby(data);
          const playerId = localStorage.getItem('playerId');
          socket.emit('joinLobby', { lobbyCode, playerId });
        } else {
          setMessage(data.message || 'Failed to fetch lobby');
          localStorage.removeItem('lobbyCode');
          setTimeout(() => navigate('/'), 3000); // Redirect after 3 seconds
        }
      } catch (error) {
        console.error('Error fetching lobby:', error);
        setMessage('Failed to fetch lobby');
        localStorage.removeItem('lobbyCode');
        setTimeout(() => navigate('/'), 3000); // Redirect after 3 seconds
      } finally {
        hideLoading();
      }
    };

    fetchLobby();

    socket.on('lobbyUpdated', (updatedLobby) => {
      console.log('Lobby updated:', updatedLobby);
      setLobby(updatedLobby);
    });

    return () => {
      console.log(`Lobby.js unmounting for lobbyCode: ${lobbyCode}`);
      const playerId = localStorage.getItem('playerId');

      if (!window.location.pathname.includes('/room/')) {
        socket.emit('leaveLobby', { lobbyCode, playerId });
      }

      socket.off('lobbyUpdated');
    };
  }, [lobbyCode, navigate, showLoading, hideLoading]);

  const handleAnimationEnd = () => {
    setLoadingComplete(true);
  };

  const handleToggleSpectate = () => {
    const playerId = localStorage.getItem('playerId');
    socket.emit('toggleSpectate', { playerId, lobbyCode });
  };

  useEffect(() => {
    if (!lobby && !isLoading && !loadingComplete) {
      setMessage('Lobby not found. Redirecting to homepage...');
      setTimeout(() => navigate('/'), 3000); // Redirect after 3 seconds
    }
  }, [lobby, isLoading, loadingComplete, navigate]);

  const handleStartGame = () => {
    console.log(`Handling the start of the game.`);
    const playerId = localStorage.getItem('playerId');
    if (!playerId) {
        console.error('Player ID not found');
        return;
    }

    const player = lobby.players.find((p) => p.uuid === playerId);
    if (!player) {
        console.error('Player not found in the lobby.');
        return;
    }

    console.log(`Starting Game as player: ${player.nickname}`);
    socket.emit('startGame', { lobbyCode, player }); // Pass player object
};


  return (
    <div className="lobby-app">
      {sessionLost ? ( // Session lost overlay
        <div className="overlay">
          <div className="modal">
            <p>{alertMessage}</p>
            <button onClick={() => resetSession() || window.location.reload()}>Refresh</button>
          </div>
        </div>
      ) : isLoading && !loadingComplete ? (
        <LoadingScreen onAnimationEnd={handleAnimationEnd} />
      ) : (
        <div className={`content ${loadingComplete ? 'fade-in' : ''}`}>

      {/* Display the secret number */}
      <div className="secretnumber-container">
  <p className="secretnumber-label">Secret Number:</p>
  <div className="secretnumber">
    {lobby?.game && lobby.game.secretNumber !== null && !isHotseat ? lobby.game.secretNumber : "?"}
  </div>
</div>

          {lobby ? (
            <div className="lobbyinfo-container">
              <div className="lobby-header">
                <h1 className="lobby-code">Lobby Code: {lobby.lobbyCode}</h1>
                <p className="lobby-status">Status: {lobby.status}</p>
                            {/* Show Start Game button only if the current player is the host */}
{/* Show Start Game button only if the current player is the host, the lobby is in 'waiting' status, and there are 2 or more players */}
{isHost && lobby.status === 'waiting' && lobby.players.length >= 2 && (
  <button
    className="lobby-button start-game-button"
    onClick={handleStartGame}
  >
    Start Game
  </button>
)}
              </div>
              <div className="player-section">
  <h2>Players</h2>
  <ul className="player-list">
    {lobby?.players?.map((player) => (
      <li className="player-list-item" key={player._id}>
        {player.nickname || 'Unnamed Player'}
      </li>
    )) || <p>No players in the lobby.</p>}
  </ul>
</div>
<div className="spectator-section">
  <h2>Spectators</h2>
  <ul className="spectator-list">
    {lobby?.spectators?.map((spectator) => (
      <li className="spectator-list-item" key={spectator._id}>
        {spectator.nickname || 'Unnamed Spectator'}
      </li>
    )) || <p>No spectators in the lobby.</p>}
  </ul>
</div>
              <div className="lobby-button-container">
              {lobby.status !== 'in-progress' && (
  <button
    className="lobby-button toggle-role-button"
    onClick={handleToggleSpectate}
  >
    {isSpectator ? 'Join Game' : 'Spectate'}
  </button>
)}
<button
  className="lobby-button"
  onClick={handleReturnToHomepage}
>
  Return to Homepage
</button>
</div>  
            </div>
          ) : (
            <p>{message}</p>
          )}
        </div>
      )}
</div>  

  );
};

export default Lobby;
