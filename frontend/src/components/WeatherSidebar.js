import React from 'react';
import './WeatherSidebar.css';

const weatherEmojis = {
  '01d': '☀️', '01n': '🌙',
  '02d': '⛅', '02n': '☁️',
  '03d': '☁️', '03n': '☁️',
  '04d': '☁️', '04n': '☁️',
  '09d': '🌧️', '09n': '🌧️',
  '10d': '🌦️', '10n': '🌧️',
  '11d': '⛈️', '11n': '⛈️',
  '13d': '🌨️', '13n': '🌨️',
  '50d': '🌫️', '50n': '🌫️',
};

/**
 * Generates a travel recommendation based on weather conditions at both locations.
 */
function getWeatherRecommendation(currentWeather, destWeather) {
  const tips = [];
  const worst = destWeather || currentWeather;
  if (!worst) return { mode: null, tips: ['Weather data unavailable.'] };

  // Check the weather we'll be travelling through
  const check = destWeather && currentWeather
    ? (currentWeather.rain_1h > (destWeather.rain_1h || 0) ? currentWeather : worst)
    : worst;

  const isRainy = check.main === 'Rain' || check.main === 'Drizzle' || check.rain_1h > 0.5;
  const isStormy = check.main === 'Thunderstorm';
  const isSnowy = check.main === 'Snow' || check.snow_1h > 0;
  const isWindy = check.wind_speed > 40;
  const isFoggy = check.main === 'Mist' || check.main === 'Fog' || check.main === 'Haze' || (check.visibility !== null && check.visibility < 2);
  const isCold = check.feels_like < 3;
  const isNice = check.main === 'Clear' || (check.main === 'Clouds' && check.temp >= 10 && check.temp <= 22 && !isWindy);

  // Determine recommended travel mode
  let mode = 'bus'; // default recommendation

  if (isStormy) {
    mode = 'train';
    tips.push('⛈️ Thunderstorms detected — trains are the safest option.');
    tips.push('Avoid waiting at exposed bus stops if possible.');
  } else if (isSnowy) {
    mode = 'train';
    tips.push('🌨️ Snow is falling — roads may be slippery. Train is recommended.');
    tips.push('Wrap up warm and allow extra time for your journey.');
  } else if (isRainy && isWindy) {
    mode = 'train';
    tips.push('🌧️💨 Heavy rain and strong winds — minimise time outdoors.');
    tips.push('Take the train to reduce walking between stops.');
  } else if (isRainy) {
    mode = 'bus';
    tips.push('🌧️ Rain expected — bring an umbrella or waterproof jacket.');
    tips.push('Bus stops with shelters are your friend today.');
  } else if (isWindy) {
    mode = 'bus';
    tips.push('💨 Strong winds — take care near the coast.');
    tips.push('Consider a bus route for more sheltered travel.');
  } else if (isFoggy) {
    mode = 'bus';
    tips.push('🌫️ Low visibility due to fog — services may run slower.');
    tips.push('Allow extra journey time and stay visible.');
  } else if (isCold) {
    mode = 'bus';
    tips.push('🥶 It feels below freezing — dress in warm layers.');
    tips.push('Minimise time waiting outdoors where possible.');
  } else if (isNice) {
    mode = 'walk';
    tips.push('☀️ Beautiful weather for walking — enjoy the fresh air!');
    tips.push('Consider walking shorter distances instead of waiting for transport.');
  } else {
    tips.push('Conditions are fair — all transport modes are fine.');
  }

  // Extra tips for destination
  if (destWeather && currentWeather) {
    const tempDiff = destWeather.temp - currentWeather.temp;
    if (Math.abs(tempDiff) >= 3) {
      tips.push(
        tempDiff > 0
          ? `📈 It\'s ${Math.abs(tempDiff)}°C warmer at your destination.`
          : `📉 It\'s ${Math.abs(tempDiff)}°C cooler at your destination — bring an extra layer.`
      );
    }
  }

  return { mode, tips };
}

