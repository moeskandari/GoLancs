import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, Marker, Polyline, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapView.css';
import Compass from './Compass';
import WeatherIcon from './WeatherIcon';

// Component to handle map bounds
function MapBounds() {
  const map = useMap();
  
  useEffect(() => {
    const bounds = [
      [53.7, -3.2],
      [54.1, -2.6]
    ];
    map.setMaxBounds(bounds);
    map.fitBounds(bounds);
  }, [map]);
  
  return null;
}

// Component to fit map bounds to all route points
function FitToRoute({ startLocation, endLocation, routes, selectedRoute }) {
  const map = useMap();

  useEffect(() => {
    const points = [];

    const addCoord = (coords) => {
      if (!coords) return;
      if (typeof coords === 'object' && coords.lat !== undefined) {
        points.push([coords.lat, coords.lon]);
      } else if (typeof coords === 'object' && coords.x !== undefined) {
        points.push([coords.y, coords.x]);
      }
    };

    // Add start/end
    if (startLocation?.lat && startLocation?.lon) points.push([startLocation.lat, startLocation.lon]);
    else if (startLocation?.coordinates) addCoord(startLocation.coordinates);
    if (endLocation?.lat && endLocation?.lon) points.push([endLocation.lat, endLocation.lon]);
    else if (endLocation?.coordinates) addCoord(endLocation.coordinates);

    // Add all leg coordinates from selected route
    if (routes && selectedRoute !== null && routes.routes[selectedRoute]) {
      const route = routes.routes[selectedRoute];
      for (const leg of route.legs) {
        // Include detailed geometry points for accurate bounds
        if (leg.geometry && leg.geometry.length > 0) {
          for (const pt of leg.geometry) {
            points.push([pt[0], pt[1]]);
          }
        } else {
          if (leg.fromCoords) points.push([leg.fromCoords.lat, leg.fromCoords.lon]);
          if (leg.toCoords) points.push([leg.toCoords.lat, leg.toCoords.lon]);
        }
      }
    }

    if (points.length >= 2) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds.pad(0.15), { maxZoom: 14 });
    }
  }, [startLocation, endLocation, routes, selectedRoute, map]);

  return null;
}

// Component to handle drag/drop of a pin onto the map container
function DragDropHandler({ onDrop, onDrag }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();

    const handleDragOver = (ev) => {
      ev.preventDefault();
      try {
        const latlng = map.mouseEventToLatLng(ev);
        if (onDrag) onDrag(latlng);
      } catch (err) {
        // ignore
      }
    };

    const handleDrop = (ev) => {
      ev.preventDefault();
      try {
        const hasPin = ev.dataTransfer && (ev.dataTransfer.getData('text/pin') || ev.dataTransfer.getData('text'));
        const latlng = map.mouseEventToLatLng(ev);
        if (hasPin && onDrop) onDrop(latlng);
      } catch (err) {
        // ignore
      }
    };

    const handleDragLeave = () => {
      if (onDrag) onDrag(null);
    };

    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
    container.addEventListener('dragleave', handleDragLeave);

    return () => {
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
      container.removeEventListener('dragleave', handleDragLeave);
    };
  }, [map, onDrop, onDrag]);

  return null;
}

// Color and style settings for each transport mode
const legStyles = {
  walk: { color: '#4CAF50', weight: 4, opacity: 0.8, dashArray: '8, 12' },
  bus: { color: '#FF9800', weight: 5, opacity: 0.85, dashArray: null },
  train: { color: '#1976D2', weight: 5, opacity: 0.85, dashArray: null },
  transfer: { color: '#9E9E9E', weight: 3, opacity: 0.6, dashArray: '4, 8' }
};

