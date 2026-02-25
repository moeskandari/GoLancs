import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, useMap, Marker, Polyline, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapView.css';
import Compass from './Compass';

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
    if (startLocation?.coordinates) addCoord(startLocation.coordinates);
    if (endLocation?.coordinates) addCoord(endLocation.coordinates);

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

function MapView({ userLocation: propUserLocation, startLocation, endLocation, routes, selectedRoute }) {
  const [userLocation, setUserLocation] = useState(propUserLocation);

  useEffect(() => {
    if (propUserLocation) {
      setUserLocation(propUserLocation);
      return;
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation([latitude, longitude]);
        },
        () => {}
      );
    }
  }, [propUserLocation]);

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
    if (!stop?.coordinates) return null;
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
            <Popup><strong>📍 Start</strong><br/>{startLocation?.common_name}</Popup>
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
            <Popup><strong>🏁 Destination</strong><br/>{endLocation?.common_name}</Popup>
          </Marker>
        )}

        {/* User location */}
        {userLocation && (
          <Marker position={userLocation} icon={L.divIcon({html: '📍', className: 'user-location-icon'})} />
        )}

        {/* Route polylines and changeover markers */}
        {routeOverlays}
      </MapContainer>
      <Compass />
    </div>
  );
}

export default MapView;
