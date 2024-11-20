import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import AppWrapper from './App';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import Lobby from './components/Lobby';
import { LoadingProvider } from './LoadingContext';
import { SessionProvider } from './SessionContext'; // Import the SessionProvider

// DebugRouter logs route changes for debugging
const DebugRouter = () => {
  const location = useLocation();

  useEffect(() => {
    console.log('Route changed to:', location.pathname);
  }, [location]);

  return null;
};

// RoutesWithLocationKey ensures components properly re-render on route changes
const RoutesWithLocationKey = () => {
  const location = useLocation(); // Get the current location

  return (
    <Routes>
      <Route path="/" element={<AppWrapper />} />
      {/* Add the key property for `/room/:lobbyCode` */}
      <Route path="/room/:lobbyCode" element={<Lobby key={location.pathname} />} />
    </Routes>
  );
};

// Render the application with all providers
ReactDOM.render(
  <React.StrictMode>
    <SessionProvider> {/* Wrap the app with SessionProvider for global session handling */}
      <LoadingProvider>
        <Router>
          <DebugRouter />
          <RoutesWithLocationKey />
        </Router>
      </LoadingProvider>
    </SessionProvider>
  </React.StrictMode>,
  document.getElementById('root')
);

reportWebVitals();
