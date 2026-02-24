import React, { useState, useEffect } from 'react';
import './SearchBar.css';

function SearchBar({ placeholder, type, value, onChange, stops = [] }) {
  const [filteredStops, setFilteredStops] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  
  useEffect(() => {
    // If this is the start location search bar, try to get user location
    if (type === 'start' && navigator.geolocation && !value) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          // Find nearest stop to user location
          if (stops.length > 0) {
            let nearest = stops[0];
            let minDistance = Infinity;
            
            stops.forEach(stop => {
              const coords = stop.coordinates;
              let stopLat, stopLng;
              if (typeof coords === 'object') {
                stopLat = coords.y;
                stopLng = coords.x;
              } else {
                const match = coords.match(/\(([^,]+),([^)]+)\)/);
                if (match) {
                  stopLat = parseFloat(match[2]);
                  stopLng = parseFloat(match[1]);
                }
              }
              
              const distance = Math.sqrt(
                Math.pow(stopLat - latitude, 2) + Math.pow(stopLng - longitude, 2)
              );
              
              if (distance < minDistance) {
                minDistance = distance;
                nearest = stop;
              }
            });
            
            onChange?.(nearest);
          }
        },
        (error) => {
          console.log('Location access denied');
        }
      );
    }
  }, [type, onChange, stops]);

  const handleInputChange = (e) => {
    const input = e.target.value;
    onChange?.({ ...value, search: input });
    
    if (input.length > 0) {
      const filtered = stops.filter(stop =>
        stop.common_name.toLowerCase().includes(input.toLowerCase())
      );
      setFilteredStops(filtered.slice(0, 8)); // Limit to 8 results
      setShowDropdown(true);
    } else {
      setFilteredStops([]);
      setShowDropdown(false);
    }
  };

  const handleSelectStop = (stop) => {
    onChange?.(stop);
    setShowDropdown(false);
  };

  const displayValue = value?.common_name || value?.search || '';

  return (
    <div className="search-bar-wrapper">
      <div className="search-bar">
        <input
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={() => displayValue.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          className="search-input"
          autoComplete="off"
        />
        {showDropdown && filteredStops.length > 0 && (
          <div className="search-dropdown">
            {filteredStops.map((stop) => (
              <div
                key={stop.atco_code}
                className="dropdown-item"
                onClick={() => handleSelectStop(stop)}
              >
                <div className="stop-name">{stop.common_name}</div>
                <div className="stop-code">{stop.atco_code}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchBar;
