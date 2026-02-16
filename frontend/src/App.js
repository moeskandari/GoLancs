import React from 'react';
import './App.css';
import MapView from './components/MapView';
import SearchBar from './components/SearchBar';
import BottomControls from './components/BottomControls';

function App() {
  return (
    <div className="App">
      <div className="search-container">
        <SearchBar placeholder="Start location" type="start" />
        <SearchBar placeholder="Destination" type="destination" />
      </div>
      <MapView />
      <BottomControls />
    </div>
  );
}

export default App;
