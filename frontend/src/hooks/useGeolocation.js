/**
 * useGeolocation — continuously track the user's GPS position.
 *
 * Falls back through: high-accuracy GPS → low-accuracy → IP geolocation.
 *
 * Returns { userLocation } where userLocation is
 *   { lat, lon, accuracy, heading, speed, timestamp } or null.
 */

import { useEffect, useState } from 'react';

export default function useGeolocation() {
  const [userLocation, setUserLocation] = useState(null);

  useEffect(() => {
    let watchId = null;
    let cancelled = false;

    const setLoc = (lat, lon, accuracy, heading, speed) => {
      if (cancelled) return;
      setUserLocation({
        lat, lon,
        accuracy: accuracy || null,
        heading: heading || null,
        speed: speed || null,
        timestamp: Date.now()
      });
    };

    // Last resort: IP-based geolocation
    const ipFallback = async () => {
      try {
        const res = await fetch('https://ipapi.co/json/');
        if (!res.ok) throw new Error('ipapi failed');
        const data = await res.json();
        if (data.latitude && data.longitude) {
          console.log('Using IP-based geolocation');
          setLoc(data.latitude, data.longitude, 5000);
        }
      } catch {
        try {
          const res = await fetch('https://ip-api.com/json/?fields=lat,lon');
          const data = await res.json();
          if (data.lat && data.lon) {
            console.log('Using IP-based geolocation (fallback 2)');
            setLoc(data.lat, data.lon, 5000);
          }
        } catch (e) {
          console.warn('All geolocation methods failed:', e.message);
        }
      }
    };

    if (!navigator.geolocation) {
      ipFallback();
      return;
    }

    const isSecure = window.isSecureContext;
    if (!isSecure) {
      console.warn('Geolocation blocked: not a secure context. Using IP geolocation.');
      ipFallback();
      return;
    }

    const onSuccess = (pos) => {
      setLoc(
        pos.coords.latitude, pos.coords.longitude,
        pos.coords.accuracy, pos.coords.heading, pos.coords.speed
      );
    };

    let fallbackStarted = false;
    const startFallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      console.log('High-accuracy geolocation failed, falling back to low accuracy');
      watchId = navigator.geolocation.watchPosition(
        onSuccess,
        (err) => {
          console.warn('Geolocation fallback error:', err.message);
          ipFallback();
        },
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 }
      );
    };

    watchId = navigator.geolocation.watchPosition(
      onSuccess,
      (err) => {
        console.warn('Geolocation high-accuracy error:', err.message);
        if (err.code === err.TIMEOUT || err.code === err.POSITION_UNAVAILABLE) {
          navigator.geolocation.clearWatch(watchId);
          startFallback();
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );

    return () => {
      cancelled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  return { userLocation };
}
