import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapView.css';
import Compass from './Compass';

// Component to handle map bounds
function MapBounds() {
  const map = useMap();
  
  useEffect(() => {
    // Define bounds for Lancaster, Preston, Blackpool and Fylde coast
    const bounds = [
      [53.7, -3.2],  // Southwest corner
      [54.1, -2.6]   // Northeast corner
    ];
    
    map.setMaxBounds(bounds);
    map.fitBounds(bounds);
  }, [map]);
  
  return null;
}

// Component to fit map to route bounds
function FitToRoute({ startLocation, endLocation }) {
  const map = useMap();

  useEffect(() => {
    if (startLocation?.coordinates && endLocation?.coordinates) {
      const getCoords = (stop) => {
        const coords = stop.coordinates;
        if (typeof coords === 'object' && coords.x !== undefined) {
          return [coords.y, coords.x];
        } else if (typeof coords === 'string') {
          const match = coords.match(/\(([^,]+),([^)]+)\)/);
          if (match) return [parseFloat(match[2]), parseFloat(match[1])];
        } else if (typeof coords === 'object' && coords.lat !== undefined) {
          return [coords.lat, coords.lon];
        }
        return null;
      };

      const start = getCoords(startLocation);
      const end = getCoords(endLocation);

      if (start && end) {
        const bounds = L.latLngBounds([start, end]);
        map.fitBounds(bounds.pad(0.3), { maxZoom: 14 });
      }
    }
  }, [startLocation, endLocation, map]);

  return null;
}

// Color map for different route leg types
const legColors = {
  walk: '#4CAF50',
  bus: '#FF9800',
  train: '#1976D2',
  transfer: '#9E9E9E'
};

function MapView({ userLocation: propUserLocation, startLocation, endLocation, routes, selectedRoute }) {
  const [userLocation, setUserLocation] = useState(propUserLocation);
  const [stops, setStops] = useState([]);

  console.log('MapView rendered - userLocation:', userLocation, 'stops:', stops.length);

  // Get user's location on mount if not provided via props
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
        (error) => {
          console.log('Location access denied or unavailable');
        }
      );
    }
  }, [propUserLocation]);

  // Fetch stops from backend
  useEffect(() => {
    const fetchStops = async () => {
      try {
        const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
        console.log('Fetching stops from:', apiUrl);
        const url = userLocation 
          ? `${apiUrl}/api/stops?lat=${userLocation[0]}&lng=${userLocation[1]}`
          : `${apiUrl}/api/stops`;
        console.log('Request URL:', url);
        const response = await fetch(url);
        if (!response.ok) {
          console.error('API returned status:', response.status);
          setStops([]);
          return;
        }
        const data = await response.json();
        console.log('Received data:', data);
        setStops(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to fetch stops:', err);
        setStops([]);
      }
    };
    fetchStops();
  }, [userLocation]);

  // Center of the region (approximately Lancaster)
  const defaultCenter = [53.96, -2.8];

  useEffect(() => {
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
    });
  }, []);

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
        {startLocation && endLocation && (
          <FitToRoute startLocation={startLocation} endLocation={endLocation} />
        )}
        {stops.map((stop) => {
          const coords = stop.coordinates;
          if (!coords) return null;
          // Handle both formats: object {x, y} and string "(-2.7,53.5)"
          let lat, lng;
          if (typeof coords === 'object') {
            lat = coords.y;
            lng = coords.x;
          } else {
            const match = coords.match(/\(([^,]+),([^)]+)\)/);
            if (!match) return null;
            lat = parseFloat(match[2]);
            lng = parseFloat(match[1]);
          }
          return (
            <Marker key={stop.atco_code} position={[lat, lng]} title={stop.common_name}>
            </Marker>
          );
        })}
        {startLocation && startLocation.coordinates && (
          (() => {
            const coords = startLocation.coordinates;
            let lat, lng;
            if (typeof coords === 'object') {
              lat = coords.y;
              lng = coords.x;
            } else {
              const match = coords.match(/\(([^,]+),([^)]+)\)/);
              if (match) {
                lat = parseFloat(match[2]);
                lng = parseFloat(match[1]);
              }
            }
            return lat && lng ? (
              <Marker 
                position={[lat, lng]} 
                icon={L.icon({
                  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
                  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                  iconSize: [25, 41],
                  iconAnchor: [12, 41],
                  popupAnchor: [1, -34],
                  shadowSize: [41, 41]
                })}
                title={`Start: ${startLocation.common_name}`}
              />
            ) : null;
          })()
        )}
        {endLocation && endLocation.coordinates && (
          (() => {
            const coords = endLocation.coordinates;
            let lat, lng;
            if (typeof coords === 'object') {
              lat = coords.y;
              lng = coords.x;
            } else {
              const match = coords.match(/\(([^,]+),([^)]+)\)/);
              if (match) {
                lat = parseFloat(match[2]);
                lng = parseFloat(match[1]);
              }
            }
            return lat && lng ? (
              <Marker 
                position={[lat, lng]} 
                icon={L.icon({
                  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                  iconSize: [25, 41],
                  iconAnchor: [12, 41],
                  popupAnchor: [1, -34],
                  shadowSize: [41, 41]
                })}
                title={`End: ${endLocation.common_name}`}
              />
            ) : null;
          })()
        )}
        {userLocation && (
          <Marker position={userLocation} icon={L.divIcon({html: '📍', className: 'user-location-icon'})}>
          </Marker>
        )}
        {/* Route polylines for selected route */}
        {routes && selectedRoute !== null && routes.routes[selectedRoute] && (() => {
          const route = routes.routes[selectedRoute];
          const getLatLng = (coords) => {
            if (!coords) return null;
            if (typeof coords === 'object' && coords.lat !== undefined) {
              return [coords.lat, coords.lon];
            }
            if (typeof coords === 'object' && coords.y !== undefined) {
              return [coords.y, coords.x];
            }
            if (typeof coords === 'string') {
              const match = coords.match(/\(([^,]+),([^)]+)\)/);
              if (match) return [parseFloat(match[2]), parseFloat(match[1])];
            }
            return null;
          };

          // Build polyline segments from route legs using start/end coordinates
          const segments = [];
          const startCoord = getLatLng(routes.start.coordinates);
          const endCoord = getLatLng(routes.end.coordinates);

          if (startCoord && endCoord) {
            // Simple straight-line visualization between key points
            // In a full implementation, we'd use actual stop coordinates for each leg
            let currentPos = startCoord;
            
            for (const leg of route.legs) {
              let nextPos = null;
              
              if (leg.type === 'walk' || leg.type === 'transfer') {
                // Walk/transfer: draw as dashed
                // We don't have exact coords for intermediate points,
                // so we just note the segment type
                continue;
              }
              
              if (leg.type === 'bus' || leg.type === 'train') {
                // For now, draw a direct line 
                // between the start and end of each leg
                nextPos = endCoord; // simplified
              }
            }
            
            // Draw a single line from start to end with the dominant mode color
            const dominantMode = route.modes.includes('train') ? 'train' :
                                 route.modes.includes('bus') ? 'bus' : 'walk';
            segments.push(
              <Polyline
                key={`route-${selectedRoute}`}
                positions={[startCoord, endCoord]}
                color={legColors[dominantMode]}
                weight={4}
                opacity={0.7}
                dashArray={dominantMode === 'walk' ? '10, 10' : undefined}
              />
            );
          }

          return segments;
        })()}
      </MapContainer>
      <Compass />
    </div>
  );
}

export default MapView;
