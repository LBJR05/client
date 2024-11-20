import React, { useEffect, useState, useContext } from 'react';
import './App.css';
import { useLoading, LoadingProvider } from './LoadingContext';
import LoadingScreen from './components/LoadingScreen';
import socket from './socket';
import { useNavigate } from 'react-router-dom';
import { SessionContext } from './SessionContext'; // Import the SessionContext

function App() {
  const { isLoading, showLoading, hideLoading } = useLoading();
  const { sessionLost, alertMessage, resetSession } = useContext(SessionContext); // Access session management
  const [loadingComplete, setLoadingComplete] = useState(false);
  const [nickname, setNickname] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const [lobbyCode, setLobbyCode] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success' or 'error'
  const navigate = useNavigate();

  useEffect(() => {
    console.log('App mounted');
    showLoading();
    hideLoading();

    const playerId = localStorage.getItem('playerId');
      console.log('[App.js] Emitting getOrCreatePlayer');
      socket.emit('getOrCreatePlayer', { playerId, reconnect: true });
  
    socket.on('playerData', ({ playerId, nickname }) => {
      console.log('[App.js] Player data received:', { playerId, nickname });
      localStorage.setItem('playerId', playerId);
      setNickname(nickname); // Update nickname state
    });

    socket.on('nicknameUpdated', ({ newNickname }) => {
      setNickname(newNickname);
      setMessage('Nickname updated successfully.');
      setMessageType('success');
    });

    socket.on('nicknameUpdateFailed', ({ message }) => {
      setMessage(message);
      setMessageType('error');
    });

    return () => {
      console.log('Cleaning up App.js listeners.');
      socket.off('playerData');
      socket.off('nicknameUpdated');
      socket.off('nicknameUpdateFailed');
    };
  }, [showLoading, hideLoading]);

  const handleAnimationEnd = () => {
    console.log('Animation ended');
    setLoadingComplete(true);
  };

  useEffect(() => {
    if (loadingComplete) {
      console.log('Adding fade-in class to content');
      const contentElement = document.querySelector('.content');
      if (contentElement) {
        contentElement.classList.add('fade-in');
      }
    }
  }, [loadingComplete]);

  const handleChangeNickname = () => {
    const playerId = localStorage.getItem('playerId');
    socket.emit('updateNickname', { playerId, newNickname: nickname });
  };

  const handleCreateRoom = async () => {
    const playerId = localStorage.getItem('playerId');
    if (!playerId) {
      setMessage('Player ID not found. Please refresh the page.');
      setMessageType('error');
      return;
    }

    try {
      const response = await fetch('http://localhost:4000/api/lobbies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      const data = await response.json();
      if (response.ok) {
        socket.emit('getOrCreatePlayer', { playerId, reconnect: true }); // Ensure reconnect
        navigate(`/room/${data.lobbyCode}`);
      } else {
        setMessage(data.message || 'Failed to create room');
        setMessageType('error');
      }
    } catch (error) {
      console.error('Error creating room:', error);
      setMessage('Failed to create room');
      setMessageType('error');
    }
  };

  const handleJoinLobby = async () => {
    if (!lobbyCode.trim()) {
      setMessage('Lobby code is required.');
      setMessageType('error');
      return;
    }

    const playerId = localStorage.getItem('playerId');
    if (!playerId) {
      setMessage('Player ID not found. Please refresh the page.');
      setMessageType('error');
      return;
    }

    try {
      const response = await fetch(`http://localhost:4000/api/lobbies/${lobbyCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      const data = await response.json();
      if (response.ok) {
        setLobbyCode(data.lobbyCode);
        socket.emit('getOrCreatePlayer', { playerId, reconnect: true }); // Ensure reconnect
        navigate(`/room/${lobbyCode}`);
      } else {
        setMessage(data.message || 'Failed to join lobby');
        setMessageType('error');
      }
    } catch (error) {
      console.error('Error joining lobby:', error);
      setMessage('Failed to join lobby');
      setMessageType('error');
    }
    setShowPopup(false);
  };

  console.log(`isLoading=${isLoading}, loadingComplete=${loadingComplete}`);
  return (
    <div className="App">
      {sessionLost ? ( // Display session lost overlay if triggered
        <div className="overlay">
          <div className="modal">
            <p>{alertMessage}</p>
            <button onClick={() => resetSession() || window.location.reload()}>Refresh</button>
          </div>
        </div>
      ) : isLoading && !loadingComplete ? (
        <LoadingScreen onAnimationEnd={handleAnimationEnd} />
      ) : (
        <div className="content">
          <div className="nickname-container">
            <p>Enter a nickname</p>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Enter your nickname"
              className="nickname-input"
            />
            <button className="nickname-button" onClick={handleChangeNickname}>
              Change Nickname
            </button>
            {message && <p className={`message ${messageType}`}>{message}</p>}
          </div>
          <div className="lobby-container">
            <button className="lobby-button" onClick={handleCreateRoom}>
              Create Room
            </button>
            <button className="lobby-button" onClick={() => setShowPopup(true)}>
              Join Room
            </button>
          </div>
          {showPopup && (
            <div className="popup-overlay">
              <div className="popup">
                <button className="popup-close-button" onClick={() => setShowPopup(false)}>
                  ×
                </button>
                <p>Enter the lobby code:</p>
                <input
                  type="text"
                  value={lobbyCode}
                  onChange={(e) => setLobbyCode(e.target.value)}
                  placeholder="Lobby Code"
                  className="lobby-input"
                />
                <button className="popup-button" onClick={handleJoinLobby}>
                  Submit
                </button>
                {message && <p className={`message ${messageType}`}>{message}</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const AppWrapper = () => (
  <LoadingProvider>
    <App />
  </LoadingProvider>
);

export default AppWrapper;
