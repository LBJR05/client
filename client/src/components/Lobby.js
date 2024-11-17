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
  const [loadingComplete, setLoadingComplete] = useState(false);
  const { isLoading, showLoading, hideLoading } = useLoading();
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    // Save the current lobbyCode in localStorage
    localStorage.setItem('lobbyCode', lobbyCode);

    const handleBeforeUnload = () => {
      setIsRefreshing(true); // Mark this as a refresh
    };

    // Add event listener for refresh or tab close
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup on component unmount
    return () => {
      // If navigating away (not a refresh), emit leaveLobby
      if (!isRefreshing) {
        socket.emit('leaveLobby', { lobbyCode, playerId: localStorage.getItem('playerId') });
        socket.disconnect(); // Disconnect socket explicitly
        localStorage.removeItem('lobbyCode');
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [lobbyCode, isRefreshing]);

  useEffect(() => {
    showLoading();
    const fetchLobby = async () => {
      try {
        const response = await fetch(`http://localhost:4000/api/lobbies/${lobbyCode}`);
        const data = await response.json();
        if (response.ok) {
          setLobby(data);
        } else {
          setMessage(data.message || 'Failed to fetch lobby');
          localStorage.removeItem('lobbyCode'); // Clear if lobby doesn't exist
        }
      } catch (error) {
        console.error('Error fetching lobby:', error);
        setMessage('Failed to fetch lobby');
        localStorage.removeItem('lobbyCode'); // Clear if error occurs
      } finally {
        hideLoading();
      }
    };

    fetchLobby();

    const playerId = localStorage.getItem('playerId');
    socket.emit('joinLobby', { lobbyCode, playerId });

    socket.on('lobbyUpdated', (updatedLobby) => {
      setLobby(updatedLobby);
    });

    return () => {
      socket.off('lobbyUpdated');
    };
  }, [lobbyCode, showLoading, hideLoading]);

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
