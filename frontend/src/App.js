import React, { useEffect, useState, useCallback } from 'react';
import './App.css';
import MapView from './components/MapView';
import BottomControls from './components/BottomControls';
import SearchBar from './components/SearchBar';
import RouteResults from './components/RouteResults';
import SignIn from './components/SignIn';
import SignUp from './components/SignUp';
import Profile from './components/Profile';
import WeatherSidebar from './components/WeatherSidebar';

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

  // ---------- Weather state ----------
  const [currentWeather, setCurrentWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [destWeather, setDestWeather] = useState(null);
  const [destWeatherLoading, setDestWeatherLoading] = useState(false);
  const [weatherSidebarOpen, setWeatherSidebarOpen] = useState(false);

  // ---------- Authentication / profile UI state (front-end only) ----------
  // authView: null (map visible), 'signin', 'signup', 'profile'
  const [authView, setAuthView] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Handlers for the auth flow
  const handleAccountClick = () => {
    setAuthView(isLoggedIn ? 'profile' : 'signin');
  };

  const handleSignIn = (/* { email, password } */) => {
    // Placeholder – will validate against backend later.
    // For now, treat every submission as a successful sign-in.
    setIsLoggedIn(true);
    setAuthView('profile');
  };

  const handleCreateAccount = (/* { firstName, lastName, email, password, retypePassword } */) => {
    // Placeholder – will send data to backend later.
    // For now, treat every submission as a successful sign-up & auto-login.
    setIsLoggedIn(true);
    setAuthView('profile');
  };

  const handleAuthClose = () => setAuthView(null);
  const handleSwitchToSignUp = () => setAuthView('signup');
  const handleSwitchToSignIn = () => setAuthView('signin');
  const handleProfileBack = () => setAuthView(null);

  // Continuously track user's live GPS location
  // Falls back through: high-accuracy GPS → low-accuracy → IP geolocation
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

    // Last resort: IP-based geolocation (works without HTTPS / secure context)
    const ipFallback = async () => {
      try {
        // Try multiple free IP geolocation services
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
      // No browser geolocation at all — go straight to IP
      ipFallback();
      return;
    }

    // Check if we're in a secure context (HTTPS or localhost)
    const isSecure = window.isSecureContext;

    if (!isSecure) {
      // Geolocation API is blocked on non-secure origins (HTTP + non-localhost)
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
          // All browser geolocation failed — try IP
          ipFallback();
        },
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 }
      );
    };

    // Start with high accuracy (GPS)
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

  // Fetch weather for current location whenever userLocation changes
  useEffect(() => {
    if (!userLocation) return;
    let cancelled = false;
    const fetchWeather = async () => {
      setWeatherLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/weather?lat=${userLocation.lat}&lon=${userLocation.lon}`);
        if (res.ok && !cancelled) {
          setCurrentWeather(await res.json());
        }
      } catch (e) {
        console.warn('Failed to fetch current weather:', e.message);
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    };
    fetchWeather();
    // Refresh weather every 10 minutes
    const interval = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [userLocation?.lat, userLocation?.lon]);

  // Fetch weather for destination whenever endStop changes
  useEffect(() => {
    if (!endStop?.lat || !endStop?.lon) { setDestWeather(null); return; }
    let cancelled = false;
    const fetchDestWeather = async () => {
      setDestWeatherLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/weather?lat=${endStop.lat}&lon=${endStop.lon}`);
        if (res.ok && !cancelled) {
          setDestWeather(await res.json());
        }
      } catch (e) {
        console.warn('Failed to fetch destination weather:', e.message);
      } finally {
        if (!cancelled) setDestWeatherLoading(false);
      }
    };
    fetchDestWeather();
    return () => { cancelled = true; };
  }, [endStop?.lat, endStop?.lon]);

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

  // Handle pin drop from BottomControls -> MapView drag/drop
  const handlePinDrop = async (latlng) => {
    if (!latlng) return;
    try {
      const res = await fetch(`${API_URL}/api/reverse?lat=${encodeURIComponent(latlng.lat)}&lon=${encodeURIComponent(latlng.lng)}`);
      const data = await res.json();
      const name = (data && data.name) ? data.name : 'Pinned location';
      const place = {
        type: 'place',
        name,
        common_name: name,
        lat: latlng.lat,
        lon: latlng.lng,
        fullName: data && data.display_name ? data.display_name : undefined
      };
      setEndStop(place);
      setRoutes(null);
      setSelectedRoute(null);
    } catch (err) {
      console.error('Reverse geocode failed:', err);
      const place = {
        type: 'place',
        name: 'Pinned location',
        common_name: 'Pinned location',
        lat: latlng.lat,
        lon: latlng.lng
      };
      setEndStop(place);
      setRoutes(null);
      setSelectedRoute(null);
    }
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
        onPinDrop={handlePinDrop}
        onLocateMe={useMyLocation}
        currentWeather={currentWeather}
        weatherLoading={weatherLoading}
        onWeatherClick={() => setWeatherSidebarOpen(true)}
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

      <BottomControls onAccountClick={handleAccountClick} />

      {/* ----- Weather sidebar ----- */}
      <WeatherSidebar
        isOpen={weatherSidebarOpen}
        onClose={() => setWeatherSidebarOpen(false)}
        currentWeather={currentWeather}
        destWeather={destWeather}
        loadingCurrent={weatherLoading}
        loadingDest={destWeatherLoading}
        hasDestination={!!endStop?.lat}
      />

      {/* ----- Auth overlays (front-end only) ----- */}
      {authView === 'signin' && (
        <SignIn
          onClose={handleAuthClose}
          onSignIn={handleSignIn}
          onSwitchToSignUp={handleSwitchToSignUp}
        />
      )}
      {authView === 'signup' && (
        <SignUp
          onClose={handleAuthClose}
          onCreateAccount={handleCreateAccount}
          onSwitchToSignIn={handleSwitchToSignIn}
        />
      )}
      {authView === 'profile' && (
        <Profile onBack={handleProfileBack} />
      )}
    </div>
  );
}

export default App;
