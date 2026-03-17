import { useState, useEffect, useCallback } from 'react';
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
import WeatherIcon from './components/WeatherIcon';
import Terms from './components/Terms';

// Custom hooks
import useGeolocation from './hooks/useGeolocation';
import useWeather from './hooks/useWeather';
import useLiveTracking from './hooks/useLiveTracking';
import useRoutePlanner from './hooks/useRoutePlanner';

const DEFAULT_FILTERS = {
  onMap: {
    showBusStops: false,
    showTrainStations: false,
    showTrafficConditions: false,
  },
  direction: {
    includeWalking: false,
    includeBusses: false,
    includeTrains: false,
  },
};

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
  const [activeFilters, setActiveFilters] = useState(DEFAULT_FILTERS);

  // Derived display routes based on activeFilters
  let displayRoutes = routes;
  let filterFallbackMessage = null;
  if (routes && activeFilters && activeFilters.direction) {
    const dir = activeFilters.direction;
    const hasAnyOnly = !!(dir.includeBuses || dir.includeTrains || dir.includeWalking);
    if (hasAnyOnly) {
      const allowed = new Set();
      if (dir.includeBuses) allowed.add('bus');
      if (dir.includeTrains) allowed.add('train');
      if (dir.includeWalking) allowed.add('walk');

      const filtered = routes.routes.filter((route) => {
        const legTypes = new Set(route.legs.map(l => l.type).filter(t => t !== 'transfer'));
        // If user selected only walking (alone), require route to be walk-only
        if (allowed.size === 1 && allowed.has('walk')) {
          return legTypes.size === 1 && legTypes.has('walk');
        }
        // Otherwise ensure every transport-type leg is allowed (walking allowed when selected)
        for (const t of legTypes) {
          if (!allowed.has(t)) return false;
        }
        return true;
      });

      if (filtered.length > 0) {
        displayRoutes = { ...routes, routes: filtered, totalRoutes: filtered.length };
      } else {
        // No exact matches — show alternatives but inform the user
        filterFallbackMessage = 'No routes matched your "Only include" filters — showing alternatives.';
        displayRoutes = routes;
      }
    }
  }

  const handleFilterClick = () => setShowFilterPage(true);
  const handleFilterBack = () => setShowFilterPage(false);

  const handleFilterSubmit = (filters) => {
    // Store the selected filters – will be sent to backend later.
    setActiveFilters(filters);
    setShowFilterPage(false);
    console.log('Filters applied:', filters);
  };

  // Filter-driven map toggles
  const showBusStops = !!activeFilters?.onMap?.showBusStops;
  const showTrainStations = !!activeFilters?.onMap?.showTrainStations;
  const showTrafficConditions = !!activeFilters?.onMap?.showTrafficConditions;

  // ── Auth UI state (front-end only) ────────────────────────
  const [authView, setAuthView] = useState(null);
  const [resetToken, setResetToken] = useState(null);
  const [verifyToken, setVerifyToken] = useState(null);
  const [prevAuthView, setPrevAuthView] = useState(null);
  const { isLoggedIn } = useAuth();

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

  // ── Search collapse on mobile (so map stays interactive) ──
  const [searchCollapsed, setSearchCollapsed] = useState(false);

  // ── Pin-drop mode (tap on map to place a pin — for touch devices) ──
  const [pinMode, setPinMode] = useState(false);

  const handlePinToggle = () => setPinMode(prev => !prev);

  // When pin is dropped (via drag or tap), exit pin mode
  const handlePinDropAndReset = (latlng) => {
    handlePinDrop(latlng);
    setPinMode(false);
  };

  const isMobile = useCallback(() => window.innerWidth <= 768, []);

  // Auto-collapse the search form when routes appear on mobile
  useEffect(() => {
    if (routes && isMobile()) {
      setSearchCollapsed(true);
    }
    if (!routes) {
      setSearchCollapsed(false);
    }
  }, [routes, isMobile]);

  const handleAccountClick = () => setAuthView(isLoggedIn ? 'profile' : 'signin');
  const handleSignIn = () => setAuthView('profile');
  const handleCreateAccount = () => setAuthView('profile');
  const handleAuthClose = () => setAuthView(null);
  const handleShowTerms = () => { setPrevAuthView(authView); setAuthView('terms'); };
  const handleSwitchToSignUp = () => setAuthView('signup');
  const handleSwitchToSignIn = () => setAuthView('signin');
  const handleForgotPassword = () => setAuthView('forgot-password');
  const handleProfileBack = () => setAuthView(null);
  const handleLogout = () => setAuthView(null);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="App">
      {/* ── Search form: collapsible on mobile when routes shown ── */}
      {searchCollapsed ? (
        <div className="search-container search-collapsed">
          <div className="collapsed-summary">
            <span className="collapsed-route-text">
              {startStop?.name || 'Start'} → {endStop?.name || 'Destination'}
            </span>
            <button
              className="expand-search-btn"
              onClick={() => setSearchCollapsed(false)}
              aria-label="Expand search form"
              title="Edit search"
            >
              ✏️
            </button>
          </div>
        </div>
      ) : (
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
        {/* Collapse button on mobile when routes are showing */}
        {routes && (
          <button
            className="collapse-search-btn"
            onClick={() => setSearchCollapsed(true)}
            aria-label="Collapse search form"
          >
            ▲ Hide search
          </button>
        )}
      </div>
      )}

      <MapView
        userLocation={userLocation}
        startLocation={startStop}
        endLocation={endStop}
        selectedTime={arrivalTime || departureTime}
        selectedDay={(new Date().getDay() + 6) % 7}
        showBusStops={showBusStops}
        showTrainStations={showTrainStations}
        showTrafficConditions={showTrafficConditions}
        routes={routes}
        selectedRoute={selectedRoute}
        onPinDrop={handlePinDropAndReset}
        onLocateMe={useMyLocation}
        liveVehicles={liveVehicles}
        liveTrackingActive={liveTrackingActive}
        trackedLeg={trackedLeg}
        trackedTrainService={trackedTrainService}
        pinMode={pinMode}
      />

      {routes && (
        <>
          {filterFallbackMessage && (
            <div className="filter-fallback-msg" role="status" aria-live="polite" style={{padding: '8px', background: '#fff5cc', borderRadius: 6, margin: '8px 16px'}}>
              {filterFallbackMessage}
            </div>
          )}
          <RouteResults
          routes={displayRoutes}
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
        </>
      )}

      <BottomControls
        onFilterClick={handleFilterClick}
        onAccountClick={handleAccountClick}
        pinMode={pinMode}
        onPinToggle={handlePinToggle}
      />

      {/* ----- Filter page (front-end only) ----- */}
      {showFilterPage && (
        <FilterPage
          initialFilters={activeFilters}
          onBack={handleFilterBack}
          onSubmit={handleFilterSubmit}
        />
      )}

      <WeatherIcon
        weather={currentWeather}
        loading={weatherLoading}
        onClick={() => setWeatherSidebarOpen(true)}
      />

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
          onShowTerms={handleShowTerms}
        />
      )}
      {authView === 'signup' && (
        <SignUp
          onClose={handleAuthClose}
          onCreateAccount={handleCreateAccount}
          onSwitchToSignIn={handleSwitchToSignIn}
          onShowTerms={handleShowTerms}
        />
      )}
      {authView === 'profile' && (
        <Profile onBack={handleProfileBack} onLogout={handleLogout} onShowTerms={handleShowTerms} />
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
      {authView === 'terms' && (
        // Show Terms modal; on close return to previous auth view or null
        <Terms onClose={() => setAuthView(prevAuthView || null)} />
      )}
    </div>
  );
}

export default App;
