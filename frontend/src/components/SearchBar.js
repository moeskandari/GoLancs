import React, { useState, useEffect } from 'react';
import './SearchBar.css';

function SearchBar({ placeholder, type }) {
  const [value, setValue] = useState('');
  
  useEffect(() => {
    // If this is the start location search bar, try to get user location
    if (type === 'start' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          // In a real app, we would reverse geocode this to get an address
          setValue(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        },
        (error) => {
          console.log('Location access denied');
        }
      );
    }
  }, [type]);

  return (
    <div className="search-bar">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="search-input"
      />
    </div>
  );
}

export default SearchBar;
