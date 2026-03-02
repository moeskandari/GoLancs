/**
 * Centralised API service for the Lancaster Travel Routes frontend.
 *
 * All backend calls go through here, making it easy to change the
 * base URL, add auth headers, or swap to a different backend.
 */

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

/** Geocode free text to coordinates via the backend Nominatim proxy */
export async function geocodeText(text) {
  try {
    const res = await fetch(`${API_URL}/api/geocode?q=${encodeURIComponent(text)}`);
    const places = await res.json();
    if (places && places.length > 0) {
      return {
        type: 'place',
        name: places[0].name,
        common_name: places[0].name,
        lat: places[0].lat,
        lon: places[0].lon,
        category: places[0].category
      };
    }
  } catch (err) {
    console.error('Geocode failed:', err);
  }
  return null;
}

/** Reverse-geocode a lat/lon to a human-readable name */
export async function reverseGeocode(lat, lon) {
  const res = await fetch(`${API_URL}/api/reverse-geocode?lat=${lat}&lon=${lon}`);
  return res.json();
}

/** Reverse-geocode via /api/reverse (used by pin-drop) */
export async function reverseGeocodeFull(lat, lon) {
  const res = await fetch(`${API_URL}/api/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
  return res.json();
}

/** Fetch weather for a location */
export async function fetchWeather(lat, lon) {
  const res = await fetch(`${API_URL}/api/weather?lat=${lat}&lon=${lon}`);
  if (!res.ok) throw new Error('Weather API error');
  return res.json();
}

/** Plan a route between two locations */
export async function planRoute(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_URL}/api/plan?${qs}`);
  return res.json();
}

/** Get live bus positions for a route number */
export async function fetchLiveBusRoute(routeNumber) {
  const res = await fetch(`${API_URL}/api/bus/live/route/${encodeURIComponent(routeNumber)}`);
  if (!res.ok) throw new Error('Live bus API error');
  return res.json();
}

/** Get live rail departures for a station CRS code */
export async function fetchRailDepartures(crs) {
  const res = await fetch(`${API_URL}/api/rail/departures/${encodeURIComponent(crs)}`);
  if (!res.ok) throw new Error('Rail departures API error');
  return res.json();
}

/** Search for stops and places */
export async function search(query) {
  const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(query)}`);
  return res.json();
}

export { API_URL };
