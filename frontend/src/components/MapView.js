import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, useMap, Marker } from 'react-leaflet';
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

function MapView({ userLocation: propUserLocation, startLocation, endLocation }) {
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
      </MapContainer>
      <Compass />
    </div>
  );
}

export default MapView;
