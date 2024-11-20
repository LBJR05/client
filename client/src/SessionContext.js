// src/SessionContext.js
import React, { createContext, useState, useEffect } from 'react';
import socket from './socket';

export const SessionContext = createContext();

export const SessionProvider = ({ children }) => {
  const [sessionLost, setSessionLost] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  useEffect(() => {
    socket.on('sessionLost', ({ message }) => {
      setSessionLost(true);
      setAlertMessage(message);
    });

    return () => {
      socket.off('sessionLost');
    };
  }, []);

  const resetSession = () => {
    setSessionLost(false);
    setAlertMessage('');
  };

  return (
    <SessionContext.Provider value={{ sessionLost, alertMessage, resetSession }}>
      {children}
    </SessionContext.Provider>
  );
};
