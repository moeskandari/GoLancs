import React, { useState } from 'react';
import './FilterPage.css';

/**
 * Default filter state – every option starts as false (not selected).
 * Structured into the three required categories.
 */
const DEFAULT_FILTERS = {
  onMap: {
    showBusStops: false,
    showTrainStations: false,
    showTrafficConditions: false,
  },
  direction: {
    includeWalking: false,
    includeDriving: false,
    includeBusses: false,
    includeTrains: false,
  },
  routeSuggestions: {
    fastestRoute: false,
    leastTraffic: false,
    cheapestRoute: false,
    leastChanges: false,
  },
};

/**
 * Human-readable labels for every filter key.
 */
const LABELS = {
  showBusStops: 'Show Bus Stops',
  showTrainStations: 'Show Train Stations',
  showTrafficConditions: 'Show Traffic Conditions',
  includeWalking: 'Include Walking',
  includeDriving: 'Include Driving',
  includeBusses: 'Include Busses',
  includeTrains: 'Include Trains',
  fastestRoute: 'Fastest Route',
  leastTraffic: 'Least Traffic',
  cheapestRoute: 'Cheapest Route',
  leastChanges: 'Least Changes',
};

/**
 * FilterPage component – full-screen overlay page where the user can
 * toggle filter options across three categories, then submit them.
 *
 * Props:
 *   initialFilters – optional object matching DEFAULT_FILTERS shape to
 *                    pre-populate previously selected filters
 *   onBack         – callback to navigate back to the home / map page
 *   onSubmit       – callback receiving the selected filters object;
 *                    will be connected to the backend later
 */
function FilterPage({ initialFilters, onBack, onSubmit }) {
  const [filters, setFilters] = useState(initialFilters || DEFAULT_FILTERS);

  /**
   * Toggle a single filter option within a category.
   * @param {string} category  – 'onMap' | 'direction' | 'routeSuggestions'
   * @param {string} key       – filter key inside that category
   */
  const toggle = (category, key) => {
    setFilters((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: !prev[category][key],
      },
    }));
  };

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit(filters);
    }
  };

  /**
   * Renders a group of toggle buttons for one filter category.
   */
  const renderCategory = (title, categoryKey) => (
    <div className="filter-category" key={categoryKey}>
      <h3 className="filter-category-title">{title}</h3>
      <div className="filter-options">
        {Object.keys(filters[categoryKey]).map((key) => (
          <button
            key={key}
            type="button"
            className={`filter-option-btn${filters[categoryKey][key] ? ' selected' : ''}`}
            onClick={() => toggle(categoryKey, key)}
            aria-pressed={filters[categoryKey][key]}
          >
            <span className="filter-option-indicator">
              {filters[categoryKey][key] ? '✓' : ''}
            </span>
            <span className="filter-option-label">{LABELS[key]}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="filter-page" role="main" aria-label="Filter Options">
      {/* ---- Top bar ---- */}
      <div className="filter-top-bar">
        <button
          className="filter-back-btn"
          onClick={onBack}
          aria-label="Back to map"
          title="Back"
        >
          ← Back
        </button>
        <h2 className="filter-page-title">Filters</h2>
        {/* Spacer to keep title centered */}
        <div className="filter-top-spacer" />
      </div>

      {/* ---- Filter categories ---- */}
      <div className="filter-body">
        {renderCategory('On Map', 'onMap')}
        {renderCategory('Direction', 'direction')}
        {renderCategory('Route Suggestions', 'routeSuggestions')}
      </div>

      {/* ---- Submit bar ---- */}
      <div className="filter-submit-bar">
        <button
          className="filter-submit-btn"
          onClick={handleSubmit}
          type="button"
        >
          Apply Filters
        </button>
      </div>
    </div>
  );
}

export default FilterPage;
