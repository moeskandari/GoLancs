/**
 * Stop-related routes.
 *
 *   GET /api/stops         – list all stops (with optional search)
 *   GET /api/stops/nearby  – find stops near a lat/lon
 */

const { Router } = require('express');
const pool = require('../db/pool');
const { haversineDistance } = require('../utils/geo');

const router = Router();

// GET /api/stops – list all stops (optionally filter by search term)
router.get('/api/stops', async (req, res) => {
  try {
    const { search, limit = 50 } = req.query;
    let query, params;

    if (search) {
      query = `
        SELECT atco_code, common_name, coordinates[0] as lon, coordinates[1] as lat, stop_type
        FROM stops
        WHERE LOWER(common_name) LIKE LOWER($1)
          AND coordinates IS NOT NULL
        ORDER BY common_name
        LIMIT $2
      `;
      params = [`%${search}%`, parseInt(limit)];
    } else {
      query = `
        SELECT atco_code, common_name, coordinates[0] as lon, coordinates[1] as lat, stop_type
        FROM stops
        WHERE coordinates IS NOT NULL
        ORDER BY common_name
        LIMIT $1
      `;
      params = [parseInt(limit)];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching stops:', err);
    res.status(500).json({ error: 'Failed to fetch stops' });
  }
});

// GET /api/stops/nearby – find stops near coordinates
router.get('/api/stops/nearby', async (req, res) => {
  try {
    const { lat, lon, radius = 1.0 } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon query parameters are required' });
    }

    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const radiusKm = parseFloat(radius);
    const degDelta = radiusKm / 111.0;

    // Find bus stops
    const busResult = await pool.query(`
      SELECT atco_code, common_name, coordinates[0] as lon, coordinates[1] as lat, stop_type
      FROM stops
      WHERE coordinates IS NOT NULL
        AND atco_code NOT LIKE '9100%'
        AND ABS(coordinates[0] - $1) < $3
        AND ABS(coordinates[1] - $2) < $3
    `, [lonNum, latNum, degDelta]);

    // Find rail stations
    const railResult = await pool.query(`
      SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat, s.stop_type,
             nr.tiploc_code, nr.crs_code
      FROM stops s
      JOIN national_rail nr ON s.atco_code = nr.atco_code
      WHERE s.coordinates IS NOT NULL
        AND ABS(s.coordinates[0] - $1) < $3
        AND ABS(s.coordinates[1] - $2) < $3
    `, [lonNum, latNum, degDelta]);

    const allStops = [...busResult.rows, ...railResult.rows].map(s => ({
      ...s,
      distance_km: haversineDistance(latNum, lonNum, parseFloat(s.lat), parseFloat(s.lon))
    })).filter(s => s.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km);

    res.json(allStops);
  } catch (err) {
    console.error('Error fetching nearby stops:', err);
    res.status(500).json({ error: 'Failed to fetch nearby stops' });
  }
});

module.exports = router;