function WeatherCard({ title, weather, loading }) {
  if (loading) {
    return (
      <div className="weather-card weather-card-loading">
        <h3>{title}</h3>
        <div className="weather-card-skeleton">
          <div className="skeleton-line wide" />
          <div className="skeleton-line" />
          <div className="skeleton-line narrow" />
        </div>
      </div>
    );
  }

  if (!weather) {
    return (
      <div className="weather-card weather-card-empty">
        <h3>{title}</h3>
        <p className="weather-no-data">No weather data available</p>
      </div>
    );
  }

  const emoji = weatherEmojis[weather.icon] || '🌡️';

  return (
    <div className="weather-card">
      <h3>{title}</h3>
      <div className="weather-card-header">
        <span className="weather-card-emoji">{emoji}</span>
        <div className="weather-card-main">
          <span className="weather-card-temp">{weather.temp}°C</span>
          <span className="weather-card-desc">{weather.description}</span>
        </div>
      </div>
      {weather.location_name && (
        <div className="weather-card-location">📍 {weather.location_name}</div>
      )}
      <div className="weather-card-details">
        <div className="weather-detail">
          <span className="detail-label">Feels like</span>
          <span className="detail-value">{weather.feels_like}°C</span>
        </div>
        <div className="weather-detail">
          <span className="detail-label">Wind</span>
          <span className="detail-value">{weather.wind_speed} km/h</span>
        </div>
        <div className="weather-detail">
          <span className="detail-label">Humidity</span>
          <span className="detail-value">{weather.humidity}%</span>
        </div>
        {weather.visibility !== null && (
          <div className="weather-detail">
            <span className="detail-label">Visibility</span>
            <span className="detail-value">{weather.visibility} km</span>
          </div>
        )}
        {weather.rain_1h > 0 && (
          <div className="weather-detail">
            <span className="detail-label">Rain (1h)</span>
            <span className="detail-value">{weather.rain_1h} mm</span>
          </div>
        )}
        {weather.snow_1h > 0 && (
          <div className="weather-detail">
            <span className="detail-label">Snow (1h)</span>
            <span className="detail-value">{weather.snow_1h} mm</span>
          </div>
        )}
      </div>
    </div>
  );
}

const modeIcons = {
  walk: '🚶',
  bus: '🚌',
  train: '🚂',
};

const modeLabels = {
  walk: 'Walking',
  bus: 'Bus',
  train: 'Train',
};

function WeatherSidebar({ isOpen, onClose, currentWeather, destWeather, loadingCurrent, loadingDest, hasDestination }) {
  const recommendation = getWeatherRecommendation(currentWeather, destWeather);

  return (
    <>
      {/* Overlay backdrop */}
      <div className={`weather-sidebar-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />

      {/* Sidebar panel */}
      <div className={`weather-sidebar ${isOpen ? 'open' : ''}`}>
        <div className="weather-sidebar-header">
          <h2>🌤️ Weather</h2>
          <button className="weather-sidebar-close" onClick={onClose} aria-label="Close weather panel">✕</button>
        </div>

        <div className="weather-sidebar-content">
          <WeatherCard title="📍 Current Location" weather={currentWeather} loading={loadingCurrent} />

          {hasDestination ? (
            <WeatherCard title="🏁 Destination" weather={destWeather} loading={loadingDest} />
          ) : (
            <div className="weather-card weather-card-empty">
              <h3>🏁 Destination</h3>
              <p className="weather-no-data">Set a destination to see its weather</p>
            </div>
          )}

          {/* Recommendation section */}
          <div className="weather-recommendation">
            <h3>🧭 Travel Recommendation</h3>
            {recommendation.mode && (
              <div className="recommendation-mode">
                <span className="recommendation-mode-icon">{modeIcons[recommendation.mode]}</span>
                <span className="recommendation-mode-label">
                  Recommended: <strong>{modeLabels[recommendation.mode]}</strong>
                </span>
              </div>
            )}
            <ul className="recommendation-tips">
              {recommendation.tips.map((tip, i) => (
                <li key={i}>{tip}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

export default WeatherSidebar;
