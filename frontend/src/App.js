import React, { useState, useEffect } from 'react';
import './App.css';
import MapView from './components/MapView';
import BottomControls from './components/BottomControls';
import SearchBar from './components/SearchBar';
import RouteResults from './components/RouteResults';
import SignIn from './components/SignIn';
import SignUp from './components/SignUp';
import Profile from './components/Profile';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import EmailVerification from './components/EmailVerification';
import FilterPage from './components/FilterPage';
import WeatherSidebar from './components/WeatherSidebar';
import { useAuth } from './context/AuthContext';

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
    sortBy, departureTime, setDepartureTime, arrivalTime, setArrivalTime,
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

  // ── Filter page UI state (front-end only) ──────────────────
  const [showFilterPage, setShowFilterPage] = useState(false);
  const [activeFilters, setActiveFilters] = useState(null);

  const handleFilterClick = () => setShowFilterPage(true);
  const handleFilterBack = () => setShowFilterPage(false);

  const handleFilterSubmit = (filters) => {
    // Store the selected filters – will be sent to backend later.
    setActiveFilters(filters);
    setShowFilterPage(false);
    console.log('Filters applied:', filters);
  };

  // ── Auth UI state (front-end only) ────────────────────────
  const [authView, setAuthView] = useState(null);
  const [resetToken, setResetToken] = useState(null);
  const [verifyToken, setVerifyToken] = useState(null);
  const { isLoggedIn, loading: authLoading } = useAuth();

  // Check URL for verification or reset tokens on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verify = params.get('verify');
    const reset = params.get('reset');

    if (verify) {
      setVerifyToken(verify);
      setAuthView('verify-email');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (reset) {
      setResetToken(reset);
      setAuthView('reset-password');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleAccountClick = () => setAuthView(isLoggedIn ? 'profile' : 'signin');
  const handleSignIn = () => setAuthView('profile');
  const handleCreateAccount = () => setAuthView('profile');
  const handleAuthClose = () => setAuthView(null);
  const handleSwitchToSignUp = () => setAuthView('signup');
  const handleSwitchToSignIn = () => setAuthView('signin');
  const handleForgotPassword = () => setAuthView('forgot-password');
  const handleProfileBack = () => setAuthView(null);
  const handleLogout = () => setAuthView(null);

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
          <div className="time-inputs-column">
            <div className="time-field">
              <label className="time-label" htmlFor="departure-time">Depart at</label>
              <div className="time-wrapper">
                <input
                  id="departure-time"
                  type="time"
                  className="time-input"
                  value={departureTime ? departureTime.substring(0, 5) : ''}
                  onChange={(e) => {
                    setDepartureTime(e.target.value ? e.target.value + ':00' : '');
                    if (e.target.value) setArrivalTime('');
                  }}
                  aria-label="Departure time"
                />
              </div>
            </div>
            <div className="time-field">
              <label className="time-label" htmlFor="arrival-time">Arrive by</label>
              <div className="time-wrapper">
                <input
                  id="arrival-time"
                  type="time"
                  className="time-input"
                  value={arrivalTime ? arrivalTime.substring(0, 5) : ''}
                  onChange={(e) => {
                    setArrivalTime(e.target.value ? e.target.value + ':00' : '');
                    if (e.target.value) setDepartureTime('');
                  }}
                  aria-label="Arrival time"
                />
                {!arrivalTime && <span className="time-hint">Any</span>}
              </div>
            </div>
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

      <BottomControls onFilterClick={handleFilterClick} onAccountClick={handleAccountClick} />

      {/* ----- Filter page (front-end only) ----- */}
      {showFilterPage && (
        <FilterPage
          initialFilters={activeFilters}
          onBack={handleFilterBack}
          onSubmit={handleFilterSubmit}
        />
      )}

      <WeatherSidebar
        isOpen={weatherSidebarOpen}
        onClose={() => setWeatherSidebarOpen(false)}
        currentWeather={currentWeather}
        destWeather={destWeather}
        loadingCurrent={weatherLoading}
        loadingDest={destWeatherLoading}
        hasDestination={!!endStop?.lat}
      />

      {/* ----- Auth overlays ----- */}
      {authView === 'signin' && (
        <SignIn
          onClose={handleAuthClose}
          onSignIn={handleSignIn}
          onSwitchToSignUp={handleSwitchToSignUp}
          onForgotPassword={handleForgotPassword}
        />
      )}
      {authView === 'signup' && (
        <SignUp onClose={handleAuthClose} onCreateAccount={handleCreateAccount} onSwitchToSignIn={handleSwitchToSignIn} />
      )}
      {authView === 'profile' && (
        <Profile onBack={handleProfileBack} onLogout={handleLogout} />
      )}
      {authView === 'forgot-password' && (
        <ForgotPassword
          onClose={handleAuthClose}
          onSwitchToSignIn={handleSwitchToSignIn}
        />
      )}
      {authView === 'reset-password' && resetToken && (
        <ResetPassword
          token={resetToken}
          onClose={handleAuthClose}
          onSwitchToSignIn={handleSwitchToSignIn}
        />
      )}
      {authView === 'verify-email' && verifyToken && (
        <EmailVerification
          token={verifyToken}
          onClose={handleAuthClose}
        />
      )}
    </div>
  );
}

export default App;
