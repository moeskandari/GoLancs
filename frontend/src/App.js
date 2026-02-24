import React, { useEffect, useState, useCallback } from 'react';
import './App.css';
import MapView from './components/MapView';
import BottomControls from './components/BottomControls';
import SearchBar from './components/SearchBar';
import RouteResults from './components/RouteResults';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function App() {
  const [userLocation, setUserLocation] = useState(null);
  const [allStops, setAllStops] = useState([]);
  const [startStop, setStartStop] = useState(null);
  const [endStop, setEndStop] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [sortBy, setSortBy] = useState('departure');
  const [departureTime, setDepartureTime] = useState('');

  // Get user's location on mount
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude])
    );
  }, []);

  // Fetch all stops for search autocomplete
  useEffect(() => {
    const fetchStops = async () => {
      try {
        const res = await fetch(`${API_URL}/api/stops`);
        const data = await res.json();
        setAllStops(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to fetch stops:', err);
      }
    };
    fetchStops();
  }, []);

  // Find routes between start and end
  const findRoutes = useCallback(async () => {
    if (!startStop?.atco_code || !endStop?.atco_code) {
      setRouteError('Please select both a start and end location');
      return;
    }
    if (startStop.atco_code === endStop.atco_code) {
      setRouteError('Start and end locations must be different');
      return;
    }

    setRouteLoading(true);
    setRouteError(null);
    setRoutes(null);
    setSelectedRoute(null);

    try {
      const now = new Date();
      const time = departureTime || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const day = (now.getDay() + 6) % 7; // Convert to 0=Mon

      const res = await fetch(
        `${API_URL}/api/plan?start=${startStop.atco_code}&end=${endStop.atco_code}&time=${time}&day=${day}&sort=${sortBy}`
      );
      const data = await res.json();

      if (data.error) {
        setRouteError(data.error);
      } else {
        setRoutes(data);
        if (data.routes?.length > 0) {
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
        <SearchBar
          placeholder="Where are you traveling from?"
          type="start"
          value={startStop}
          onChange={setStartStop}
          stops={allStops}
        />
        <SearchBar
          placeholder="Where are you going?"
          type="end"
          value={endStop}
          onChange={setEndStop}
          stops={allStops}
        />
        <div className="search-controls">
          <input
            type="time"
            className="time-input"
            value={departureTime}
            onChange={(e) => setDepartureTime(e.target.value ? e.target.value + ':00' : '')}
            aria-label="Departure time"
          />
          <button
            className="route-btn"
            onClick={findRoutes}
            disabled={routeLoading || !startStop?.atco_code || !endStop?.atco_code}
          >
            {routeLoading ? 'Finding routes...' : 'Find Routes'}
          </button>
        </div>
        {routeError && <div className="route-error">{routeError}</div>}
      </div>

      <MapView
        userLocation={userLocation}
        startLocation={startStop}
        endLocation={endStop}
        routes={routes}
        selectedRoute={selectedRoute}
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
