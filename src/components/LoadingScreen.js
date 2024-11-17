// client/src/components/LoadingScreen.js
import React, { useEffect, useState } from 'react';
import { ReactComponent as ECGLine } from '../ecg.svg';
import './LoadingScreen.css';

const LoadingScreen = ({ onAnimationEnd }) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    console.log('LoadingScreen mounted');
    const timer = setTimeout(() => {
      console.log('Timer ended');
      setIsVisible(false); // Trigger fade-out
      setTimeout(() => {
        console.log('Fade-out ended');
        onAnimationEnd(); // Trigger after fade-out completes
      }, 1000); // Allow fade-out animation (1s)
    }, 3000); // Match trace animation duration
  
    return () => {
      console.log('LoadingScreen unmounted');
      clearTimeout(timer);
    };
  }, [onAnimationEnd]);

  return (
    <div className={`loading-screen ${!isVisible ? 'fade-out' : ''}`}>
      <ECGLine className="loading-ecg-line" alt="ECG line" />
      <p className="loading-text">Wavelength</p>
    </div>
  );
};

export default LoadingScreen;