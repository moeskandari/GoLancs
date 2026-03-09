/**
 * useWeather — fetch current-location and destination weather.
 *
 * Returns {
 *   currentWeather, weatherLoading,
 *   destWeather, destWeatherLoading,
 *   weatherSidebarOpen, setWeatherSidebarOpen
 * }
 */

import { useEffect, useState } from 'react';
import { fetchWeather } from '../services/api';

export default function useWeather(userLocation, endStop) {
  const [currentWeather, setCurrentWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [destWeather, setDestWeather] = useState(null);
  const [destWeatherLoading, setDestWeatherLoading] = useState(false);
  const [weatherSidebarOpen, setWeatherSidebarOpen] = useState(false);

  // Fetch weather for current location
  const userLat = userLocation?.lat;
  const userLon = userLocation?.lon;
  useEffect(() => {
    if (!userLat || !userLon) return;
    let cancelled = false;
    const load = async () => {
      setWeatherLoading(true);
      try {
        const data = await fetchWeather(userLat, userLon);
        if (!cancelled) setCurrentWeather(data);
      } catch (e) {
        console.warn('Failed to fetch current weather:', e.message);
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [userLat, userLon]);

  // Fetch weather for destination
  useEffect(() => {
    if (!endStop?.lat || !endStop?.lon) { setDestWeather(null); return; }
    let cancelled = false;
    const load = async () => {
      setDestWeatherLoading(true);
      try {
        const data = await fetchWeather(endStop.lat, endStop.lon);
        if (!cancelled) setDestWeather(data);
      } catch (e) {
        console.warn('Failed to fetch destination weather:', e.message);
      } finally {
        if (!cancelled) setDestWeatherLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [endStop?.lat, endStop?.lon]);

  return {
    currentWeather, weatherLoading,
    destWeather, destWeatherLoading,
    weatherSidebarOpen, setWeatherSidebarOpen,
  };
}
