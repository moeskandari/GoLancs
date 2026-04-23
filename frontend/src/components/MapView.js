import { useState, useEffect, useMemo, Fragment, useRef } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, Marker, Polyline, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapView.css';
import Compass from './Compass';
import { fetchNearbyStops, fetchBusStopRoutes, fetchRailDepartures, fetchTrafficConditions } from '../services/api';

function formatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5);
}

// Component to handle map bounds
function MapBounds() {
  const map = useMap();
  
  useEffect(() => {
    // Max bounds: cover all stations from Manchester Airport to Barrow/Corkickle to Leeds
    const maxBounds = [
      [53.30, -3.70],  // SW corner (south of Manchester Airport, west of Corkickle)
      [54.60, -1.40]   // NE corner (north of Corkickle, east of Leeds)
    ];
    // Default view: Lancashire core area (Lancaster, Preston, Blackpool, Fylde)
    const defaultView = [
      [53.55, -3.15],
      [54.25, -2.45]
    ];
    map.setMaxBounds(maxBounds);
    map.fitBounds(defaultView);
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

    const toLatLngFromClient = (clientX, clientY) => {
      try {
        return map.mouseEventToLatLng({ clientX, clientY });
      } catch {
        return null;
      }
    };

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

    // Mobile touch drag support for pin button
    const handleTouchMove = (ev) => {
      if (!window.__pinTouchDragActive) return;
      const t = ev.touches && ev.touches[0];
      if (!t) return;
      const rect = container.getBoundingClientRect();
      const withinMap = t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom;
      if (!withinMap) {
        if (onDrag) onDrag(null);
        return;
      }
      const latlng = toLatLngFromClient(t.clientX, t.clientY);
      if (latlng && onDrag) onDrag(latlng);
      // Prevent map pan while dragging a pin on touch
      ev.preventDefault();
    };

    const handleTouchEnd = (ev) => {
      if (!window.__pinTouchDragActive) return;
      const t = ev.changedTouches && ev.changedTouches[0];
      const moved = !!window.__pinTouchDragMoved;
      if (t && moved) {
        const rect = container.getBoundingClientRect();
        const withinMap = t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom;
        if (!withinMap) {
          if (onDrag) onDrag(null);
          window.__pinTouchDragActive = false;
          window.__pinTouchDragMoved = false;
          return;
        }
        const latlng = toLatLngFromClient(t.clientX, t.clientY);
        if (latlng && onDrop) onDrop(latlng);
      }
      if (onDrag) onDrag(null);
      window.__pinTouchDragActive = false;
      window.__pinTouchDragMoved = false;
    };

    container.addEventListener('dragover', handleDragOver);
    container.addEventListener('drop', handleDrop);
    container.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('dragover', handleDragOver);
      container.removeEventListener('drop', handleDrop);
      container.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
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

// Live bus marker icon — shows route number with bearing arrow and destination
const liveBusIcon = (lineName, bearing, destination) => {
  const rotation = bearing !== null && bearing !== undefined ? `transform: rotate(${bearing}deg);` : '';
  const arrow = bearing !== null && bearing !== undefined
    ? `<div class="live-bus-arrow" style="${rotation}"></div>`
    : '';
  // Truncate long destination names to 12 chars
  const displayDest = destination ? (destination.length > 12 ? destination.substring(0, 11) + '…' : destination) : '';
  return L.divIcon({
    html: `<div class="live-bus-marker">
      ${arrow}
      <div class="live-bus-icon">
        <span class="live-bus-number">${lineName || '?'}</span>
        ${displayDest ? `<span class="live-bus-destination">${displayDest}</span>` : ''}
      </div>
      <div class="live-bus-pulse"></div>
    </div>`,
    className: 'live-bus-marker-wrapper',
    iconSize: destination ? [50, 48] : [36, 36],
    iconAnchor: destination ? [25, 24] : [18, 18]
  });
};

// Live train marker icon — shows operator code with rail styling
const liveTrainIcon = (operator) => {
  return L.divIcon({
    html: `<div class="live-train-marker">
      <div class="live-train-icon">
        <span class="live-train-label">🚂 ${operator || 'Train'}</span>
      </div>
      <div class="live-train-pulse"></div>
    </div>`,
    className: 'live-train-marker-wrapper',
    iconSize: [48, 36],
    iconAnchor: [24, 18]
  });
};

// Bus stop marker icon — small circle for clickable bus stops
const busStopIcon = L.divIcon({
  html: `<div class="bus-stop-marker">
    <div class="bus-stop-icon">🚏</div>
  </div>`,
  className: 'bus-stop-marker-wrapper',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

const railStationIcon = L.divIcon({
  html: `<div class="rail-station-marker">
    <div class="rail-station-icon">🚉</div>
  </div>`,
  className: 'rail-station-marker-wrapper',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});
// Component to handle tap-to-pin-drop on mobile (pin mode)
function ClickToPinHandler({ active, onPinDrop }) {
  const map = useMap();

  useEffect(() => {
    if (!active || !map) return;
    const handleClick = (e) => {
      if (onPinDrop) onPinDrop(e.latlng);
    };
    map.on('click', handleClick);
    // Change cursor to crosshair when pin mode is active
    map.getContainer().style.cursor = 'crosshair';
    return () => {
      map.off('click', handleClick);
      map.getContainer().style.cursor = '';
    };
  }, [active, map, onPinDrop]);

  return null;
}

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

// Toggle button to enable continuous follow of user's location
function FollowToggleButton({ active, onToggle, userLocation }) {
  const map = useMap();
  return (
    <div className="follow-toggle-wrapper">
      <button
        className={`follow-toggle-btn ${active ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          // Enabling follow: if we have a valid userLocation, centre immediately with setView
          if (!active) {
            const lat = Number(userLocation?.lat);
            const lon = Number(userLocation?.lon);
            const accuracy = Number(userLocation?.accuracy);
            const ts = userLocation?.timestamp ? Number(userLocation.timestamp) : null;
            const ageMs = ts ? (Date.now() - ts) : Infinity;

            // Only snap immediately if we have a reasonably recent, accurate fix
            const MAX_ACCURACY = 1000; // meters
            const MAX_AGE_MS = 30 * 1000; // 30 seconds

            if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(accuracy) && accuracy <= MAX_ACCURACY && ageMs <= MAX_AGE_MS) {
              const targetZoom = Math.max((map && map.getZoom && map.getZoom()) || 15, 15);
              try {
                map.setView([lat, lon], targetZoom);
              } catch (e) {
                try { map.setZoom(targetZoom); } catch (ee) {}
              }
            } else {
              // Poor/old fix: enable follow but do not snap; this avoids centring to an inaccurate location
              try { map.setZoom(Math.max(map.getZoom(), 15)); } catch (e) {}
            }

            onToggle(true);
            return;
          }
          onToggle(false);
        }}
        title={active ? 'Disable follow' : 'Follow my location'}
        aria-pressed={active}
        aria-label={active ? 'Disable follow' : 'Follow my location'}
      >
        {active ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

// Handler to disable follow mode on user interactions (drag/zoom)
function MapInteractionHandler({ onInteraction }) {
  useMapEvents({
    dragstart: () => onInteraction && onInteraction(),
    zoomstart: () => onInteraction && onInteraction(),
    movestart: () => onInteraction && onInteraction()
  });
  return null;
}

// Dev-only: attach the Leaflet map instance to window._leaflet_map when ?mapdebug=1
function DebugAttach() {
  const map = useMap();
  useEffect(() => {
    try {
      if (typeof window === 'undefined' || !window.location) return;
      const params = new URLSearchParams(window.location.search);
      if (params.has('mapdebug') || params.has('geodebug')) {
        // eslint-disable-next-line no-console
        console.log('Map debug: attaching map to window._leaflet_map (DebugAttach)');
        Object.defineProperty(window, '_leaflet_map', { value: map, configurable: true, writable: true });
      }
    } catch (e) {
      // ignore
    }
    return () => {};
  }, [map]);
  return null;
}

// Component that smoothly pans to user's location when activated
function PanToUser({ userLocation, active }) {
  const map = useMap();
  const lastSmoothed = useRef(null);
  const lastMoveAt = useRef(0);

  // Haversine distance (km)
  const haversine = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
      * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  useEffect(() => {
    if (!active || !userLocation) return;

    // Validate numeric coordinates
    const latNum = Number(userLocation.lat);
    const lonNum = Number(userLocation.lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return;

    const alpha = 0.6; // smoothing factor (0..1) higher = more responsive to new fixes
    const minDistanceMeters = 5; // only recenter if moved more than this

    const newLoc = { lat: latNum, lon: lonNum };

    if (!lastSmoothed.current || !Number.isFinite(lastSmoothed.current.lat) || !Number.isFinite(lastSmoothed.current.lon)) {
      lastSmoothed.current = newLoc;
    } else {
      // exponential moving average
      lastSmoothed.current = {
        lat: lastSmoothed.current.lat * (1 - alpha) + newLoc.lat * alpha,
        lon: lastSmoothed.current.lon * (1 - alpha) + newLoc.lon * alpha
      };
    }

    const centre = map && map.getCenter && map.getCenter();
    if (!centre || !Number.isFinite(centre.lat) || !Number.isFinite(centre.lng)) return;

    const centreLat = Number(centre.lat);
    const centreLon = Number(centre.lng);
    const distKm = haversine(centreLat, centreLon, lastSmoothed.current.lat, lastSmoothed.current.lon);
    const distMeters = distKm * 1000;

    if (distMeters >= minDistanceMeters) {
      try {
        const now = Date.now();
        // Rate-limit moves to avoid spamming flyTo on noisy updates (min 200ms)
        if (now - lastMoveAt.current < 200) return;
        lastMoveAt.current = now;

        // Stop any ongoing animation so new locations apply immediately
        try { if (map && map.stop) map.stop(); } catch (e) { /* ignore */ }

        // gentle fly/pan behaviour heuristics
        const targetZoom = Math.max((map && map.getZoom && map.getZoom()) || 15, 15);

        // Moderate to large jumps should snap immediately to avoid long flights that fall behind
        if (distMeters > 150) {
          map.setView([lastSmoothed.current.lat, lastSmoothed.current.lon], targetZoom);
          return;
        }

        // Very small moves: use panTo for subtle motion
        if (distMeters < 50) {
          map.panTo([lastSmoothed.current.lat, lastSmoothed.current.lon]);
          return;
        }

        // Scale fly duration with distance (clamped, shorter than before) so follow feels snappy
        const duration = Math.min(0.8, Math.max(0.12, distMeters / 4000));
        map.flyTo([lastSmoothed.current.lat, lastSmoothed.current.lon], targetZoom, { duration });
      } catch (err) {
        try { map.panTo([lastSmoothed.current.lat, lastSmoothed.current.lon]); } catch (e) { console.warn('PanToUser: failed to pan map', e); }
      }
    }
  }, [active, userLocation, map]);

  return null;
}

function parseHHMMToMinutes(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function getMinutesUntil(timeStr, referenceHHMM = null) {
  const target = parseHHMMToMinutes(timeStr);
  if (target === null) return null;

  let nowMins;
  if (referenceHHMM && /^\d{2}:\d{2}(:\d{2})?$/.test(referenceHHMM)) {
    const ref = referenceHHMM.substring(0, 5);
    const parsedRef = parseHHMMToMinutes(ref);
    nowMins = parsedRef !== null ? parsedRef : (new Date().getHours() * 60 + new Date().getMinutes());
  } else {
    const now = new Date();
    nowMins = now.getHours() * 60 + now.getMinutes();
  }
  let diff = target - nowMins;

  // Handle just-after-midnight services
  if (diff < -1200) diff += 1440;
  if (diff < 0) return null;
  return diff;
}

function parseBusStopDisplay(commonName) {
  const fullName = (commonName || '').trim();
  if (!fullName) {
    return { baseName: 'Bus stop', platformLabel: null };
  }

  let baseName = fullName;
  let platformLabel = null;

  const commaIdx = fullName.lastIndexOf(',');
  if (commaIdx > 0) {
    const tail = fullName.slice(commaIdx + 1).trim();
    const looksLikePlatform = /^(stand|stance|bay|platform|stop|gate|quay)\b/i.test(tail)
      || /^[A-Z]{1,2}\d{0,2}[A-Z]?$/i.test(tail)
      || /^\d{1,2}[A-Z]?$/i.test(tail);
    if (tail && looksLikePlatform) {
      baseName = fullName.slice(0, commaIdx).trim();
      platformLabel = tail;
    }
  }

  if (!platformLabel) {
    const suffixMatch = fullName.match(/\b(Stand|Stance|Bay|Platform|Stop|Gate|Quay)\s*([A-Z0-9-]+)\s*$/i);
    if (suffixMatch) {
      baseName = fullName.slice(0, suffixMatch.index).trim() || fullName;
      platformLabel = `${suffixMatch[1]} ${suffixMatch[2]}`.trim();
    }
  }

  return { baseName, platformLabel };
}

function longestCommonPrefix(values) {
  if (!Array.isArray(values) || values.length === 0) return '';
  let prefix = values[0] || '';
  for (let i = 1; i < values.length; i += 1) {
    const current = values[i] || '';
    let j = 0;
    while (
      j < prefix.length
      && j < current.length
      && prefix[j].toLowerCase() === current[j].toLowerCase()
    ) {
      j += 1;
    }
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}

// Component to fetch and display nearby bus stops and rail stations
function BusStopMarkers({ routes, selectedRoute, showBusStops, showTrainStations, selectedTime, selectedDay }) {
  const [busStops, setBusStops] = useState([]);
  const [railStops, setRailStops] = useState([]);
  const [selectedStop, setSelectedStop] = useState(null);
  const [selectedPlatformAtco, setSelectedPlatformAtco] = useState(null);
  const [selectedGroupMembers, setSelectedGroupMembers] = useState([]);
  const [stopRoutes, setStopRoutes] = useState(null);
  const [stopRoutesCache, setStopRoutesCache] = useState({});
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [selectedRailStop, setSelectedRailStop] = useState(null);
  const [railDepartures, setRailDepartures] = useState(null);
  const [loadingRail, setLoadingRail] = useState(false);
  const map = useMap();

  const groupedBusStops = useMemo(() => {
    const groups = [];
    const MAX_GROUP_DELTA = 0.0012; // ~130m, enough to include bus station stances

    for (const stop of busStops) {
      const lat = parseFloat(stop.lat);
      const lon = parseFloat(stop.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const { baseName, platformLabel } = parseBusStopDisplay(stop.common_name);
      const baseKey = baseName.toLowerCase();

      const existing = groups.find((g) =>
        g.baseKey === baseKey
        && Math.abs(g.lat - lat) <= MAX_GROUP_DELTA
        && Math.abs(g.lon - lon) <= MAX_GROUP_DELTA
      );

      if (existing) {
        existing.members.push({ ...stop, lat, lon, baseName, platformLabel });
        const n = existing.members.length;
        existing.lat = ((existing.lat * (n - 1)) + lat) / n;
        existing.lon = ((existing.lon * (n - 1)) + lon) / n;
      } else {
        groups.push({
          id: `${baseKey}-${lat.toFixed(4)}-${lon.toFixed(4)}`,
          baseKey,
          baseName,
          lat,
          lon,
          members: [{ ...stop, lat, lon, baseName, platformLabel }],
        });
      }
    }

    groups.forEach((g) => {
      const names = g.members.map((m) => (m.common_name || '').trim()).filter(Boolean);
      const sharedPrefix = longestCommonPrefix(names).replace(/[\s,;:\-_/]+$/g, '');

      g.members = g.members.map((m, idx) => {
        if (m.platformLabel) return m;

        const full = (m.common_name || '').trim();
        let derived = '';

        if (sharedPrefix && full.toLowerCase().startsWith(sharedPrefix.toLowerCase())) {
          derived = full.slice(sharedPrefix.length).replace(/^[\s,;:\-_/]+/g, '').trim();
        }

        if (!derived || derived.length > 24) {
          derived = `Platform ${idx + 1}`;
        }

        return { ...m, platformLabel: derived };
      });

      g.members.sort((a, b) => a.platformLabel.localeCompare(b.platformLabel, undefined, { numeric: true, sensitivity: 'base' }));

      const sortedAtcos = g.members.map((m) => m.atco_code).sort();
      g.id = `${g.baseKey}-${sortedAtcos.join('-')}`;
    });

    return groups;
  }, [busStops]);

  useEffect(() => {
    // Fetch bus stops within the current map view
    const fetchStops = async () => {
      const bounds = map.getBounds();
      const center = bounds.getCenter();
      
      try {
        const stopsData = await fetchNearbyStops(center.lat, center.lng, 2.0);
        // Backend returns { bus: [], rail: [] }
        const busOnly = Array.isArray(stopsData?.bus) ? stopsData.bus : [];
        const railOnly = Array.isArray(stopsData?.rail) ? stopsData.rail : [];
        const seen = new Set(busOnly.map((s) => s.atco_code));
        const preserved = selectedGroupMembers.filter((s) => !seen.has(s.atco_code));
        setBusStops([...busOnly, ...preserved]);
        setRailStops(railOnly);
      } catch (err) {
        console.error('Failed to fetch bus stops:', err);
      }
    };

    // Fetch stops when map bounds change
    map.on('moveend', fetchStops);
    fetchStops();

    return () => {
      map.off('moveend', fetchStops);
    };
  }, [map, selectedGroupMembers]);

  const handleStopClick = async (stop, groupMembers = null) => {
    setSelectedStop(stop);
    setSelectedPlatformAtco(stop.atco_code);
    if (Array.isArray(groupMembers) && groupMembers.length > 0) {
      setSelectedGroupMembers(groupMembers);
    }

    if (stopRoutesCache[stop.atco_code]) {
      setStopRoutes(stopRoutesCache[stop.atco_code]);
      setLoadingRoutes(false);
      return;
    }

    setLoadingRoutes(true);
    setStopRoutes(null);
    
    try {
      const data = await fetchBusStopRoutes(stop.atco_code);
      setStopRoutes(data);
      setStopRoutesCache((prev) => ({ ...prev, [stop.atco_code]: data }));
    } catch (err) {
      console.error('Failed to fetch stop routes:', err);
      const fallback = { error: 'Failed to load route information' };
      setStopRoutes(fallback);
      setStopRoutesCache((prev) => ({ ...prev, [stop.atco_code]: fallback }));
    } finally {
      setLoadingRoutes(false);
    }
  };

  const handleRailStopClick = async (station) => {
    setSelectedRailStop(station);
    setLoadingRail(true);
    setRailDepartures(null);

    try {
      if (!station.crs_code) {
        setRailDepartures({ services: [] });
        return;
      }
      const data = await fetchRailDepartures(station.crs_code, {
        time: selectedTime,
        day: selectedDay,
      });
      setRailDepartures(data);
    } catch (err) {
      console.error('Failed to fetch rail departures:', err);
      setRailDepartures({ error: 'Failed to load train times' });
    } finally {
      setLoadingRail(false);
    }
  };

  return (
    <>
      {showBusStops && groupedBusStops.map((group) => {
        const activeStop = group.members.find((m) => m.atco_code === selectedPlatformAtco) || group.members[0];

        return (
        <Marker
          key={`bus-stop-group-${group.id}`}
          position={[group.lat, group.lon]}
          icon={busStopIcon}
          eventHandlers={{
            click: () => handleStopClick(activeStop, group.members)
          }}
        >
          <Popup maxWidth={300} minWidth={250} keepInView autoPanPadding={[24, 24]}>
            <div className="bus-stop-popup">
              <strong>🚏 {group.baseName}</strong>
              {group.members.length > 1 && (
                <div className="bus-stop-group-count">{group.members.length} platforms</div>
              )}

              {group.members.length > 1 && (
                <div className="bus-platform-tabs" role="tablist" aria-label="Stop platforms">
                  {group.members.map((platformStop) => (
                    <button
                      key={`platform-tab-${platformStop.atco_code}`}
                      type="button"
                      className={`bus-platform-tab${activeStop.atco_code === platformStop.atco_code ? ' active' : ''}`}
                      onClick={() => handleStopClick(platformStop, group.members)}
                    >
                      {platformStop.platformLabel}
                    </button>
                  ))}
                </div>
              )}

              <div className="bus-stop-atco">{activeStop.atco_code}</div>
              
              {loadingRoutes && selectedStop?.atco_code === activeStop.atco_code && (
                <div className="loading-routes">Loading routes...</div>
              )}
              
              {stopRoutes && selectedStop?.atco_code === activeStop.atco_code && (
                <>
                  {stopRoutes.error ? (
                    <div className="error-message">{stopRoutes.error}</div>
                  ) : stopRoutes.routes && stopRoutes.routes.length > 0 ? (
                    <div className="stop-routes-list">
                      <div className="routes-header">Bus routes stopping here:</div>
                      <div className="stop-routes-scroll">
                        {stopRoutes.routes.map((route, idx) => (
                          <div key={`route-${route.routeId}-${idx}`} className="route-item">
                            <div className="route-number-badge">{route.routeNumber}</div>
                            <div className="route-info">
                              <div className="route-destination">
                                → {route.destination || 'Unknown'}
                              </div>
                              <div className="route-operator">{route.operatorName || route.operatorCode}</div>
                              <div className="route-stops-count">
                                {route.stops.length} stops · from {route.origin || 'Unknown'}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="no-routes">No bus routes found for this stop</div>
                  )}
                </>
              )}
            </div>
          </Popup>
        </Marker>
      )})}

      {showTrainStations && railStops.map((station) => (
        <Marker
          key={`rail-station-${station.atco_code}`}
          position={[parseFloat(station.lat), parseFloat(station.lon)]}
          icon={railStationIcon}
          eventHandlers={{
            click: () => handleRailStopClick(station)
          }}
        >
          <Popup maxWidth={320} minWidth={260}>
            <strong>🚉 {station.common_name}</strong><br/>
            {station.crs_code ? `CRS: ${station.crs_code}` : station.atco_code}
            {loadingRail && selectedRailStop?.atco_code === station.atco_code && (
              <div className="loading-routes">Loading train times...</div>
            )}

            {railDepartures && selectedRailStop?.atco_code === station.atco_code && (
              <div className="rail-arrivals-box">
                {railDepartures.error ? (
                  <div className="error-message">{railDepartures.error}</div>
                ) : (() => {
                  const upcoming = (railDepartures.services || [])
                    .map((svc) => {
                      const est = svc.estimatedDeparture || '';
                      const sched = svc.scheduledDeparture || '';
                      const isCancelled = /cancel/i.test(est) || !!svc.cancelReason;
                      const isDelayed = !isCancelled && (
                        est === 'Delayed' ||
                        (/^\d{2}:\d{2}$/.test(est) && est !== sched)
                      );
                      const preferred = /^\d{2}:\d{2}$/.test(est)
                        ? est
                        : sched;
                      const mins = getMinutesUntil(preferred, selectedTime);
                      // Calculate delay in minutes when both times are valid HH:MM
                      let delayMins = 0;
                      if (isDelayed && /^\d{2}:\d{2}$/.test(est) && /^\d{2}:\d{2}$/.test(sched)) {
                        const [sh, sm] = sched.split(':').map(Number);
                        const [eh, em] = est.split(':').map(Number);
                        delayMins = (eh * 60 + em) - (sh * 60 + sm);
                        if (delayMins < 0) delayMins += 1440; // handle midnight wrap
                      }
                      return { svc, mins, preferred, isCancelled, isDelayed, delayMins };
                    })
                    .filter(({ mins, isCancelled }) => isCancelled || (mins !== null && mins <= 60))
                    .sort((a, b) => (a.mins ?? 999) - (b.mins ?? 999))
                    .slice(0, 5);

                  if (upcoming.length === 0) {
                    return <div className="no-routes">No trains within the next hour</div>;
                  }

                  return (
                    <>
                      <div className="routes-header">Trains in next 60 min:</div>
                      {upcoming.map(({ svc, mins, isCancelled, isDelayed, delayMins }, idx) => (
                        (() => {
                          const trainDestination = svc.destination?.name
                            || svc.callingPoints?.[svc.callingPoints.length - 1]?.name
                            || svc.destination?.crs
                            || 'Unknown';
                          return (
                        <div
                          key={`rail-upcoming-${idx}`}
                          className={`rail-arrival-item${
                            isCancelled ? ' rail-cancelled' : isDelayed ? ' rail-delayed' : ''
                          }`}
                        >
                          <div className="rail-arrival-destination">
                            Towards {trainDestination}
                            <span className="rail-platform"> · Plat {svc.platform || 'TBC'}</span>
                          </div>
                          <div className="rail-arrival-time-col">
                            {isCancelled ? (
                              <>
                                <span className="rail-time-sched rail-strike">{svc.scheduledDeparture}</span>
                                <span className="rail-badge rail-badge-cancel">Cancelled</span>
                              </>
                            ) : isDelayed ? (
                              <>
                                <span className="rail-time-sched rail-strike">{svc.scheduledDeparture}</span>
                                <span className="rail-time-est">
                                  {/^\d{2}:\d{2}$/.test(svc.estimatedDeparture)
                                    ? svc.estimatedDeparture
                                    : 'Delayed'}
                                </span>
                                <span className="rail-badge rail-badge-delay">
                                  {delayMins > 0 ? `+${delayMins}m` : 'Late'}
                                </span>
                              </>
                            ) : (
                              <span className="rail-time-ontime">
                                {mins === 0 ? 'Due now' : `${mins} min`}
                              </span>
                            )}
                          </div>
                          {(isDelayed && svc.delayReason) && (
                            <div className="rail-delay-reason">{svc.delayReason}</div>
                          )}
                          {(isCancelled && svc.cancelReason) && (
                            <div className="rail-delay-reason">{svc.cancelReason}</div>
                          )}
                        </div>
                          );
                        })()
                      ))}
                    </>
                  );
                })()}
              </div>
            )}
          </Popup>
        </Marker>
      ))}
    </>
  );
}

// ─── Traffic Condition Road Segments ─────────────────────────────────────────
// Severity colour palette: darker red = worse delays
export const TRAFFIC_COLORS = {
  0: { color: '#22c55e', label: 'Normal' },      // green
  1: { color: '#eab308', label: 'Minor delays' }, // yellow
  2: { color: '#f97316', label: 'Moderate' },      // orange
  3: { color: '#b91c1c', label: 'Heavy delays' },  // dark red
};

function TrafficZones({ show, selectedTime, selectedDay }) {
  const TRAFFIC_VISIBLE_ZOOM = 12;
  const TRAFFIC_FOCUS_ZOOM = 14;
  const [segments, setSegments] = useState([]);
  const [meta, setMeta] = useState({});
  const [showLegend, setShowLegend] = useState(true);
  const [zoom, setZoom] = useState(11);
  const map = useMap();

  // Track zoom level for responsive line thickness
  useEffect(() => {
    setZoom(map.getZoom());
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => map.off('zoomend', onZoom);
  }, [map]);

  useEffect(() => {
    if (!show) { setSegments([]); return; }

    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchTrafficConditions({
          time: selectedTime || undefined,
          day: selectedDay !== undefined ? selectedDay : undefined,
        });
        if (!cancelled) {
          setSegments(data.segments || []);
          setMeta({
            timestamp: data.timestamp,
            rushHour: data.rushHour,
            offPeak: data.offPeak,
            totalSigns: data.totalSigns,
          });
        }
      } catch (err) {
        console.error('Failed to fetch traffic conditions:', err);
        if (!cancelled) setSegments([]);
      }
    };
    load();

    // Refresh every 3 minutes
    const interval = setInterval(load, 3 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [show, selectedTime, selectedDay]);

  if (!show || segments.length === 0) return null;

  // Only display segments with actual delays (severity >= 1)
  const activeSegments = segments.filter(s => s.severity >= 1);

  // Keep traffic overlay out of the way when zoomed out
  if (zoom < TRAFFIC_VISIBLE_ZOOM) return null;

  // Zoom-responsive intensity: subtle at first visible zoom, clearer when zoomed in
  const zoomProgress = Math.min(1, Math.max(0, (zoom - TRAFFIC_VISIBLE_ZOOM) / (TRAFFIC_FOCUS_ZOOM - TRAFFIC_VISIBLE_ZOOM)));

  return (
    <>
      {activeSegments.map((seg) => {
        const colors = TRAFFIC_COLORS[seg.severity] || TRAFFIC_COLORS[0];
        // Base weight: severity 1→6, 2→9, 3→12 then scaled by zoom progress
        const baseWeight = 3 + seg.severity * 3;
        const weight = Math.max(2, Math.round(baseWeight * (0.35 + zoomProgress * 0.65)));
        const outlineWeight = weight + Math.max(1, Math.round(2 * zoomProgress));
        const opacity = (0.2 + zoomProgress * 0.55) * (seg.severity >= 3 ? 1 : seg.severity === 2 ? 0.9 : 0.8);

        return (
          <Fragment key={seg.id}>
            {/* Dark outline for contrast at all zoom levels */}
            <Polyline
              positions={seg.coordinates}
              pathOptions={{
                color: '#1a1a2e',
                weight: outlineWeight,
                opacity: opacity * 0.5,
                lineCap: 'round',
                lineJoin: 'round',
                interactive: false,
              }}
            />
            {/* Coloured severity line */}
            <Polyline
              positions={seg.coordinates}
              pathOptions={{
                color: colors.color,
                weight: weight,
                opacity: opacity,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            >
              <Popup maxWidth={280} minWidth={200}>
                <div className="traffic-zone-popup">
                  <strong style={{ color: colors.color }}>
                    {seg.severity >= 3 ? '🔴' : seg.severity === 2 ? '🟠' : '🟡'}{' '}
                    {seg.label}
                  </strong>
                  <div className="traffic-zone-road">{seg.road}</div>
                  {seg.descriptions.map((desc, i) => (
                    <div key={i} className="traffic-zone-desc">{desc}</div>
                  ))}
                  {seg.directions.length > 0 && (
                    <div className="traffic-zone-meta">{seg.directions.join(', ')}</div>
                  )}
                </div>
              </Popup>
            </Polyline>
          </Fragment>
        );
      })}

      {/* Floating traffic legend */}
      {showLegend && (
        <div className="traffic-legend" onClick={(e) => e.stopPropagation()}>
          <div className="traffic-legend-title">
            Road Traffic
            <span className="traffic-legend-close" title="Close legend" onClick={() => setShowLegend(false)}>✕</span>
          </div>
          {meta.rushHour && (
            <div className="traffic-rush-badge rush">⏰ Rush Hour</div>
          )}
          {meta.offPeak && (
            <div className="traffic-rush-badge off-peak">🌙 Off-Peak</div>
          )}
          {[3, 2, 1].map((sev) => (
            <div key={sev} className="traffic-legend-item">
              <span className="traffic-legend-line" style={{ backgroundColor: TRAFFIC_COLORS[sev].color }} />
              <span className="traffic-legend-label">{TRAFFIC_COLORS[sev].label}</span>
            </div>
          ))}
          {meta.timestamp && (
            <div className="traffic-legend-time">
              Updated: {new Date(meta.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MapView({ userLocation, startLocation, endLocation, selectedTime = null, selectedDay = null, showBusStops = true, showTrainStations = false, showTrafficConditions = false, routes, selectedRoute, onLocateMe, onPinDrop, currentWeather, weatherLoading, onWeatherClick, liveVehicles, liveTrackingActive, trackedLeg, trackedTrainService, pinMode = false }) {
  const [panToUser, setPanToUser] = useState(false);
  const [followUser, setFollowUser] = useState(false);
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
        const prevLeg = route.legs[i - 1] || null;
        const nextLeg = route.legs[i + 1] || null;
        const fromService = prevLeg?.type === 'bus'
          ? `Bus ${prevLeg.routeNumber || ''}`.trim()
          : prevLeg?.type === 'train'
            ? `Train ${prevLeg.operator || ''}`.trim()
            : 'previous service';
        const toService = nextLeg?.type === 'bus'
          ? `Bus ${nextLeg.routeNumber || ''}`.trim()
          : nextLeg?.type === 'train'
            ? `Train ${nextLeg.operator || ''}`.trim()
            : 'next service';
        routeOverlays.push(
          <Marker
            key={`changeover-${selectedRoute}-${i}`}
            position={[from.lat, from.lon]}
            icon={changeoverIcon('C')}
          >
            <Popup>
              <strong>🔄 Changeover</strong><br/>
              {leg.station || leg.stop}<br/>
              Get off: {fromService}<br/>
              Wait: {leg.waitMinutes} min<br/>
              Board: {toService}
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
        whenCreated={(m) => {
          try {
            if (typeof window !== 'undefined' && window.location && window.location.search) {
              const params = new URLSearchParams(window.location.search);
              if (params.has('mapdebug') || params.has('geodebug')) {
                // Attach for temporary debugging only; activated via ?mapdebug=1 or ?geodebug=1
                // Avoid exposing in normal usage.
                // eslint-disable-next-line no-console
                console.log('Map debug: attaching Leaflet map to window._leaflet_map');
                // Non-enumerable assignment to avoid accidental leaks in serialization
                Object.defineProperty(window, '_leaflet_map', { value: m, configurable: true, writable: true });
              }
            }
          } catch (e) {
            // ignore failures in older browsers/environments
          }
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapBounds />
        <DebugAttach />
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

        {/* Tap-to-pin handler for mobile touch devices */}
        <ClickToPinHandler active={pinMode} onPinDrop={(latlng) => {
          if (onPinDrop) onPinDrop(latlng);
        }} />

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

        <LocateMeButton onLocate={() => { setPanToUser(true); setFollowUser(false); onLocateMe?.(); setTimeout(() => setPanToUser(false), 1000); }} />
        <FollowToggleButton active={followUser} onToggle={(v) => { setFollowUser(!!v); if (v) setPanToUser(false); }} userLocation={userLocation} />
        <PanToUser userLocation={userLocation} active={panToUser || followUser} />
        {/* Map interaction handler will disable follow when the user manually drags/zooms */}
        <MapInteractionHandler onInteraction={() => { setFollowUser(false); }} />

        {/* Nearby transport stop markers */}
        {(showBusStops || showTrainStations) && (
          <BusStopMarkers
            routes={routes}
            selectedRoute={selectedRoute}
            showBusStops={showBusStops}
            showTrainStations={showTrainStations}
            selectedTime={selectedTime}
            selectedDay={selectedDay}
          />
        )}

        {/* Traffic condition zones (delay overlays) */}
        <TrafficZones show={showTrafficConditions} selectedTime={selectedTime} selectedDay={selectedDay} />

        {/* Route polylines and changeover markers */}
        {routeOverlays}

        {/* Live bus position markers */}
        {liveTrackingActive && trackedLeg?.type !== 'train' && liveVehicles && liveVehicles.map((vehicle, idx) => (
          <Marker
            key={`live-bus-${vehicle.vehicleRef || idx}`}
            position={[vehicle.latitude, vehicle.longitude]}
            icon={liveBusIcon(vehicle.lineName, vehicle.bearing, vehicle.destinationName)}
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

        {/* Live train position marker (estimated from calling points) */}
        {liveTrackingActive && trackedLeg?.type === 'train' && trackedTrainService && (() => {
          // Build waypoints from calling points (with coordinates and times)
          // This works for trains coming from anywhere — not limited to rail graph coverage
          const now = new Date();
          const todayStr = now.toISOString().split('T')[0];

          // Build ordered waypoints: boarding station + calling points (all with coords and times)
          const waypoints = [];

          // Add the boarding station as first waypoint
          const boardingCoords = trackedTrainService.boardingStation;
          if (boardingCoords?.lat && boardingCoords?.lon) {
            waypoints.push({
              lat: boardingCoords.lat,
              lon: boardingCoords.lon,
              time: new Date(`${todayStr}T${trackedLeg.boardTime}`),
              name: trackedLeg.boardName || 'Departure'
            });
          }

          // Add calling points that have coordinates
          if (trackedTrainService.callingPoints) {
            for (const cp of trackedTrainService.callingPoints) {
              if (cp.lat && cp.lon && cp.scheduledTime) {
                waypoints.push({
                  lat: cp.lat,
                  lon: cp.lon,
                  time: new Date(`${todayStr}T${cp.scheduledTime}`),
                  name: cp.name
                });
              }
            }
          }

          // Need at least 2 waypoints to estimate position
          if (waypoints.length < 2) {
            // Fallback: use leg start/end coords with overall progress
            const selRoute = routes?.routes?.[selectedRoute];
            const trainLeg = selRoute?.legs?.find(l => l.type === 'train' && l.trainUid === trackedLeg.trainUid);
            const depTime = new Date(`${todayStr}T${trackedLeg.boardTime}`);
            const arrTime = new Date(`${todayStr}T${trackedLeg.alightTime}`);
            const totalMs = arrTime - depTime;
            const elapsedMs = now - depTime;
            const progress = totalMs > 0 ? Math.max(0, Math.min(1, elapsedMs / totalMs)) : 0;

            let position = null;
            if (trainLeg?.geometry?.length >= 2) {
              const geom = trainLeg.geometry;
              const targetIdx = progress * (geom.length - 1);
              const idx = Math.floor(targetIdx);
              const frac = targetIdx - idx;
              position = idx >= geom.length - 1
                ? geom[geom.length - 1]
                : [geom[idx][0] + (geom[idx+1][0] - geom[idx][0]) * frac,
                   geom[idx][1] + (geom[idx+1][1] - geom[idx][1]) * frac];
            } else if (trainLeg?.fromCoords && trainLeg?.toCoords) {
              position = [
                trainLeg.fromCoords.lat + (trainLeg.toCoords.lat - trainLeg.fromCoords.lat) * progress,
                trainLeg.fromCoords.lon + (trainLeg.toCoords.lon - trainLeg.fromCoords.lon) * progress
              ];
            }
            if (!position) return null;

            // Render with fallback position
            const statusText = trackedTrainService.estimatedDeparture === 'On time'
              ? '✅ On time'
              : trackedTrainService.cancelReason ? '❌ Cancelled'
              : `⏱️ Est. ${trackedTrainService.estimatedDeparture}`;
            return (
              <Marker key="live-train" position={position} icon={liveTrainIcon(trackedLeg.operator)} zIndexOffset={1000}>
                <Popup>
                  <div className="live-bus-popup">
                    <strong>🚂 {trackedTrainService.origin?.name} → {trackedTrainService.destination?.name}</strong>
                    <br/><span style={{fontSize:'12px',color:'#666'}}>{trackedTrainService.operator} · {trackedTrainService.scheduledDeparture}</span>
                    <br/><span style={{fontSize:'12px',color:'#333',fontWeight:'bold'}}>{statusText}</span>
                    {trackedTrainService.platform && <><br/><span style={{fontSize:'12px',color:'#1976d2'}}>Platform {trackedTrainService.platform}</span></>}
                  </div>
                </Popup>
              </Marker>
            );
          }

          // Find which segment the train is currently on based on time
          // For segments within our rail-graph area (Lancashire), interpolate smoothly.
          // For segments outside the area, snap to the last station passed.
          const LOCAL_BOUNDS = { minLat: 53.60, maxLat: 54.20, minLon: -3.10, maxLon: -2.50 };
          const isLocal = (wp) => wp.lat >= LOCAL_BOUNDS.minLat && wp.lat <= LOCAL_BOUNDS.maxLat
                              && wp.lon >= LOCAL_BOUNDS.minLon && wp.lon <= LOCAL_BOUNDS.maxLon;

          let position = null;
          let lastPassedName = null;
          if (now <= waypoints[0].time) {
            // Before departure — show at boarding station
            position = [waypoints[0].lat, waypoints[0].lon];
            lastPassedName = waypoints[0].name;
          } else if (now >= waypoints[waypoints.length - 1].time) {
            // Past last calling point — show at final station
            position = [waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lon];
            lastPassedName = waypoints[waypoints.length - 1].name;
          } else {
            // Find the segment: between which two waypoints is 'now'?
            for (let i = 0; i < waypoints.length - 1; i++) {
              if (now >= waypoints[i].time && now <= waypoints[i + 1].time) {
                if (isLocal(waypoints[i]) && isLocal(waypoints[i + 1])) {
                  // Both ends are in our area — interpolate smoothly
                  const segMs = waypoints[i + 1].time - waypoints[i].time;
                  const segElapsed = now - waypoints[i].time;
                  const frac = segMs > 0 ? segElapsed / segMs : 0;
                  position = [
                    waypoints[i].lat + (waypoints[i + 1].lat - waypoints[i].lat) * frac,
                    waypoints[i].lon + (waypoints[i + 1].lon - waypoints[i].lon) * frac
                  ];
                  lastPassedName = waypoints[i].name;
                } else {
                  // Outside our area — snap to the last station passed
                  position = [waypoints[i].lat, waypoints[i].lon];
                  lastPassedName = waypoints[i].name;
                }
                break;
              }
            }
          }

          if (!position) position = [waypoints[0].lat, waypoints[0].lon];

          const statusText = trackedTrainService.estimatedDeparture === 'On time' 
            ? '✅ On time'
            : trackedTrainService.cancelReason 
              ? '❌ Cancelled'
              : `⏱️ Est. ${trackedTrainService.estimatedDeparture}`;

          return (
            <Marker
              key="live-train"
              position={position}
              icon={liveTrainIcon(trackedLeg.operator)}
              zIndexOffset={1000}
            >
              <Popup>
                <div className="live-bus-popup">
                  <strong>🚂 {trackedTrainService.origin?.name} → {trackedTrainService.destination?.name}</strong>
                  <br/>
                  <span style={{fontSize: '12px', color: '#666'}}>
                    {trackedTrainService.operator} · {trackedTrainService.scheduledDeparture}
                  </span>
                  {lastPassedName && (
                    <><br/><span style={{fontSize: '12px', color: '#1976d2', fontWeight: '600'}}>
                      📍 Last stop: {lastPassedName}
                    </span></>
                  )}
                  <br/>
                  <span style={{fontSize: '12px', color: '#333', fontWeight: 'bold'}}>
                    {statusText}
                  </span>
                  {trackedTrainService.platform && (
                    <><br/><span style={{fontSize: '12px', color: '#1976d2'}}>
                      Platform {trackedTrainService.platform}
                    </span></>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })()}

        {/* Live tracking indicator badge */}
        {liveTrackingActive && trackedLeg && (
          <div className="live-tracking-badge">
            <span className="live-dot-indicator"></span>
            {trackedLeg.type === 'train'
              ? `Tracking Train ${trackedLeg.operator || ''} ${formatTime(trackedLeg.boardTime)}`
              : `Tracking Bus ${trackedLeg.routeNumber}`
            }
            <span className="live-count">
              {trackedLeg.type === 'train'
                ? (trackedTrainService ? (trackedTrainService.estimatedDeparture === 'On time' ? 'On time' : trackedTrainService.estimatedDeparture || 'Live') : 'Searching...')
                : (liveVehicles?.length ? 'Your bus' : 'Searching...')
              }
            </span>
          </div>
        )}
      </MapContainer>

      {/* Pin-drop mode banner overlay */}
      {pinMode && (
        <div className="pin-mode-banner" role="status" aria-live="polite">
          📍 Tap anywhere on the map to set your destination
        </div>
      )}

      <Compass />
    </div>
  );
}

export default MapView;
