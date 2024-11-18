import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import socket from '../socket';
import { useLoading } from '../LoadingContext';
import LoadingScreen from './LoadingScreen';
import './Lobby.css';

const Lobby = () => {
  const { lobbyCode } = useParams();
  const navigate = useNavigate();
  const [lobby, setLobby] = useState(null);
  const [message, setMessage] = useState('');
  const { isLoading, showLoading, hideLoading } = useLoading();
  const [loadingComplete, setLoadingComplete] = useState(false); // Animation state

  useEffect(() => {
    console.log('Lobby.js mounted');
  
    const playerId = localStorage.getItem('playerId');
    socket.emit('getOrCreatePlayer', { playerId, reconnect: true }); // Ensure reconnect is true
  
  
    socket.on('playerData', ({ playerId }) => {
      localStorage.setItem('playerId', playerId);
    });

    socket.on('lobbyUpdated', (updatedLobby) => {
      setLobby(updatedLobby);
    });

    // Simplified cleanup that won't trigger disconnection
    return () => {
      console.log(`Lobby.js unmounting for lobbyCode: ${lobbyCode}`);
      socket.off('lobbyUpdated');
      socket.off('playerData');
    };
  }, [lobbyCode]);

  // Handle returning to the homepage
  const handleReturnToHomepage = () => {
    const playerId = localStorage.getItem('playerId');
    
    // Emit a specific event to delete the lobby without disconnecting the socket
    socket.emit('deleteLobbyAndNavigate', { lobbyCode, playerId });
  
    // Listen for confirmation and navigate without cleanup
    socket.once('lobbyDeleted', ({ message }) => {
      console.log(message);
      navigate('/'); // Navigate to homepage
    });
  
    socket.once('error', (err) => {
      console.error(err);
      alert('Error deleting the lobby. Please try again.');
    });
  };

  // Remove the location change effect entirely

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
      setLobby(updatedLobby);
    });

    return () => {
      console.log(`Lobby.js unmounting for lobbyCode: ${lobbyCode}`);
      const playerId = localStorage.getItem('playerId');
      
      // Only emit leaveLobby if we're not navigating to homepage
      if (!window.location.pathname.includes('/room/')) {
        socket.emit('leaveLobby', { lobbyCode, playerId });
      }
      
      socket.off('lobbyUpdated');
    };
  }, [lobbyCode, navigate, showLoading, hideLoading]);

  // Handle animation end
  const handleAnimationEnd = () => {
    setLoadingComplete(true);
  };

  useEffect(() => {
    if (!lobby && !isLoading && !loadingComplete) {
      setMessage('Lobby not found. Redirecting to homepage...');
      setTimeout(() => navigate('/'), 3000); // Redirect after 3 seconds
    }
  }, [lobby, isLoading, loadingComplete, navigate]);

  return (
    <div className="lobby-app">
      {isLoading && !loadingComplete ? (
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
                className="return-home-button"
                onClick={handleReturnToHomepage} // Navigate back to homepage
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