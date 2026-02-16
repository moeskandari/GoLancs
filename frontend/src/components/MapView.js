import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
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

function MapView() {
  const [userLocation, setUserLocation] = useState(null);
  
  // Get user's location on mount
  useEffect(() => {
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
  }, []);

  // Center of the region (approximately Lancaster)
  const defaultCenter = [53.96, -2.8];

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
      </MapContainer>
      <Compass />
    </div>
  );
}

export default MapView;
