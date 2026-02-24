import React from 'react';
import './RouteResults.css';

// Mode icons
const modeIcons = {
  walk: '🚶',
  bus: '🚌',
  train: '🚂',
  transfer: '⏳'
};

function formatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5); // "HH:MM:SS" → "HH:MM"
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function LegDetail({ leg }) {
  switch (leg.type) {
    case 'walk':
      return (
        <div className="leg walk-leg">
          <div className="leg-icon">{modeIcons.walk}</div>
          <div className="leg-info">
            <div className="leg-title">Walk</div>
            <div className="leg-detail">
              {leg.fromName} → {leg.toName}
            </div>
            <div className="leg-meta">
              {leg.duration} min · {leg.distance_km} km
            </div>
          </div>
        </div>
      );

    case 'bus':
      return (
        <div className="leg bus-leg">
          <div className="leg-icon">{modeIcons.bus}</div>
          <div className="leg-info">
            <div className="leg-title">
              <span className="route-badge bus-badge">{leg.routeNumber}</span>
              {leg.operatorName || leg.operator}
            </div>
            <div className="leg-detail">
              <span className="time">{formatTime(leg.boardTime)}</span> {leg.boardName}
              <span className="arrow"> → </span>
              <span className="time">{formatTime(leg.alightTime)}</span> {leg.alightName}
            </div>
            {leg.numStops && (
              <div className="leg-meta">{leg.numStops} stops</div>
            )}
          </div>
        </div>
      );

    case 'train':
      return (
        <div className="leg train-leg">
          <div className="leg-icon">{modeIcons.train}</div>
          <div className="leg-info">
            <div className="leg-title">
              <span className="route-badge train-badge">
                {leg.operator || 'Train'}
              </span>
              {leg.operatorName}
            </div>
            <div className="leg-detail">
              <span className="time">{formatTime(leg.boardTime)}</span> {leg.boardName}
              <span className="arrow"> → </span>
              <span className="time">{formatTime(leg.alightTime)}</span> {leg.alightName}
            </div>
            {leg.numStops && (
              <div className="leg-meta">{leg.numStops} stops</div>
            )}
          </div>
        </div>
      );

    case 'transfer':
      return (
        <div className="leg transfer-leg">
          <div className="leg-icon">{modeIcons.transfer}</div>
          <div className="leg-info">
            <div className="leg-title">Transfer</div>
            <div className="leg-detail">
              {leg.station || leg.stop} · {leg.waitMinutes} min wait
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

function RouteCard({ route, index, isSelected, onSelect }) {
  const modeStr = [...new Set(route.modes.filter(m => m !== 'transfer'))];

  return (
    <div
      className={`route-card ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(index)}
      role="button"
      tabIndex={0}
      aria-label={`Route ${index + 1}: ${route.summary}`}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(index)}
    >
      <div className="route-header">
        <div className="route-modes">
          {modeStr.map(m => (
            <span key={m} className={`mode-tag ${m}-tag`}>
              {modeIcons[m]} {m}
            </span>
          ))}
        </div>
        <div className="route-duration">{formatDuration(route.durationMinutes)}</div>
      </div>
      <div className="route-times">
        <span className="departure">{formatTime(route.departureTime)}</span>
        <span className="route-arrow">→</span>
        <span className="arrival">{formatTime(route.arrivalTime)}</span>
      </div>
      <div className="route-summary">{route.summary}</div>

      {isSelected && (
        <div className="route-legs">
          {route.legs.map((leg, i) => (
            <LegDetail key={i} leg={leg} />
          ))}
        </div>
      )}
    </div>
  );
}

function RouteResults({ routes, selectedRoute, onSelectRoute, sortBy, onSortChange }) {
  if (!routes) return null;

  return (
    <div className="route-results" role="region" aria-label="Route results">
      <div className="results-header">
        <h2 className="results-title">
          {routes.totalRoutes} route{routes.totalRoutes !== 1 ? 's' : ''} found
        </h2>
        <div className="results-meta">
          {routes.start.name} → {routes.end.name}
          <span className="distance"> · {routes.directDistance_km} km</span>
        </div>
        <div className="sort-controls" role="group" aria-label="Sort options">
          <label htmlFor="sort-select" className="sort-label">Sort by:</label>
          <select
            id="sort-select"
            className="sort-select"
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value)}
          >
            <option value="departure">Departure time</option>
            <option value="arrival">Arrival time</option>
            <option value="duration">Duration</option>
          </select>
        </div>
      </div>

      {routes.totalRoutes === 0 ? (
        <div className="no-routes">
          <p>No routes found between these locations at this time.</p>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default RouteResults;
