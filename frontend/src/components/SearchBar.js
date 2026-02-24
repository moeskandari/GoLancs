import React, { useState, useRef, useEffect } from 'react';
import './SearchBar.css';

function SearchBar({ placeholder, type, value, onChange, stops = [] }) {
  const [inputText, setInputText] = useState('');
  const [filteredStops, setFilteredStops] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const wrapperRef = useRef(null);

  // Sync display text when value changes externally (e.g. swap button)
  useEffect(() => {
    if (value?.common_name) {
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
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e) => {
    const input = e.target.value;
    setInputText(input);
    setIsSelected(false);

    // Clear the selected stop so user can pick a new one
    if (value?.common_name) {
      onChange?.(null);
    }

    if (input.length >= 2) {
      const query = input.toLowerCase();
      const filtered = stops.filter(stop =>
        stop.common_name.toLowerCase().includes(query)
      );
      // Sort: exact start match first, then alphabetical
      filtered.sort((a, b) => {
        const aStarts = a.common_name.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.common_name.toLowerCase().startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.common_name.localeCompare(b.common_name);
      });
      setFilteredStops(filtered.slice(0, 10));
      setShowDropdown(true);
    } else {
      setFilteredStops([]);
      setShowDropdown(false);
    }
  };

  const handleSelectStop = (stop) => {
    onChange?.(stop);
    setInputText(stop.common_name);
    setIsSelected(true);
    setShowDropdown(false);
  };

  const handleClear = () => {
    setInputText('');
    setIsSelected(false);
    setFilteredStops([]);
    setShowDropdown(false);
    onChange?.(null);
  };

  const handleFocus = () => {
    // If there's text but no stop selected, re-filter
    if (inputText.length >= 2 && !isSelected) {
      const query = inputText.toLowerCase();
      const filtered = stops.filter(stop =>
        stop.common_name.toLowerCase().includes(query)
      );
      filtered.sort((a, b) => {
        const aStarts = a.common_name.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.common_name.toLowerCase().startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.common_name.localeCompare(b.common_name);
      });
      setFilteredStops(filtered.slice(0, 10));
      setShowDropdown(true);
    }
  };

  return (
    <div className="search-bar-wrapper" ref={wrapperRef}>
      <div className="search-bar">
        <input
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onFocus={handleFocus}
          placeholder={placeholder}
          className={`search-input ${isSelected ? 'selected' : ''}`}
          autoComplete="off"
        />
        {inputText && (
          <button
            className="clear-btn"
            onClick={handleClear}
            aria-label="Clear"
            type="button"
          >
            ✕
          </button>
        )}
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
