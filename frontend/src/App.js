import React, { useEffect, useState, useCallback } from 'react';
import './App.css';
import MapView from './components/MapView';
import BottomControls from './components/BottomControls';
import SearchBar from './components/SearchBar';
import RouteResults from './components/RouteResults';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const MAX_ROUTES = 3;

// Geocode free text to coordinates via the backend Nominatim proxy
async function geocodeText(text) {
  try {
    const res = await fetch(`${API_URL}/api/geocode?q=${encodeURIComponent(text)}`);
    const places = await res.json();
    if (places && places.length > 0) {
      return {
        type: 'place',
        name: places[0].name,
        common_name: places[0].name,
        lat: places[0].lat,
        lon: places[0].lon,
        category: places[0].category
      };
    }
  } catch (err) {
    console.error('Geocode failed:', err);
  }
  return null;
}

function App() {
  const [userLocation, setUserLocation] = useState(null);
  const [startStop, setStartStop] = useState(null);
  const [endStop, setEndStop] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [sortBy, setSortBy] = useState('duration');
  const [departureTime, setDepartureTime] = useState('');

  // Continuously track user's live GPS location
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp
        });
      },
      (err) => console.warn('Geolocation error:', err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Set the start location to the user's current GPS position
  const useMyLocation = useCallback(async () => {
    if (!userLocation) return;
    // Immediately set coords so route planning can work
    const loc = {
      type: 'place',
      name: 'My Location',
      common_name: 'My Location',
      lat: userLocation.lat,
      lon: userLocation.lon,
      isUserLocation: true
    };
    setStartStop(loc);
    // Reverse-geocode for a human-readable name in the background
    try {
      const res = await fetch(`${API_URL}/api/reverse-geocode?lat=${userLocation.lat}&lon=${userLocation.lon}`);
      const data = await res.json();
      if (data.name && data.name !== 'My Location') {
        setStartStop(prev => prev?.isUserLocation ? { ...prev, name: `📍 ${data.name}`, common_name: `📍 ${data.name}` } : prev);
      }
    } catch (e) { /* keep 'My Location' */ }
  }, [userLocation]);

  // Swap start and end stops
  const swapStops = () => {
    const temp = startStop;
    setStartStop(endStop);
    setEndStop(temp);
    setRoutes(null);
    setSelectedRoute(null);
  };

  // Find routes between start and end
  const findRoutes = useCallback(async () => {
    // Resolve any free-text inputs to coordinates via geocoding
    let resolvedStart = startStop;
    let resolvedEnd = endStop;

    setRouteLoading(true);
    setRouteError(null);

    // If user just typed text without selecting, geocode it to get centre coordinates
    if (resolvedStart?.type === 'text') {
      resolvedStart = await geocodeText(resolvedStart.text);
      if (resolvedStart) setStartStop(resolvedStart);
    }
    if (resolvedEnd?.type === 'text') {
      resolvedEnd = await geocodeText(resolvedEnd.text);
      if (resolvedEnd) setEndStop(resolvedEnd);
    }

    if (!resolvedStart || !resolvedEnd) {
      setRouteError('Could not find one or both locations. Try a more specific name or pick from the suggestions.');
      setRouteLoading(false);
      return;
    }

    // Check for same location
    if (resolvedStart.atco_code && resolvedEnd.atco_code && resolvedStart.atco_code === resolvedEnd.atco_code) {
      setRouteError('Start and end locations must be different');
      return;
    }
    if (resolvedStart.lat === resolvedEnd.lat && resolvedStart.lon === resolvedEnd.lon) {
      setRouteError('Start and end locations must be different');
      return;
    }

    setRoutes(null);
    setSelectedRoute(null);

    try {
      const now = new Date();
      const time = departureTime || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const day = (now.getDay() + 6) % 7;

      // Build query params based on whether selections are stops or places
      const params = new URLSearchParams();
      params.set('time', time);
      params.set('day', day);
      params.set('sort', sortBy);

      if (resolvedStart.type === 'stop' && resolvedStart.atco_code) {
        params.set('start', resolvedStart.atco_code);
      } else {
        // Place — send coordinates
        params.set('startLat', resolvedStart.lat);
        params.set('startLon', resolvedStart.lon);
        params.set('startName', resolvedStart.name || resolvedStart.common_name || 'Start');
      }

      if (resolvedEnd.type === 'stop' && resolvedEnd.atco_code) {
        params.set('end', resolvedEnd.atco_code);
      } else {
        params.set('endLat', resolvedEnd.lat);
        params.set('endLon', resolvedEnd.lon);
        params.set('endName', resolvedEnd.name || resolvedEnd.common_name || 'Destination');
      }

      const res = await fetch(`${API_URL}/api/plan?${params.toString()}`);
      const data = await res.json();

      if (data.error) {
        setRouteError(data.error);
      } else {
        const limited = {
          ...data,
          routes: data.routes.slice(0, MAX_ROUTES),
          totalRoutes: Math.min(data.totalRoutes, MAX_ROUTES),
          usingTime: departureTime ? time : `Now (${time.substring(0, 5)})`
        };
        setRoutes(limited);
        if (limited.routes.length > 0) {
          setSelectedRoute(0);
        }
      }
    } catch (err) {
      setRouteError('Failed to connect to server. Please try again.');
      console.error('Route planning error:', err);
    } finally {
      setRouteLoading(false);
    }
  }, [startStop, endStop, sortBy, departureTime]);

  // Handle sort change and re-fetch
  const handleSortChange = (newSort) => {
    setSortBy(newSort);
  };

  // Re-fetch when sort changes (if we already have routes)
  useEffect(() => {
    if (routes && startStop && endStop) {
      findRoutes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  return (
    <div className="App">
      <div className="search-container">
        <div className="search-inputs-row">
          <div className="search-fields">
            <SearchBar
              placeholder="Where are you travelling from?"
              type="start"
              value={startStop}
              onChange={setStartStop}
              onUseMyLocation={useMyLocation}
              hasUserLocation={!!userLocation}
            />
            <SearchBar
              placeholder="Where are you going?"
              type="end"
              value={endStop}
              onChange={setEndStop}
            />
          </div>
          <button
            className="swap-btn"
            onClick={swapStops}
            title="Swap start and destination"
            aria-label="Swap start and destination"
          >
            ⇅
          </button>
        </div>
        <div className="search-controls">
          <div className="time-wrapper">
            <input
              type="time"
              className="time-input"
              value={departureTime ? departureTime.substring(0, 5) : ''}
              onChange={(e) => setDepartureTime(e.target.value ? e.target.value + ':00' : '')}
              aria-label="Departure time"
            />
            {!departureTime && <span className="time-hint">Now</span>}
          </div>
          <button
            className="route-btn"
            onClick={findRoutes}
            disabled={routeLoading}
          >
            {routeLoading ? '⏳ Searching...' : '🔍 Find Routes'}
          </button>
        </div>
        {routeError && (
          <div className="route-error" role="alert">
            <span className="error-icon">⚠️</span> {routeError}
          </div>
        )}
      </div>

      <MapView
        userLocation={userLocation}
        startLocation={startStop}
        endLocation={endStop}
        routes={routes}
        selectedRoute={selectedRoute}
        onLocateMe={useMyLocation}
      />

      {routes && (
        <RouteResults
          routes={routes}
          selectedRoute={selectedRoute}
          onSelectRoute={setSelectedRoute}
          sortBy={sortBy}
          onSortChange={handleSortChange}
        />
      )}

      <BottomControls />
    </div>
  );
}

export default App;
