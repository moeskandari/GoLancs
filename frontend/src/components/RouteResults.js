import React from 'react';
import './RouteResults.css';

// Mode icons and labels
const modeConfig = {
  walk: { icon: '🚶', label: 'Walk', colorClass: 'walk' },
  bus: { icon: '🚌', label: 'Bus', colorClass: 'bus' },
  train: { icon: '🚂', label: 'Train', colorClass: 'train' },
  transfer: { icon: '🔄', label: 'Change', colorClass: 'transfer' }
};

function formatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5);
}

function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return '';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function calcLegDuration(leg) {
  if (leg.duration) return leg.duration;
  if (leg.boardTime && leg.alightTime) {
    const bParts = leg.boardTime.split(':');
    const aParts = leg.alightTime.split(':');
    const bMin = parseInt(bParts[0]) * 60 + parseInt(bParts[1]);
    const aMin = parseInt(aParts[0]) * 60 + parseInt(aParts[1]);
    return aMin >= bMin ? aMin - bMin : aMin + 1440 - bMin;
  }
  if (leg.waitMinutes) return leg.waitMinutes;
  return null;
}

/**
 * Find a matching live vehicle for a bus leg.
 * Matches by line name/number and direction if available.
 */
function findMatchingVehicle(leg, liveVehicles) {
  if (!liveVehicles || !liveVehicles.length || !leg.routeNumber) return null;
  const matches = liveVehicles.filter(v =>
    v.lineName === leg.routeNumber || v.lineRef === leg.routeNumber
  );
  if (matches.length === 0) return null;
  // If we have direction info, try to match
  if (leg.direction && matches.length > 1) {
    const dirMatch = matches.find(v =>
      v.directionRef?.toLowerCase() === leg.direction?.toLowerCase()
    );
    if (dirMatch) return dirMatch;
  }
  // Return the most recently recorded vehicle
  return matches.sort((a, b) =>
    new Date(b.recordedAt || 0) - new Date(a.recordedAt || 0)
  )[0];
}

/**
 * Find matching rail departure info for a train leg.
 */
function findMatchingDeparture(leg, railDepartures) {
  if (!railDepartures?.services || !leg.boardTime) return null;
  const boardTimeShort = formatTime(leg.boardTime);
  return railDepartures.services.find(s =>
    s.scheduledDeparture === boardTimeShort
  );
}

/**
 * Live status badge for a bus vehicle
 */
function LiveBusBadge({ vehicle }) {
  if (!vehicle) return null;
  const updatedAt = vehicle.recordedAt
    ? new Date(vehicle.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <div className="live-status-badge">
      <span className="live-dot-green"></span>
      <span className="live-status-text">
        Live tracked
        {updatedAt && <span className="live-updated"> · {updatedAt}</span>}
      </span>
    </div>
  );
}

/**
 * Live departure info for a rail service
 */
function RailLiveBadge({ departure }) {
  if (!departure) return null;
  const isDelayed = departure.estimatedDeparture &&
    departure.estimatedDeparture !== 'On time' &&
    departure.estimatedDeparture !== departure.scheduledDeparture;
  const isCancelled = departure.cancelReason;

  return (
    <div className={`rail-live-badge ${isCancelled ? 'cancelled' : isDelayed ? 'delayed' : 'on-time'}`}>
      {isCancelled ? (
        <>
          <span className="live-dot-red"></span>
          <span className="rail-live-text">Cancelled: {departure.cancelReason}</span>
        </>
      ) : isDelayed ? (
        <>
          <span className="live-dot-amber"></span>
          <span className="rail-live-text">
            Expected {departure.estimatedDeparture}
            {departure.delayReason && <span className="delay-reason"> — {departure.delayReason}</span>}
          </span>
        </>
      ) : (
        <>
          <span className="live-dot-green"></span>
          <span className="rail-live-text">On time</span>
          {departure.platform && <span className="platform-badge">Plat {departure.platform}</span>}
        </>
      )}
    </div>
  );
}

