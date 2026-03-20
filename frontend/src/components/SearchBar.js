import { useState, useRef, useEffect, useCallback } from 'react';
import './SearchBar.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function SearchBar({ placeholder, type, value, onChange, onUseMyLocation, hasUserLocation }) {
  const [inputText, setInputText] = useState('');
  const [results, setResults] = useState({ stops: [], places: [] });
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);

  // Sync display text when value changes externally (e.g. swap button)
  useEffect(() => {
    if (value?.type === 'text') {
      // Don't overwrite — this came from our own typing
      return;
    }
    if (value?.name) {
      setInputText(value.name);
      setIsSelected(true);
    } else if (value?.common_name) {
      setInputText(value.common_name);
      setIsSelected(true);
    } else if (!value) {
      setInputText('');
      setIsSelected(false);
    }
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    // Listen for both mouse and touch events so mobile taps outside also close the dropdown
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Debounced search function
  const searchLocations = useCallback(async (query) => {
    if (query.length < 2) {
      setResults({ stops: [], places: [] });
      setShowDropdown(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults({
        stops: data.stops || [],
        places: data.places || []
      });
      setShowDropdown(true);
    } catch (err) {
      console.error('Search failed:', err);
      setResults({ stops: [], places: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e) => {
    const input = e.target.value;
    setInputText(input);
    setIsSelected(false);

    // Always pass the typed text up so App.js knows what's in the box
    // This allows findRoutes to geocode it if the user doesn't pick from dropdown
    const trimmed = input.trim();
    if (trimmed.length >= 2) {
      onChange?.({ type: 'text', text: trimmed });
    } else {
      onChange?.(null);
    }

    // Debounce the dropdown search (300ms)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchLocations(input), 300);
  };

  const handleSelectStop = (stop) => {
    onChange?.({
      type: 'stop',
      atco_code: stop.atco_code,
      name: stop.name,
      common_name: stop.name,
      lat: stop.lat,
      lon: stop.lon,
      stop_type: stop.stop_type
    });
    setInputText(stop.name);
    setIsSelected(true);
    setShowDropdown(false);
  };

  const handleSelectPlace = (place) => {
    onChange?.({
      type: 'place',
      name: place.name,
      common_name: place.name,
      lat: place.lat,
      lon: place.lon,
      category: place.category
    });
    setInputText(place.name);
    setIsSelected(true);
    setShowDropdown(false);
  };

  const handleClear = () => {
    setInputText('');
    setIsSelected(false);
    setResults({ stops: [], places: [] });
    setShowDropdown(false);
    onChange?.(null);
  };

  const handleUseLocation = () => {
    onUseMyLocation?.();
    setShowDropdown(false);
  };

  const handleFocus = () => {
    // Show dropdown with "Use My Location" even when input is empty
    if (onUseMyLocation && hasUserLocation && !isSelected && inputText.length < 2) {
      setShowDropdown(true);
    } else if (inputText.length >= 2 && !isSelected) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => searchLocations(inputText), 100);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setShowDropdown(false);
    }
  };

  const hasResults = results.stops.length > 0 || results.places.length > 0;

  const getStopIcon = (stopType) => {
    return stopType === 'rail' ? '🚂' : '🚌';
  };

  const getCategoryIcon = (category) => {
    const icons = {
      school: '🏫', university: '🎓', college: '🎓',
      hospital: '🏥', clinic: '🏥',
      restaurant: '🍽️', cafe: '☕', pub: '🍺',
      supermarket: '🛒', shop: '🛍️',
      park: '🌳', garden: '🌳',
      church: '⛪', library: '📚', cinema: '🎬',
      hotel: '🏨', museum: '🏛️',
      city: '🏙️', town: '🏘️', village: '🏘️',
      suburb: '🏘️', neighbourhood: '🏘️', residential: '🏘️',
    };
    return icons[category] || '📍';
  };

  return (
    <div className="search-bar-wrapper" ref={wrapperRef}>
      <label className="sr-only" htmlFor={`search-input-${type}`}>{placeholder}</label>
      <div className="search-bar">
        <input
          id={`search-input-${type}`}
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={`search-input ${isSelected ? 'selected' : ''}`}
          autoComplete="off"
          role="combobox"
          aria-controls={`search-listbox-${type}`}
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-label={placeholder}
        />
        {loading && <span className="search-loading" aria-hidden="true">⏳</span>}
        {inputText && !loading && (
          <button
            className="clear-btn"
            onClick={handleClear}
            aria-label="Clear"
            type="button"
          >
            ✕
          </button>
        )}
        {showDropdown && (hasResults || (onUseMyLocation && hasUserLocation)) && (
          <div className="search-dropdown" role="listbox" id={`search-listbox-${type}`}>
            {onUseMyLocation && hasUserLocation && (
              <div
                className="dropdown-item my-location-item"
                onClick={handleUseLocation}
                role="option"
                aria-selected="false"
              >
                <span className="item-icon my-location-icon-circle">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
                  </svg>
                </span>
                <div className="item-content">
                  <div className="item-name my-location-text">Use my current location</div>
                </div>
              </div>
            )}
            {results.stops.length > 0 && (
              <>
                <div className="dropdown-section-header">
                  <span className="section-icon">🚏</span> Stops & Stations
                </div>
                {results.stops.map((stop) => (
                  <div
                    key={stop.atco_code}
                    className="dropdown-item stop-item"
                    onClick={() => handleSelectStop(stop)}
                    role="option"
                    aria-selected="false"
                  >
                    <span className="item-icon">{getStopIcon(stop.stop_type)}</span>
                    <div className="item-content">
                      <div className="item-name">{stop.name}</div>
                      <div className="item-detail">
                        {stop.stop_type === 'rail' ? 'Rail Station' : 'Bus Stop'} · {stop.atco_code}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
            {results.places.length > 0 && (
              <>
                <div className="dropdown-section-header">
                  <span className="section-icon">📍</span> Places
                </div>
                {results.places.map((place, idx) => (
                  <div
                    key={`place-${idx}-${place.lat}-${place.lon}`}
                    className="dropdown-item place-item"
                    onClick={() => handleSelectPlace(place)}
                    role="option"
                    aria-selected="false"
                  >
                    <span className="item-icon">{getCategoryIcon(place.category)}</span>
                    <div className="item-content">
                      <div className="item-name">{place.name}</div>
                      <div className="item-detail">{place.category}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
        {showDropdown && !hasResults && !(onUseMyLocation && hasUserLocation) && inputText.length >= 2 && !loading && (
          <div className="search-dropdown" role="status" aria-live="polite" id={`search-listbox-${type}`}>
            <div className="dropdown-empty">
              No results found for "{inputText}"
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchBar;
