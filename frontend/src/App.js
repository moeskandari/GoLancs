import React, { useEffect, useState } from 'react';
import './App.css';
import MapView from './components/MapView';
import BottomControls from './components/BottomControls';
import SearchBar from './components/SearchBar';

function App() {
  const [userLocation, setUserLocation] = useState(null);
  
  // Get user's location on mount
  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude])
    );
  }, []);

  return (
    <div className="App">
      <div className="search-container">
        <SearchBar placeholder="Where are you traveling from?" />
        <SearchBar placeholder="Where are you going?" />
        <button className="route-btn">Find Routes</button>
      </div>
      <MapView userLocation={userLocation} />
      <BottomControls />
    </div>
  );
}

export default App;
