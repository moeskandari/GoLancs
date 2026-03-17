import { useState, useEffect, useCallback } from 'react';
import './Compass.css';

function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function Compass() {
  const [rotation, setRotation] = useState(0);
  const [isMobile] = useState(isMobileDevice);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const requestPermission = useCallback(async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        setPermissionGranted(result === 'granted');
      } catch {
        setPermissionGranted(false);
      }
    } else {
      setPermissionGranted(true);
    }
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ requires a user gesture; wait for tap
      return;
    }
    // Android and other devices: no permission needed
    setPermissionGranted(true);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile || !permissionGranted) return;

    const handleOrientation = (event) => {
      if (event.webkitCompassHeading != null) {
        // iOS
        setRotation(event.webkitCompassHeading);
      } else if (event.alpha != null) {
        // Android
        setRotation(360 - event.alpha);
      }
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [isMobile, permissionGranted]);

  // Only render on mobile/touch devices
  if (!isMobile) return null;

  // On iOS, show a prompt to enable compass if permission not yet granted
  if (!permissionGranted) {
    return (
      <div className="compass-container">
        <button
          className="compass compass-permission-btn"
          onClick={requestPermission}
          aria-label="Enable compass"
        >
          <span className="compass-enable-label">🧭</span>
        </button>
      </div>
    );
  }

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
