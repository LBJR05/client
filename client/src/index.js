import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import AppWrapper from './App';
import reportWebVitals from './reportWebVitals';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Lobby from './components/Lobby';
import { LoadingProvider } from './LoadingContext'; // Import LoadingProvider

ReactDOM.render(
  <React.StrictMode>
    <LoadingProvider>
      <Router>
        <Routes>
          <Route path="/" element={<AppWrapper />} />
          <Route path="/room/:lobbyCode" element={<Lobby />} />
        </Routes>
      </Router>
    </LoadingProvider>
  </React.StrictMode>,
  document.getElementById('root')
);

reportWebVitals();
