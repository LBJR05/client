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
  const [lobby, setLobby] = useState(null);
  const [message, setMessage] = useState('');
  const [loadingComplete, setLoadingComplete] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);

useEffect(() => {
  console.log('Lobby.js mounted');

  const playerId = localStorage.getItem('playerId');
    console.log('Emitting getOrCreatePlayer');
    socket.emit('getOrCreatePlayer', { playerId, reconnect: true });

  socket.on('playerData', ({ playerId }) => {
    localStorage.setItem('playerId', playerId);
  });

  socket.on('lobbyUpdated', (updatedLobby) => {
    setLobby(updatedLobby);
    const player = updatedLobby.players.find(p => p.uuid === playerId);
    const spectator = updatedLobby.spectators.find(s => s.uuid === playerId);
    setIsSpectator(!!spectator && !player);
  });


  return () => {
    console.log('Lobby.js unmounting');
    socket.off('lobbyUpdated');
    socket.off('playerData');
  };
}, [lobbyCode]);


  const handleReturnToHomepage = () => {
    const playerId = localStorage.getItem('playerId');

    socket.emit('deleteLobbyAndNavigate', { lobbyCode, playerId });

    socket.once('lobbyDeleted', ({ message }) => {
      console.log(message);
      navigate('/'); // Navigate to homepage
      // Emit getOrCreatePlayer to refresh nickname
    });

    socket.once('error', (err) => {
      console.error(err);
      alert('Error deleting the lobby. Please try again.');
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
          {lobby ? (
            <div className="lobbyinfo-container">
              <div className="lobby-header">
                <h1 className="lobby-code">Lobby Code: {lobby.lobbyCode}</h1>
                <p className="lobby-status">Status: {lobby.status}</p>
              </div>
              <div className="player-section">
                <h2>Players</h2>
                <ul className="player-list">
                  {lobby.players.map((player) => (
                    <li className="player-list-item" key={player._id}>
                      {player.nickname || 'Unnamed Player'}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="spectator-section">
                <h2>Spectators</h2>
                <ul className="spectator-list">
                  {lobby.spectators.map((spectator) => (
                    <li className="spectator-list-item" key={spectator._id}>
                      {spectator.nickname || 'Unnamed Spectator'}
                    </li>
                  ))}
                </ul>
              </div>
              <button
  className="lobby-button toggle-role-button"
  onClick={handleToggleSpectate}
>
  {isSpectator ? 'Join Game' : 'Spectate'}
</button>
<button
  className="lobby-button"
  onClick={handleReturnToHomepage}
>
  Return to Homepage
</button>
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
