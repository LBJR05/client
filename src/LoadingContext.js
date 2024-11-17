// client/src/LoadingContext.js
import React, { createContext, useState, useContext, useCallback } from 'react';

const LoadingContext = createContext();

export const useLoading = () => useContext(LoadingContext);

export const LoadingProvider = ({ children }) => {
  const [isLoading, setIsLoading] = useState(true); // Start with loading state as true

  const showLoading = useCallback(() => setIsLoading(true), []);
  const hideLoading = useCallback(() => {}, []); // No direct state update here
  return (
    <LoadingContext.Provider value={{ isLoading, showLoading, hideLoading }}>
      {children}
    </LoadingContext.Provider>
  );
};