// Individual leg detail component with full info
function LegDetail({ leg, legIndex, totalLegs, onTrackBus, onStopTracking, liveTrackingActive, trackedRoute, liveVehicles, railDepartures }) {
  const config = modeConfig[leg.type] || modeConfig.walk;
  const duration = calcLegDuration(leg);

  // Find live data for this leg
  const matchingVehicle = leg.type === 'bus' ? findMatchingVehicle(leg, liveVehicles) : null;
  const matchingDeparture = leg.type === 'train' ? findMatchingDeparture(leg, railDepartures) : null;
  const isTracking = liveTrackingActive && trackedRoute === leg.routeNumber;

  return (
    <div className={`leg-detail-card ${leg.type}-card`}>
      {/* Timeline connector */}
      <div className="timeline-connector">
        <div className={`timeline-dot ${leg.type}-dot`}>{config.icon}</div>
        {legIndex < totalLegs - 1 && <div className={`timeline-line ${leg.type}-line`} />}
      </div>

      <div className="leg-content">
        {/* Walk leg */}
        {leg.type === 'walk' && (
          <>
            <div className="leg-header">
              <span className="leg-mode-label walk-label">Walk</span>
              {duration && <span className="leg-duration">{formatDuration(duration)}</span>}
            </div>
            <div className="leg-stops">
              <div className="leg-stop-row">
                <span className="stop-name">{leg.fromName}</span>
              </div>
              <div className="leg-arrow">↓</div>
              <div className="leg-stop-row">
                <span className="stop-name">{leg.toName}</span>
              </div>
            </div>
            {leg.distance_km && (
              <div className="leg-extra">📏 {leg.distance_km} km · ~{Math.round(leg.distance_km / 0.08)} min at walking pace</div>
            )}
          </>
        )}

        {/* Bus leg */}
        {leg.type === 'bus' && (
          <>
            <div className="leg-header">
              <span className="route-badge bus-badge">{leg.routeNumber}</span>
              <span className="leg-operator">{leg.operatorName || leg.operator}</span>
              {duration && <span className="leg-duration">{formatDuration(duration)}</span>}
            </div>
            {/* Live tracking status or Track button */}
            {isTracking ? (
              <>
                <LiveBusBadge vehicle={matchingVehicle} />
                <button
                  className="track-btn tracking"
                  onClick={(e) => { e.stopPropagation(); onStopTracking?.(); }}
                  aria-label="Stop tracking bus"
                >
                  <span className="live-dot-green"></span> Tracking · Stop
                </button>
              </>
            ) : (
              <button
                className="track-btn"
                onClick={(e) => { e.stopPropagation(); onTrackBus?.(leg.routeNumber); }}
                aria-label={`Track bus ${leg.routeNumber} live`}
              >
                📡 Track Live
              </button>
            )}
            <div className="leg-stops">
              <div className="leg-stop-row">
                <span className="stop-time">{formatTime(leg.boardTime)}</span>
                <span className="stop-name">{leg.boardName}</span>
              </div>
              <div className="leg-arrow">↓ {leg.numStops ? `${leg.numStops} stops` : ''}</div>
              <div className="leg-stop-row">
                <span className="stop-time">{formatTime(leg.alightTime)}</span>
                <span className="stop-name">{leg.alightName}</span>
              </div>
            </div>
            <div className="leg-extra">
              {leg.direction && <span>Direction: {leg.direction}</span>}
            </div>
          </>
        )}

        {/* Train leg */}
        {leg.type === 'train' && (
          <>
            <div className="leg-header">
              <span className="route-badge train-badge">{leg.operator || '🚂'}</span>
              <span className="leg-operator">{leg.operatorName}</span>
              {duration && <span className="leg-duration">{formatDuration(duration)}</span>}
            </div>
            {/* Live rail departure info */}
            <RailLiveBadge departure={matchingDeparture} />
            <div className="leg-stops">
              <div className="leg-stop-row">
                <span className="stop-time">{formatTime(leg.boardTime)}</span>
                <span className="stop-name">{leg.boardName}</span>
                {leg.startCrs && <span className="crs-code">({leg.startCrs})</span>}
              </div>
              <div className="leg-arrow">↓ {leg.numStops ? `${leg.numStops} stops` : ''}</div>
              <div className="leg-stop-row">
                <span className="stop-time">{formatTime(leg.alightTime)}</span>
                <span className="stop-name">{leg.alightName}</span>
                {leg.endCrs && <span className="crs-code">({leg.endCrs})</span>}
              </div>
            </div>
            {leg.trainUid && (
              <div className="leg-extra">Train ID: {leg.trainUid}</div>
            )}
          </>
        )}

        {/* Transfer/changeover leg */}
        {leg.type === 'transfer' && (
          <>
            <div className="leg-header">
              <span className="leg-mode-label transfer-label">🔄 Changeover</span>
              <span className="leg-duration">{leg.waitMinutes} min wait</span>
            </div>
            <div className="leg-changeover-info">
              <div className="changeover-station">
                📍 {leg.station || leg.stop}
                {leg.crs && <span className="crs-code"> ({leg.crs})</span>}
              </div>
              <div className="changeover-tip">
                {leg.waitMinutes <= 5 ? '⚡ Tight connection - be ready!' :
                 leg.waitMinutes <= 15 ? '✅ Comfortable connection time' :
                 '☕ Plenty of time to change'}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Modes summary bar showing the journey stages
function ModesSummary({ legs }) {
  const stages = legs.filter(l => l.type !== 'transfer');
  return (
    <div className="modes-summary">
      {stages.map((leg, i) => {
        const config = modeConfig[leg.type] || modeConfig.walk;
        const duration = calcLegDuration(leg);
        return (
          <React.Fragment key={i}>
            {i > 0 && <span className="mode-separator">›</span>}
            <span className={`mode-chip ${leg.type}-chip`}>
              {config.icon}
              {leg.type === 'bus' && leg.routeNumber ? ` ${leg.routeNumber}` : ''}
              {leg.type === 'train' && leg.operator ? ` ${leg.operator}` : ''}
              {duration ? ` ${formatDuration(duration)}` : ''}
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function RouteCard({ route, index, isSelected, onSelect, onTrackBus, onStopTracking, liveTrackingActive, trackedRoute, liveVehicles, railDepartures }) {
  return (
    <div
      className={`route-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(index)}
      role="button"
      tabIndex={0}
      aria-label={`Route option ${index + 1}: ${route.summary}, ${formatDuration(route.durationMinutes)}`}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(index)}
    >
      {/* Compact header */}
      <div className="route-header">
        <div className="route-times">
          <span className="departure">{formatTime(route.departureTime)}</span>
          <span className="route-arrow">→</span>
          <span className="arrival">{formatTime(route.arrivalTime)}</span>
        </div>
        <div className="route-duration">{formatDuration(route.durationMinutes)}</div>
      </div>

      {/* Modes summary bar */}
      <ModesSummary legs={route.legs} />

      {/* Expanded details when selected */}
      {isSelected && (
        <div className="route-expanded">
          <div className="journey-timeline">
            {route.legs.map((leg, i) => (
              <LegDetail
                key={i}
                leg={leg}
                legIndex={i}
                totalLegs={route.legs.length}
                onTrackBus={onTrackBus}
                onStopTracking={onStopTracking}
                liveTrackingActive={liveTrackingActive}
                trackedRoute={trackedRoute}
                liveVehicles={liveVehicles}
                railDepartures={railDepartures}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RouteResults({ routes, selectedRoute, onSelectRoute, sortBy, onSortChange, onTrackBus, onStopTracking, liveTrackingActive, trackedRoute, liveVehicles, railDepartures }) {
  if (!routes) return null;

  return (
    <div className="route-results" role="region" aria-label="Route results">
      <div className="results-header">
        <div className="results-title-row">
          <h2 className="results-title">
            {routes.totalRoutes} route{routes.totalRoutes !== 1 ? 's' : ''} found
          </h2>
          <div className="sort-controls">
            <select
              className="sort-select"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              aria-label="Sort routes by"
            >
              <option value="duration">⏱ Fastest</option>
              <option value="departure">🕐 Earliest</option>
              <option value="arrival">🏁 Arrives first</option>
            </select>
          </div>
        </div>
        <div className="results-meta">
          {routes.start.name} → {routes.end.name}
          <span className="distance"> · {routes.directDistance_km} km</span>
          {routes.usingTime && <span className="using-time"> · Departing: {routes.usingTime}</span>}
        </div>
      </div>

      {routes.totalRoutes === 0 ? (
        <div className="no-routes">
          <div className="no-routes-icon">🔍</div>
          <p><strong>No routes found</strong></p>
          <p>Try adjusting the departure time or selecting different stops.</p>
        </div>
      ) : (
        <div className="route-list">
          {routes.routes.map((route, i) => (
            <RouteCard
              key={route.id}
              route={route}
              index={i}
              isSelected={selectedRoute === i}
              onSelect={onSelectRoute}
              onTrackBus={onTrackBus}
              onStopTracking={onStopTracking}
              liveTrackingActive={liveTrackingActive}
              trackedRoute={trackedRoute}
              liveVehicles={liveVehicles}
              railDepartures={railDepartures}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default RouteResults;
