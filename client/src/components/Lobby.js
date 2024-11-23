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
  const [isHost, setIsHost] = useState(false); // Track if the current player is the host
  const [hotseat, setHotseat] = useState(null); // Track the current hotseat player
  const [secretNumber, setSecretNumber] = useState(null); // Track the secret number
  const [roundNumber, setRoundNumber] = useState(0); // Track the current round number

  const playerId = localStorage.getItem('playerId');

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

    socket.on('playerData', ({ playerId }) => {
      localStorage.setItem('playerId', playerId);
    });

    socket.on('lobbyUpdated', (updatedLobby) => {
      console.log('Lobby updated:', updatedLobby);
      setLobby(updatedLobby); // Update the lobby state

      // Log the lobby and game details
      console.log('Lobby Details:', JSON.stringify(updatedLobby, null, 2));
      if (updatedLobby.game) {
        console.log('Game Details:', JSON.stringify(updatedLobby.game, null, 2));
        setHotseat(updatedLobby.game.hotseat);
        setSecretNumber(updatedLobby.game.secretNumber);
      }

      // Determine if the current player is the host
      setIsHost(updatedLobby?.host?.uuid === playerId);

      // Determine if the player is a spectator
      const player = updatedLobby?.players?.find((p) => p.uuid === playerId);
      const spectator = updatedLobby?.spectators?.find((s) => s.uuid === playerId);
      setIsSpectator(!!spectator && !player);
    });

    socket.on('roundStarted', ({ roundNumber, hotseatPlayer, secretNumber }) => {
      console.log(`Round ${roundNumber + 1} started with hotseat player: ${hotseatPlayer.nickname}`);
      setRoundNumber(roundNumber);
      setHotseat(hotseatPlayer);
      setSecretNumber(secretNumber);
    });

    return () => {
      console.log('Lobby.js unmounting');
      socket.off('playerData');
      socket.off('lobbyUpdated');
      socket.off('roundStarted');
    };
  }, [lobbyCode]);

  useEffect(() => {
    console.log('Lobby.js mounted');

    const playerId = localStorage.getItem('playerId');
    console.log('Emitting getOrCreatePlayer');
    socket.emit('getOrCreatePlayer', { playerId, reconnect: true });

    socket.on('playerData', ({ playerId }) => {
      localStorage.setItem('playerId', playerId);
    });

    socket.on('lobbyUpdated', (updatedLobby) => {
      console.log('Lobby updated:', updatedLobby);
      setLobby(updatedLobby); // Update the lobby state

      // Log the lobby and game details
      console.log('Lobby Details:', JSON.stringify(updatedLobby, null, 2));
      if (updatedLobby.game) {
        console.log('Game Details:', JSON.stringify(updatedLobby.game, null, 2));
        setHotseat(updatedLobby.game.hotseat);
        setSecretNumber(updatedLobby.game.secretNumber);
        setRoundNumber(updatedLobby.game.roundsPlayed); // Update the round number state
      } else {
        // Reset the secret number and round number if the game is finished
        setSecretNumber(null);
        setRoundNumber(0);
      }
  
      // Determine if the current player is the host
      setIsHost(updatedLobby?.host?.uuid === playerId);

      // Determine if the player is a spectator
      const player = updatedLobby?.players?.find((p) => p.uuid === playerId);
      const spectator = updatedLobby?.spectators?.find((s) => s.uuid === playerId);
      setIsSpectator(!!spectator && !player);
    });

    socket.on('roundStarted', ({ roundNumber, hotseatPlayer, secretNumber }) => {
      console.log(`[roundStarted] Round ${roundNumber + 1} started with hotseat player: ${hotseatPlayer.nickname}`);
      console.log(`[roundStarted] Secret number: ${secretNumber}`);
      setRoundNumber(roundNumber); // Update the round number state
      setHotseat(hotseatPlayer);
      setSecretNumber(secretNumber);
    });

    return () => {
      console.log('Lobby.js unmounting');
      socket.off('playerData');
      socket.off('lobbyUpdated');
      socket.off('roundStarted');
    };
  }, [lobbyCode]);

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
    socket.emit('startGame', { lobbyCode, playerId });

    // Add a listener for errors if the server doesn't handle the request
    socket.once('error', (err) => {
      console.error('Error starting game:', err.message);
    });
  };

  const handleNextRound = () => {
    console.log(`Handling the next round.`);
  
    const nextRoundNumber = roundNumber + 1;
    console.log(`Next round number: ${nextRoundNumber}`);
  
    socket.emit('nextRound', { lobbyCode, roundNumber: nextRoundNumber });
  
    // Add a listener for errors if the server doesn't handle the request
    socket.once('error', (err) => {
      console.error('Error starting next round:', err.message);
    });
  };

  const handleToggleSpectate = () => {
    const playerId = localStorage.getItem('playerId');
    socket.emit('toggleSpectate', { playerId, lobbyCode });
  };

  const handleReturnToHomepage = () => {
    console.log('Return to Homepage button clicked');
    const playerId = localStorage.getItem('playerId');
    socket.emit('removePlayerFromLobby', { playerId, lobbyCode });
    navigate('/');
  };

  const handleAnimationEnd = () => {
    setLoadingComplete(true);
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
          <div className="wavelength-title">Wavelength</div>
          <div className="game-controls-container">
            <h2>Game Controls</h2>
          </div>
          {/* Game Chat */}
          <div className="game-chat-container">
            <div className="chat-messages">
              {[
                { type: 'system', text: 'Welcome to the game!' },
                { type: 'other', text: 'Player1 has joined the lobby.' },
                { type: 'other', text: 'Player2: Hello, everyone!' },
                { type: 'event', text: 'The game has started!' },
                { type: 'system', text: 'The Secret Number is being guessed...' },
              ].map((message, index) => (
                <div key={index} className={`chat-message ${message.type}`}>
                  {message.text}
                </div>
              ))}
            </div>
          </div>
          {/* Display the secret number */}
          <div className="secretnumber-container">
            <p className="secretnumber-label">Secret Number:</p>
            <div className="secretnumber">
              {hotseat && hotseat.uuid === playerId ? "?" : secretNumber || "?"}
            </div>
          </div>
          {lobby ? (
            <div className="lobbyinfo-container">
              <div className="lobby-header">
                <h1 className="lobby-code">Lobby Code: {lobby.lobbyCode}</h1>
                <p className="lobby-status">Status: {lobby.status}</p>
                {/* Show Start Game button only if the current player is the host */}
                {isHost && lobby.status === 'waiting' && lobby.players.length >= 2 && (
                  <button
                    className="lobby-button start-game-button"
                    onClick={handleStartGame}
                  >
                    Start Game
                  </button>
                )}
                {/* Show Next Round button only if the current player is the host */}
                {isHost && lobby.status === 'in-progress' && (
                  <button
                    className="lobby-button next-round-button"
                    onClick={handleNextRound}
                  >
                    Next Round
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
