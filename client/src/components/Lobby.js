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
  const [questioningPlayer, setQuestioningPlayer] = useState(''); // Track the player being questioned
  const [question, setQuestion] = useState(''); // Track the question being asked
  const [remainingPlayers, setRemainingPlayers] = useState([]); // Track the remaining players to be questioned
  const [currentQuestion, setCurrentQuestion] = useState(''); // Track the current question for answering phase
  const [answer, setAnswer] = useState(''); // Track the answer being provided
  const [controlsDisabled, setControlsDisabled] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [gamePhase, setGamePhase] = useState('questioning'); // Track the game phase
const [hotseatNickname, setHotseatNickname] = useState(''); // Track hotseat player's name




  // Add a state for the hotseat player's guess
const [guess, setGuess] = useState(1); // Default guess is 1

  

  const [chatMessages, setChatMessages] = useState([
    { type: 'system', text: 'Welcome to the game!' },
  ]);


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
        setRoundNumber(updatedLobby.game.roundsPlayed); // Update the round number state
    
        // Filter out players who have already been questioned
        const remaining = updatedLobby.players.filter(
          (p) => !updatedLobby.game.answeredPlayers.includes(p.uuid) && p.uuid !== updatedLobby.game.hotseat.uuid
        );
        setRemainingPlayers(remaining);
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
      setRemainingPlayers(
        lobby.players.filter((p) => lobby?.game?.hotseat?.uuid && p.uuid !== lobby.game.hotseat.uuid)
      );
      
    });
    console.log('[Lobby.js] Listening for questionReceived event');
    socket.on('questionReceived', ({ question }) => {
      console.log(`[questionReceived] Question received: ${question}`);
      setCurrentQuestion(question);
    });

    socket.on('enableControls', ({ message }) => {
      console.log('[Lobby.js] Controls enabled for hotseat:', message);
      setControlsDisabled(false); // Enable the controls for the hotseat player
    });

    socket.on('disableControls', ({ message }) => {
      console.log('[Lobby.js] Controls disabled:', message);
      setControlsDisabled(true);
    });

    socket.on('answerReceived', async ({ answer, playerNickname }) => {
      console.log(`[answerReceived] Answer received from ${playerNickname}: ${answer}`);
      console.log(`[answerReceived] Current playerId: ${playerId}`);
    
      try {
        // Fetch the latest lobby data
        const response = await fetch(`http://localhost:4000/api/lobbies/${lobbyCode}`);
        const updatedLobby = await response.json();
    
        if (!response.ok || !updatedLobby || !updatedLobby.players) {
          console.error('[fetchLobby] Failed to fetch lobby or players missing.');
          return;
        }
    
        const localPlayer = updatedLobby.players.find((p) => p.uuid === playerId);
        const isSelf = localPlayer && localPlayer.nickname === playerNickname;
    
        console.log('[answerReceived] Local player:', localPlayer);
        console.log('[answerReceived] Is message from self?', isSelf);
    
        setChatMessages((prevMessages) => [
          ...prevMessages,
          {
            type: 'player',
            sender: isSelf ? 'self' : 'other',
            text: `${playerNickname}: ${answer}`,
          },
        ]);
      } catch (error) {
        console.error('[answerReceived] Error fetching lobby:', error);
      }
    });
    
    socket.on('questionBroadcast', async ({ question, questioningPlayerNickname }) => {
      console.log(`[questionBroadcast] ${questioningPlayerNickname}: ${question}`);
      console.log(`[questionBroadcast] Current playerId: ${playerId}`);
    
      try {
        // Fetch the latest lobby data
        const response = await fetch(`http://localhost:4000/api/lobbies/${lobbyCode}`);
        const updatedLobby = await response.json();
    
        if (!response.ok || !updatedLobby || !updatedLobby.players) {
          console.error('[fetchLobby] Failed to fetch lobby or players missing.');
          return;
        }
    
        const localPlayer = updatedLobby.players.find((p) => p.uuid === playerId);
        const isSelf = localPlayer && localPlayer.nickname === questioningPlayerNickname;
    
        console.log('[questionBroadcast] Local player:', localPlayer);
        console.log('[questionBroadcast] Is message from self?', isSelf);
    
        setChatMessages((prevMessages) => [
          ...prevMessages,
          {
            type: 'player',
            sender: isSelf ? 'self' : 'other',
            text: `${questioningPlayerNickname}: ${question}`,
          },
        ]);
      } catch (error) {
        console.error('[questionBroadcast] Error fetching lobby:', error);
      }
    });
    
    
    socket.on('phaseChanged', ({ phase, hotseatNickname }) => {
      console.log(`[phaseChanged] Phase changed to: ${phase}`);
      setGamePhase(phase); // Update the game phase
      setHotseatNickname(hotseatNickname || 'Unknown Player');
  
      if (phase === 'questioning') {
        console.log('Transitioning to questioning phase...');
      }
      if (phase === 'guessing') {
        console.log(`${hotseatNickname || 'Unknown Player'} is about to guess.`);
        setChatMessages((prev) => [
          ...prev,
          { type: 'system', text: `${hotseatNickname || 'Unknown Player'} is about to guess.` },
        ]);
      }
    });

    socket.on('guessResult', ({ nickname, guessedNumber, isCorrect }) => {
      const resultText = `${nickname} has guessed ${guessedNumber}! That is ${isCorrect ? 'correct' : 'wrong'}!`;
      setChatMessages((prevMessages) => [
        ...prevMessages,
        { type: 'system', text: resultText },
      ]);
    });
  
    socket.on('gameFinished', ({ message }) => {
      console.log('[gameFinished] Game has finished:', message);
      setGamePhase('finished');
      setHotseat(null);
      setSecretNumber(null);
      setChatMessages((prevMessages) => [
        ...prevMessages,
        { type: 'system', text: message },
      ]);
    });
  
    

    return () => {
      console.log('Lobby.js unmounting');
      socket.off('playerData');
      socket.off('lobbyUpdated');
      socket.off('roundStarted');
      socket.off('questionReceived');
      socket.off('disableControls');
      socket.off('answerReceived');
      socket.off('questionBroadcast');
      socket.off('phaseChanged');
      socket.off('enableControls');
      socket.off('guessResult');
      socket.off('gameFinished');
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

  const handleQuestionSubmit = () => {
    if (questioningPlayer && question) {
      socket.emit('submitQuestion', { lobbyCode, questioningPlayer, question });
      setQuestioningPlayer(''); // Reset the questioning player
      setQuestion(''); // Reset the question
    }
  };

  const handleRandomizeQuestion = () => {
    const randomQuestions = [
      "What's your favorite color?",
      "What's your favorite movie?",
      "What's your favorite food?",
      "What's your favorite hobby?",
      "What's your favorite book?"
    ];
    const randomQuestion = randomQuestions[Math.floor(Math.random() * randomQuestions.length)];
    setQuestion(randomQuestion);
  };

  const handleAnswerSubmit = () => {
    const playerId = localStorage.getItem('playerId'); // Retrieve playerId from localStorage
    if (answer && playerId) {
      socket.emit('submitAnswer', { lobbyCode, answer, playerId });
      setAnswer(''); // Reset the answer input field
      setCurrentQuestion(''); // Clear the current question
    }
  };

  const handleGuessSubmit = () => {
    const playerId = localStorage.getItem('playerId'); // Retrieve playerId from localStorage
    if (guess && playerId) {
      socket.emit('submitGuess', { lobbyCode, guess, playerId });
      console.log(`Guess submitted: ${guess}`);
    } else {
      console.warn('Guess or player ID is missing!');
    }
  };
  

  console.log('Rendering Lobby component');
  console.log('Hotseat:', hotseat);
  console.log('Player ID:', playerId);

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

          {gamePhase === 'finished' && <div>Game Over. Thank you for playing!</div>}

          {gamePhase === 'guessing' ? (
  // Guessing Phase
  hotseat && hotseat.uuid === playerId ? (
    // For Hotseat Player
    <div className="guessing-phase">
      <h3>Make your guess!</h3>
      <input
        type="range"
        min="1"
        max="10"
        value={guess || 5} // Use 'guess' state instead of 'secretNumber'
        onChange={(e) => setGuess(Number(e.target.value))} // Update 'guess' state
        className="slider"
      />
      <div className="guess-display">Your Guess: {guess}</div>
      <button onClick={handleGuessSubmit}>
        Submit
      </button>
    </div>
  ) : (
    // For Other Players
    <div className="guessing-phase">
      <p>{hotseatNickname} is making their guess!</p>
    </div>
  )
) : (
    // Questioning Phase
    hotseat && hotseat.uuid === playerId ? (
      <div className="questioning-phase">
        <p>You are in the hotseat!</p>
        {controlsDisabled ? (
          <p>Waiting for the questioned player's response...</p>
        ) : (
          <div>
            <div className="input-container">
              <select
                value={questioningPlayer}
                onChange={(e) => setQuestioningPlayer(e.target.value)}
                disabled={controlsDisabled}
              >
                <option value="">Select a player</option>
                {remainingPlayers.map((player) => (
                  <option key={player.uuid} value={player.uuid}>
                    {player.nickname}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Type your question here"
                disabled={controlsDisabled}
              />
            </div>
            <div className="button-container">
              <button onClick={handleQuestionSubmit} disabled={controlsDisabled}>
                Submit
              </button>
              <button onClick={handleRandomizeQuestion} disabled={controlsDisabled}>
                Randomize
              </button>
            </div>
          </div>
        )}
      </div>
    ) : currentQuestion ? (
      <div className="answering-phase">
        <p className="question">{currentQuestion}</p>
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer here"
        />
        <button onClick={handleAnswerSubmit}>Submit</button>
      </div>
    ) : null
  )}
</div>
          {/* Game Chat */}
          <div className="game-chat-container">
          <div className="chat-messages">
  {chatMessages.map((message, index) => (
    <div 
      key={index} 
      className={`chat-message ${message.type} ${message.sender === 'self' ? 'chat-message-self' : 'chat-message-other'}`}
    >
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