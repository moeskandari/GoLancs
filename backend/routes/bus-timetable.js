/**
 * Bus timetable routes.
 *
 *   GET /api/bus/departures/:atco    – departures from a stop
 *   GET /api/bus/journey/:journeyId  – full journey details
 *   GET /api/routes                  – search routes between stops
 *   GET /api/transport               – placeholder
 */

const { Router } = require('express');
const pool = require('../db/pool');
const { expandStopCode } = require('../utils/stop-utils');
const { haversineDistance } = require('../utils/geo');

const router = Router();

// GET /api/bus/departures/:atco
router.get('/api/bus/departures/:atco', async (req, res) => {
  try {
    const { atco } = req.params;
    const { day, from, limit } = req.query;

    const dayOfWeek = day !== undefined ? parseInt(day) : (new Date().getDay() + 6) % 7;
    const dayPosition = dayOfWeek + 1;
    const fromTime = from || '00:00:00';
    const maxResults = Math.min(parseInt(limit) || 20, 50);

    const expandedStops = await expandStopCode(atco);
    const atcoCodes = expandedStops.length > 0 ? expandedStops : [atco];
    const placeholders = atcoCodes.map((_, i) => `$${i + 1}`).join(',');

    const result = await pool.query(`
      SELECT bjs.departure_time, bjs.arrival_time, bjs.atco_code,
             s.common_name as stop_name,
             bj.journey_id, bj.route_number, bj.operator_code, bj.direction,
             bj.days_of_week, bj.valid_from, bj.valid_until,
             o.name as operator_name, bj.route_id
      FROM bus_journey_stops bjs
      JOIN bus_journeys bj ON bjs.journey_id = bj.journey_id
      JOIN stops s ON bjs.atco_code = s.atco_code
      LEFT JOIN operators o ON bj.operator_code = o.operator_code
      WHERE bjs.atco_code IN (${placeholders})
        AND SUBSTRING(bj.days_of_week FROM ${dayPosition} FOR 1) = '1'
        AND bjs.departure_time >= $${atcoCodes.length + 1}::time
      ORDER BY bjs.departure_time
      LIMIT $${atcoCodes.length + 2}
    `, [...atcoCodes, fromTime, maxResults]);

    const departures = [];
    for (const row of result.rows) {
      const destResult = await pool.query(`
        SELECT bjs.atco_code, s.common_name, bjs.arrival_time
        FROM bus_journey_stops bjs
        JOIN stops s ON bjs.atco_code = s.atco_code
        WHERE bjs.journey_id = $1
        ORDER BY bjs.stop_sequence DESC
        LIMIT 1
      `, [row.journey_id]);

      const dest = destResult.rows[0] || {};
      departures.push({
        departureTime: row.departure_time,
        routeNumber: row.route_number,
        operator: row.operator_code,
        operatorName: row.operator_name,
        direction: row.direction,
        stopName: row.stop_name,
        destination: {
          name: dest.common_name || 'Unknown',
          atco: dest.atco_code,
          arrivalTime: dest.arrival_time
        },
        journeyId: row.journey_id,
        routeId: row.route_id,
        mode: 'bus'
      });
    }

    res.json({
      stop: atco,
      expandedStops: atcoCodes,
      dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][dayOfWeek],
      from: fromTime,
      departures,
      totalDepartures: departures.length
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bus departures' });
  }
});

// GET /api/bus/journey/:journeyId
router.get('/api/bus/journey/:journeyId', async (req, res) => {
  try {
    const { journeyId } = req.params;

    const journeyResult = await pool.query(`
      SELECT bj.*, o.name as operator_name
      FROM bus_journeys bj
      LEFT JOIN operators o ON bj.operator_code = o.operator_code
      WHERE bj.journey_id = $1
    `, [journeyId]);

    if (journeyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Journey not found' });
    }

    const journey = journeyResult.rows[0];
    const stopsResult = await pool.query(`
      SELECT bjs.stop_sequence, bjs.atco_code, s.common_name, s.coordinates,
             bjs.arrival_time, bjs.departure_time, bjs.activity
      FROM bus_journey_stops bjs
      JOIN stops s ON bjs.atco_code = s.atco_code
      WHERE bjs.journey_id = $1
      ORDER BY bjs.stop_sequence
    `, [journeyId]);

    res.json({
      journeyId: journey.journey_id,
      routeNumber: journey.route_number,
      operator: journey.operator_code,
      operatorName: journey.operator_name,
      direction: journey.direction,
      departureTime: journey.departure_time,
      daysOfWeek: journey.days_of_week,
      validFrom: journey.valid_from,
      validUntil: journey.valid_until,
      mode: 'bus',
      stops: stopsResult.rows.map(s => ({
        sequence: s.stop_sequence, atco: s.atco_code, name: s.common_name,
        coordinates: s.coordinates, arrival: s.arrival_time,
        departure: s.departure_time, activity: s.activity
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch journey details' });
  }
});

// GET /api/routes – legacy route search
router.get('/api/routes', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end stop codes are required' });
    }

    const startCodes = await expandStopCode(start);
    const endCodes = await expandStopCode(end);
    const sPlaceholders = startCodes.map((_, i) => `$${i + 1}`).join(',');
    const ePlaceholders = endCodes.map((_, i) => `$${startCodes.length + i + 1}`).join(',');

    const result = await pool.query(`
      SELECT DISTINCT bj.journey_id, bj.route_number, bj.operator_code, o.name as operator_name,
             bjs1.departure_time as board_time, s1.common_name as board_name,
             bjs2.arrival_time as alight_time, s2.common_name as alight_name,
             bjs2.stop_sequence - bjs1.stop_sequence as num_stops, 'bus' as mode
      FROM bus_journey_stops bjs1
      JOIN bus_journeys bj ON bjs1.journey_id = bj.journey_id
      JOIN bus_journey_stops bjs2 ON bj.journey_id = bjs2.journey_id AND bjs2.stop_sequence > bjs1.stop_sequence
      JOIN stops s1 ON bjs1.atco_code = s1.atco_code
      JOIN stops s2 ON bjs2.atco_code = s2.atco_code
      LEFT JOIN operators o ON bj.operator_code = o.operator_code
      WHERE bjs1.atco_code IN (${sPlaceholders})
        AND bjs2.atco_code IN (${ePlaceholders})
      ORDER BY bjs1.departure_time
      LIMIT 20
    `, [...startCodes, ...endCodes]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch routes' });
  }
});

// GET /api/transport – placeholder
router.get('/api/transport', (req, res) => {
  res.json({
    message: 'Transport data endpoint',
    modes: ['bus', 'rail', 'walk'],
    description: 'Use /api/plan for multi-modal journey planning'
  });
});

module.exports = router;
