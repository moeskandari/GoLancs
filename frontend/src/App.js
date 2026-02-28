import React, { useState } from 'react';
import './App.css';
import MapView from './components/MapView';
import BottomControls from './components/BottomControls';
import SearchBar from './components/SearchBar';
import RouteResults from './components/RouteResults';
import SignIn from './components/SignIn';
import SignUp from './components/SignUp';
import Profile from './components/Profile';
import WeatherSidebar from './components/WeatherSidebar';

// Custom hooks
import useGeolocation from './hooks/useGeolocation';
import useWeather from './hooks/useWeather';
import useLiveTracking from './hooks/useLiveTracking';
import useRoutePlanner from './hooks/useRoutePlanner';

function App() {
  // ── Geolocation ───────────────────────────────────────────
  const { userLocation } = useGeolocation();

  // ── Route planner ─────────────────────────────────────────
  const {
    startStop, setStartStop, endStop, setEndStop,
    routes, routeLoading, routeError,
    selectedRoute, setSelectedRoute,
    sortBy, departureTime, setDepartureTime,
    findRoutes, swapStops, useMyLocation, handlePinDrop, handleSortChange,
  } = useRoutePlanner(userLocation);

  // ── Weather ───────────────────────────────────────────────
  const {
    currentWeather, weatherLoading,
    destWeather, destWeatherLoading,
    weatherSidebarOpen, setWeatherSidebarOpen,
  } = useWeather(userLocation, endStop);

  // ── Live tracking ─────────────────────────────────────────
  const {
    liveVehicles, trackedLeg, liveTrackingActive,
    railDepartures, trackedTrainService,
    startTracking, stopTracking,
  } = useLiveTracking(routes, selectedRoute);

  // ── Auth UI state (front-end only) ────────────────────────
  const [authView, setAuthView] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const handleAccountClick = () => setAuthView(isLoggedIn ? 'profile' : 'signin');
  const handleSignIn = () => { setIsLoggedIn(true); setAuthView('profile'); };
  const handleCreateAccount = () => { setIsLoggedIn(true); setAuthView('profile'); };
  const handleAuthClose = () => setAuthView(null);
  const handleSwitchToSignUp = () => setAuthView('signup');
  const handleSwitchToSignIn = () => setAuthView('signin');
  const handleProfileBack = () => setAuthView(null);

  // ── Render ────────────────────────────────────────────────
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
        liveVehicles={liveVehicles}
        liveTrackingActive={liveTrackingActive}
        trackedLeg={trackedLeg}
        trackedTrainService={trackedTrainService}
      />

      {routes && (
        <RouteResults
          routes={routes}
          selectedRoute={selectedRoute}
          onSelectRoute={setSelectedRoute}
          sortBy={sortBy}
          onSortChange={handleSortChange}
          onTrackLeg={startTracking}
          onStopTracking={stopTracking}
          liveTrackingActive={liveTrackingActive}
          trackedLeg={trackedLeg}
          liveVehicles={liveVehicles}
          railDepartures={railDepartures}
          trackedTrainService={trackedTrainService}
        />
      )}

      <BottomControls onAccountClick={handleAccountClick} />

      <WeatherSidebar
        isOpen={weatherSidebarOpen}
        onClose={() => setWeatherSidebarOpen(false)}
        currentWeather={currentWeather}
        destWeather={destWeather}
        loadingCurrent={weatherLoading}
        loadingDest={destWeatherLoading}
        hasDestination={!!endStop?.lat}
      />

      {authView === 'signin' && (
        <SignIn onClose={handleAuthClose} onSignIn={handleSignIn} onSwitchToSignUp={handleSwitchToSignUp} />
      )}
      {authView === 'signup' && (
        <SignUp onClose={handleAuthClose} onCreateAccount={handleCreateAccount} onSwitchToSignIn={handleSwitchToSignIn} />
      )}
      {authView === 'profile' && (
        <Profile onBack={handleProfileBack} />
      )}
    </div>
  );
}

export default App;