// Changeover marker icon
const changeoverIcon = (label) => L.divIcon({
  html: `<div style="
    background: #fff;
    border: 3px solid #FF5722;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    color: #FF5722;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  ">${label}</div>`,
  className: 'changeover-icon',
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

// Pulsing blue dot icon for user's live location (Apple Maps style)
const userDotIcon = (heading) => {
  const hasHeading = heading !== null && heading !== undefined && !isNaN(heading);
  const headingArrow = hasHeading
    ? `<div class="user-heading-arrow" style="transform: rotate(${heading}deg);"></div>`
    : '';
  return L.divIcon({
    html: `<div class="user-location-dot">${headingArrow}<div class="user-dot-core"></div><div class="user-dot-pulse"></div></div>`,
    className: 'user-location-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

// Live bus marker icon — shows route number with bearing arrow
const liveBusIcon = (lineName, bearing) => {
  const rotation = bearing !== null && bearing !== undefined ? `transform: rotate(${bearing}deg);` : '';
  const arrow = bearing !== null && bearing !== undefined
    ? `<div class="live-bus-arrow" style="${rotation}"></div>`
    : '';
  return L.divIcon({
    html: `<div class="live-bus-marker">
      ${arrow}
      <div class="live-bus-icon">
        <span class="live-bus-number">${lineName || '?'}</span>
      </div>
      <div class="live-bus-pulse"></div>
    </div>`,
    className: 'live-bus-marker-wrapper',
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
};

// Button to centre the map on the user's location
function LocateMeButton({ onLocate }) {
  const map = useMap();
  return (
    <div className="locate-me-btn-wrapper">
      <button
        className="locate-me-btn"
        onClick={(e) => {
          e.stopPropagation();
          onLocate?.();
          // Pan map to user's location marker if available
          const centre = map.getCenter();
          if (centre) map.setZoom(15);
        }}
        title="Use my location as start"
        aria-label="Use my current location"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
        </svg>
      </button>
    </div>
  );
}

// Component that smoothly pans to user's location when activated
function PanToUser({ userLocation, active }) {
  const map = useMap();
  useEffect(() => {
    if (active && userLocation) {
      map.flyTo([userLocation.lat, userLocation.lon], Math.max(map.getZoom(), 15), { duration: 0.8 });
    }
  }, [active, userLocation, map]);
  return null;
}

function MapView({ userLocation, startLocation, endLocation, routes, selectedRoute, onLocateMe, onPinDrop, currentWeather, weatherLoading, onWeatherClick, liveVehicles, liveTrackingActive, trackedRoute }) {
  const [panToUser, setPanToUser] = useState(false);
  const [dragLatLng, setDragLatLng] = useState(null);

  const defaultCenter = [53.96, -2.8];

  useEffect(() => {
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
    });
  }, []);

  // Build polyline segments and changeover markers from selected route
  const routeOverlays = [];
  if (routes && selectedRoute !== null && routes.routes[selectedRoute]) {
    const route = routes.routes[selectedRoute];

    route.legs.forEach((leg, i) => {
      const from = leg.fromCoords;
      const to = leg.toCoords;

      // Use detailed geometry if available (road/rail-following), otherwise fallback to straight line
      if (leg.geometry && leg.geometry.length >= 2) {
        const style = legStyles[leg.type] || legStyles.walk;
        routeOverlays.push(
          <Polyline
            key={`leg-${selectedRoute}-${i}`}
            positions={leg.geometry}
            color={style.color}
            weight={style.weight}
            opacity={style.opacity}
            dashArray={style.dashArray}
          />
        );
      } else if (from && to && (from.lat !== to.lat || from.lon !== to.lon)) {
        const style = legStyles[leg.type] || legStyles.walk;
        routeOverlays.push(
          <Polyline
            key={`leg-${selectedRoute}-${i}`}
            positions={[[from.lat, from.lon], [to.lat, to.lon]]}
            color={style.color}
            weight={style.weight}
            opacity={style.opacity}
            dashArray={style.dashArray}
          />
        );
      }

      // Add changeover markers at transfer/connection points
      if (leg.type === 'transfer' && from) {
        routeOverlays.push(
          <Marker
            key={`changeover-${selectedRoute}-${i}`}
            position={[from.lat, from.lon]}
            icon={changeoverIcon('C')}
          >
            <Popup>
              <strong>🔄 Changeover</strong><br/>
              {leg.station || leg.stop}<br/>
              Wait: {leg.waitMinutes} min
            </Popup>
          </Marker>
        );
      }

      // Add intermediate stop markers for bus/train boarding and alighting
      if ((leg.type === 'bus' || leg.type === 'train') && from) {
        routeOverlays.push(
          <CircleMarker
            key={`board-${selectedRoute}-${i}`}
            center={[from.lat, from.lon]}
            radius={5}
            fillColor={legStyles[leg.type].color}
            fillOpacity={0.9}
            color="#fff"
            weight={2}
          >
            <Popup>
              <strong>{leg.type === 'bus' ? '🚌' : '🚂'} Board</strong><br/>
              {leg.boardName}<br/>
              {leg.boardTime?.substring(0, 5)}
            </Popup>
          </CircleMarker>
        );
      }
      if ((leg.type === 'bus' || leg.type === 'train') && to) {
        routeOverlays.push(
          <CircleMarker
            key={`alight-${selectedRoute}-${i}`}
            center={[to.lat, to.lon]}
            radius={5}
            fillColor={legStyles[leg.type].color}
            fillOpacity={0.9}
            color="#fff"
            weight={2}
          >
            <Popup>
              <strong>{leg.type === 'bus' ? '🚌' : '🚂'} Alight</strong><br/>
              {leg.alightName}<br/>
              {leg.alightTime?.substring(0, 5)}
            </Popup>
          </CircleMarker>
        );
      }
    });
  }

  const getLatLng = (stop) => {
    if (!stop) return null;
    // Support direct lat/lon (from place selection)
    if (stop.lat !== undefined && stop.lon !== undefined) return [stop.lat, stop.lon];
    if (!stop.coordinates) return null;
    const coords = stop.coordinates;
    if (typeof coords === 'object' && coords.y !== undefined) return [coords.y, coords.x];
    if (typeof coords === 'object' && coords.lat !== undefined) return [coords.lat, coords.lon];
    if (typeof coords === 'string') {
      const match = coords.match(/\(([^,]+),([^)]+)\)/);
      if (match) return [parseFloat(match[2]), parseFloat(match[1])];
    }
    return null;
  };

  const startLatLng = getLatLng(startLocation);
  const endLatLng = getLatLng(endLocation);

  return (
    <div className="map-container">
      <MapContainer
        center={defaultCenter}
        zoom={10}
        className="map"
        zoomControl={false}
        minZoom={9}
        maxZoom={16}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapBounds />
        <FitToRoute
          startLocation={startLocation}
          endLocation={endLocation}
          routes={routes}
          selectedRoute={selectedRoute}
        />

        {/* Drag/drop handler for pin-drop destination selection */}
        <DragDropHandler onDrop={(latlng) => {
          setDragLatLng(null);
          if (onPinDrop) onPinDrop(latlng);
        }} onDrag={(latlng) => setDragLatLng(latlng)} />

        {/* Start marker (green) */}
        {startLatLng && (
          <Marker 
            position={startLatLng} 
            icon={L.icon({
              iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
            })}
          >
            <Popup><strong>📍 Start</strong><br/>{startLocation?.name || startLocation?.common_name}</Popup>
          </Marker>
        )}

        {/* End marker (red) */}
        {endLatLng && (
          <Marker 
            position={endLatLng} 
            icon={L.icon({
              iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
            })}
          >
            <Popup><strong>🏁 Destination</strong><br/>{endLocation?.name || endLocation?.common_name}</Popup>
          </Marker>
        )}

        {/* User live location — pulsing blue dot */}
        {userLocation && (
          <Marker
            position={[userLocation.lat, userLocation.lon]}
            icon={userDotIcon(userLocation.heading)}
            zIndexOffset={1000}
          >
            <Popup>
              <strong>📍 You are here</strong>
            </Popup>
          </Marker>
        )}

        {/* Temporary pin while dragging */}
        {dragLatLng && (
          <Marker
            position={[dragLatLng.lat, dragLatLng.lng]}
            icon={L.divIcon({ html: '<div class="pin-emoji">📌</div>', className: 'pin-drop-icon', iconSize: [28, 40], iconAnchor: [14, 40] })}
          />
        )}

        <LocateMeButton onLocate={() => { setPanToUser(true); onLocateMe?.(); setTimeout(() => setPanToUser(false), 1000); }} />
        <PanToUser userLocation={userLocation} active={panToUser} />

        {/* Route polylines and changeover markers */}
        {routeOverlays}

        {/* Live bus position markers */}
        {liveTrackingActive && liveVehicles && liveVehicles.map((vehicle, idx) => (
          <Marker
            key={`live-bus-${vehicle.vehicleRef || idx}`}
            position={[vehicle.latitude, vehicle.longitude]}
            icon={liveBusIcon(vehicle.lineName, vehicle.bearing)}
            zIndexOffset={900}
          >
            <Popup>
              <div className="live-bus-popup">
                <strong>🚌 {vehicle.lineName || 'Bus'}</strong>
                <br/>
                <span style={{fontSize: '12px', color: '#666'}}>
                  {vehicle.originName} → {vehicle.destinationName}
                </span>
                <br/>
                <span style={{fontSize: '11px', color: '#999'}}>
                  Vehicle: {vehicle.vehicleId || vehicle.vehicleRef}
                </span>
                {vehicle.bearing !== null && (
                  <><br/><span style={{fontSize: '11px', color: '#999'}}>
                    Bearing: {Math.round(vehicle.bearing)}°
                  </span></>
                )}
                {vehicle.recordedAt && (
                  <><br/><span style={{fontSize: '11px', color: '#2196F3'}}>
                    Updated: {new Date(vehicle.recordedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                  </span></>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Live tracking indicator badge */}
        {liveTrackingActive && trackedRoute && (
          <div className="live-tracking-badge">
            <span className="live-dot-indicator"></span>
            Tracking Bus {trackedRoute}
            <span className="live-count">{liveVehicles?.length || 0} active</span>
          </div>
        )}
      </MapContainer>
      <Compass />
      <WeatherIcon weather={currentWeather} loading={weatherLoading} onClick={onWeatherClick} />
    </div>
  );
}

export default MapView;
