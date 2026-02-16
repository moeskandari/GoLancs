import React, { useState, useEffect } from 'react';
import './Compass.css';

function Compass() {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    // Check if device supports orientation
    if (window.DeviceOrientationEvent) {
      const handleOrientation = (event) => {
        // Get the compass heading (alpha value)
        if (event.webkitCompassHeading) {
          // iOS
          setRotation(event.webkitCompassHeading);
        } else if (event.alpha) {
          // Android
          setRotation(360 - event.alpha);
        }
      };

      window.addEventListener('deviceorientation', handleOrientation);
      
      return () => {
        window.removeEventListener('deviceorientation', handleOrientation);
      };
    }
  }, []);

  return (
    <div className="compass-container">
      <div className="compass" style={{ transform: `rotate(${rotation}deg)` }}>
        <div className="compass-needle">
          <div className="needle-north"></div>
          <div className="needle-south"></div>
        </div>
        <div className="compass-labels">
          <span className="label-n">N</span>
          <span className="label-e">E</span>
          <span className="label-s">S</span>
          <span className="label-w">W</span>
        </div>
      </div>
    </div>
  );
}

export default Compass;
