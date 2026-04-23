import { useEffect, useState, useRef } from 'react';

/**
 * useGeolocationSimulator
 * - positions: array of { lat, lon, accuracy?, heading?, speed? }
 * - intervalMs: playback interval in ms
 * - loop: whether to loop
 *
 * The hook also reads `window.__GEO_SIM_POSITIONS` if present so
 * you can update positions from the browser console during a run.
 */
export default function useGeolocationSimulator(positions = [], intervalMs = 1500, loop = true) {
  const [userLocation, setUserLocation] = useState(null);
  const idxRef = useRef(0);
  const timerRef = useRef(null);
  const posRef = useRef(positions || []);

  useEffect(() => {
    if (Array.isArray(window.__GEO_SIM_POSITIONS) && window.__GEO_SIM_POSITIONS.length > 0) {
      posRef.current = window.__GEO_SIM_POSITIONS;
    } else {
      posRef.current = positions;
    }

    if (!posRef.current || posRef.current.length === 0) return undefined;

    const start = () => {
      timerRef.current = setInterval(() => {
        const p = posRef.current[idxRef.current % posRef.current.length];
        setUserLocation({
          lat: p.lat,
          lon: p.lon,
          accuracy: p.accuracy || 15,
          heading: p.heading ?? null,
          speed: p.speed ?? null,
          timestamp: Date.now()
        });
        idxRef.current += 1;
        if (!loop && idxRef.current >= posRef.current.length) {
          clearInterval(timerRef.current);
        }
      }, intervalMs);
    };

    start();

    const handleUpdate = () => {
      if (Array.isArray(window.__GEO_SIM_POSITIONS) && window.__GEO_SIM_POSITIONS.length > 0) {
        posRef.current = window.__GEO_SIM_POSITIONS;
        idxRef.current = 0;
      }
    };
    window.addEventListener('__GEO_SIM_UPDATE', handleUpdate);

    return () => {
      clearInterval(timerRef.current);
      window.removeEventListener('__GEO_SIM_UPDATE', handleUpdate);
    };
  }, [positions, intervalMs, loop]);

  // Quick console helpers
  useEffect(() => {
    window.__GEO_SIM_SET = (arr) => { window.__GEO_SIM_POSITIONS = arr; window.dispatchEvent(new Event('__GEO_SIM_UPDATE')); };
    window.__GEO_SIM_STOP = () => { window.__GEO_SIM_POSITIONS = []; window.dispatchEvent(new Event('__GEO_SIM_UPDATE')); };
    return () => {
      delete window.__GEO_SIM_SET;
      delete window.__GEO_SIM_STOP;
    };
  }, []);

  return { userLocation };
}
