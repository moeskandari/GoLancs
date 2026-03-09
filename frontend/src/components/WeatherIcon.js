
import './WeatherIcon.css';

/**
 * Maps weather icon codes (derived from WMO codes via Open-Meteo) to emoji symbols.
 */
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

function WeatherIcon({ weather, onClick, loading }) {
  const emoji = weather ? (weatherEmojis[weather.icon] || '🌡️') : '🌡️';

  return (
    <button
      className="weather-icon-container"
      onClick={onClick}
      title="View weather details"
      aria-label={weather ? `Weather: ${weather.temp}° — tap for details` : 'View weather details'}
      type="button"
    >
      <div className={`weather-icon-btn ${loading ? 'weather-loading' : ''}`}>
        <span className="weather-emoji">{emoji}</span>
        {weather && (
          <span className="weather-temp">{weather.temp}°</span>
        )}
        {loading && !weather && (
          <span className="weather-temp">…</span>
        )}
      </div>
    </button>
  );
}

export default WeatherIcon;
