/**
 * Geocoding and search routes.
 *
 *   GET /api/geocode         – forward geocode (place name → lat/lon)
 *   GET /api/reverse-geocode – reverse geocode (lat/lon → place name)
 *   GET /api/reverse         – alias for reverse-geocode
 *   GET /api/search          – combined stop + place search
 */

const { Router } = require('express');
const pool = require('../db/pool');
const { haversineDistance } = require('../utils/geo');

const router = Router();

/**
 * Reverse geocode: lat/lon → place name via Nominatim.
 */
async function handleReverseGeocode(lat, lon) {
  if (!lat || !lon) return { name: 'My Location' };
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'LancasterTravelRoutes/1.0' },
      signal: AbortSignal.timeout(3000)
    });
    const data = await response.json();
    if (data.address) {
      const a = data.address;
      const name = a.road || a.pedestrian || a.building || a.amenity ||
                   a.suburb || a.neighbourhood || a.town || a.city || a.village || 'My Location';
      return { name, fullAddress: data.display_name };
    }
    return { name: 'My Location' };
  } catch {
    return { name: 'My Location' };
  }
}

// GET /api/geocode – forward geocode
router.get('/api/geocode', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&viewbox=-3.1,54.2,-2.5,53.5&bounded=1&limit=5`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'LancasterTravelRoutes/1.0' },
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    res.json(data.map(item => ({
      name: item.display_name,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      type: item.type
    })));
  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// GET /api/reverse-geocode
router.get('/api/reverse-geocode', async (req, res) => {
  const result = await handleReverseGeocode(req.query.lat, req.query.lon);
  res.json(result);
});

// GET /api/reverse (alias)
router.get('/api/reverse', async (req, res) => {
  const result = await handleReverseGeocode(req.query.lat, req.query.lon);
  res.json(result);
});

// GET /api/search – combined stop + place search
router.get('/api/search', async (req, res) => {
  try {
    const { q, lat, lon } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter q is required' });

    const searchTerm = q.trim();
    const userLat = lat ? parseFloat(lat) : null;
    const userLon = lon ? parseFloat(lon) : null;

    // Search stops in DB
    const stopResult = await pool.query(`
      SELECT atco_code, common_name, coordinates[0] as lon, coordinates[1] as lat,
             stop_type, CASE WHEN atco_code LIKE '9100%' THEN 'rail' ELSE 'bus' END as mode
      FROM stops
      WHERE LOWER(common_name) LIKE LOWER($1)
        AND coordinates IS NOT NULL
      ORDER BY common_name
      LIMIT 20
    `, [`%${searchTerm}%`]);

    let stops = stopResult.rows.map(s => ({
      type: 'stop',
      id: s.atco_code,
      name: s.common_name,
      lat: parseFloat(s.lat),
      lon: parseFloat(s.lon),
      mode: s.mode,
      distance: userLat && userLon
        ? haversineDistance(userLat, userLon, parseFloat(s.lat), parseFloat(s.lon))
        : null
    }));

    // If user location available, sort stops by distance
    if (userLat && userLon) {
      stops.sort((a, b) => (a.distance || 999) - (b.distance || 999));
    }

    // Also search Nominatim for places
    let places = [];
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchTerm)}&viewbox=-3.1,54.2,-2.5,53.5&bounded=1&limit=5`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'LancasterTravelRoutes/1.0' },
        signal: AbortSignal.timeout(3000)
      });
      const data = await response.json();
      places = data.map(item => ({
        type: 'place',
        name: item.display_name.split(',').slice(0, 2).join(','),
        fullName: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        placeType: item.type,
        distance: userLat && userLon
          ? haversineDistance(userLat, userLon, parseFloat(item.lat), parseFloat(item.lon))
          : null
      }));
    } catch {
      // Nominatim timeout/error — just return stops
    }

    res.json({
      stops: stops.slice(0, 10),
      places: places
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
