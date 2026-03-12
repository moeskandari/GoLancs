/**
 * Nearby-stop finder service.
 *
 * Exports:
 *   findNearbyRailStations(atcoCode, maxDistanceKm)
 *   findNearbyBusStops(atcoCode, maxDistanceKm)
 *   findBusReachableRailStations(atcoCode, dayIndex, departureTime, limit)
 */

const pool = require('../db/pool');
const { haversineDistance } = require('../utils/geo');
const { expandStopCode } = require('../utils/stop-utils');

/**
 * Find rail stations within walking distance of a given stop.
 * Returns array of { atco_code, tiploc_code, common_name, walk_minutes, walk_km, lat, lon }.
 */
async function findNearbyRailStations(atcoCode, maxDistanceKm = 3.0) {
  try {
    const stopResult = await pool.query(
      'SELECT coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code = $1',
      [atcoCode]
    );
    if (stopResult.rows.length === 0) return [];
    const { lat, lon } = stopResult.rows[0];

    const degDelta = maxDistanceKm / 111.0;
    const railResult = await pool.query(`
      SELECT s.atco_code, nr.tiploc_code, s.common_name,
             s.coordinates[0] as lon, s.coordinates[1] as lat
      FROM stops s
      JOIN national_rail nr ON s.atco_code = nr.atco_code
      WHERE s.coordinates IS NOT NULL
        AND ABS(s.coordinates[0] - $1) < $3
        AND ABS(s.coordinates[1] - $2) < $3
    `, [lon, lat, degDelta]);

    return railResult.rows
      .map(r => {
        const dist = haversineDistance(parseFloat(lat), parseFloat(lon), parseFloat(r.lat), parseFloat(r.lon));
        return {
          atco_code: r.atco_code,
          tiploc_code: r.tiploc_code,
          common_name: r.common_name,
          walk_km: Math.round(dist * 1000) / 1000,
          walk_minutes: Math.ceil(dist / 0.08),
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon)
        };
      })
      .filter(s => s.walk_km <= maxDistanceKm)
      .sort((a, b) => a.walk_km - b.walk_km);
  } catch {
    return [];
  }
}

/**
 * Find bus stops within walking distance of a given stop.
 * Returns array of { atco_code, common_name, walk_minutes, walk_km, lat, lon }.
 */
async function findNearbyBusStops(atcoCode, maxDistanceKm = 1.0) {
  try {
    const stopResult = await pool.query(
      'SELECT coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code = $1',
      [atcoCode]
    );
    if (stopResult.rows.length === 0) return [];
    const { lat, lon } = stopResult.rows[0];

    const degDelta = maxDistanceKm / 111.0;
    const busResult = await pool.query(`
      SELECT s.atco_code, s.common_name,
             s.coordinates[0] as lon, s.coordinates[1] as lat
      FROM stops s
      WHERE s.coordinates IS NOT NULL
        AND s.atco_code != $1
        AND s.atco_code NOT LIKE '9100%'
        AND ABS(s.coordinates[0] - $2) < $4
        AND ABS(s.coordinates[1] - $3) < $4
        AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
    `, [atcoCode, lon, lat, degDelta]);

    const expanded = await expandStopCode(atcoCode);

    return busResult.rows
      .filter(r => !expanded.includes(r.atco_code))
      .map(r => {
        const dist = haversineDistance(parseFloat(lat), parseFloat(lon), parseFloat(r.lat), parseFloat(r.lon));
        return {
          atco_code: r.atco_code,
          common_name: r.common_name,
          walk_km: Math.round(dist * 1000) / 1000,
          walk_minutes: Math.ceil(dist / 0.08),
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon)
        };
      })
      .filter(s => s.walk_km <= maxDistanceKm)
      .sort((a, b) => a.walk_km - b.walk_km);
  } catch {
    return [];
  }
}

/**
 * Find rail stations reachable by bus from a given stop.
 * Looks for bus routes that pass near rail stations.
 * Returns array of { atco_code, tiploc_code, common_name, bus_stop_atco, bus_stop_name, ... }.
 */
async function findBusReachableRailStations(atcoCode, dayIndex, departureTime, limit = 5) {
  try {
    const startCodes = await expandStopCode(atcoCode);
    const dayPos = dayIndex + 1;
    const placeholders = startCodes.map((_, i) => `$${i + 1}`).join(',');

    // Use a dedicated client with statement_timeout — this join across
    // bus_journey_stops (491k rows) + national_rail is expensive
    const client = await pool.connect();
    try {
      await client.query('SET statement_timeout = 6000');
      const result = await client.query(`
        SELECT DISTINCT ON (nr.tiploc_code)
          s_rail.atco_code, nr.tiploc_code, nr.crs_code, s_rail.common_name,
          s_bus.atco_code as bus_stop_atco, s_bus.common_name as bus_stop_name,
          s_rail.coordinates[0] as rail_lon, s_rail.coordinates[1] as rail_lat,
          s_bus.coordinates[0] as bus_lon, s_bus.coordinates[1] as bus_lat
        FROM bus_journey_stops bjs_start
        JOIN bus_journeys bj ON bjs_start.journey_id = bj.journey_id
        JOIN bus_journey_stops bjs_end ON bj.journey_id = bjs_end.journey_id
          AND bjs_end.stop_sequence > bjs_start.stop_sequence
        JOIN stops s_bus ON bjs_end.atco_code = s_bus.atco_code
        JOIN stops s_rail ON s_rail.atco_code LIKE '9100%'
          AND s_rail.coordinates IS NOT NULL
          AND ABS(s_rail.coordinates[0] - s_bus.coordinates[0]) < 0.01
          AND ABS(s_rail.coordinates[1] - s_bus.coordinates[1]) < 0.01
        JOIN national_rail nr ON s_rail.atco_code = nr.atco_code
        WHERE bjs_start.atco_code IN (${placeholders})
          AND SUBSTRING(bj.days_of_week FROM ${dayPos} FOR 1) = '1'
          AND bjs_start.departure_time >= $${startCodes.length + 1}::time
        ORDER BY nr.tiploc_code, bjs_end.arrival_time
        LIMIT $${startCodes.length + 2}
      `, [...startCodes, departureTime, limit]);

      console.log(`[findBusReachableRailStations] atco=${atcoCode} expandedTo=${startCodes.length} found=${result.rows.length} tiplocs=${result.rows.map(r => r.tiploc_code).join(',')}`);
      
      return result.rows.map(r => ({
        atco_code: r.atco_code,
        tiploc_code: r.tiploc_code,
        crs_code: r.crs_code,
        common_name: r.common_name,
        bus_stop_atco: r.bus_stop_atco,
        bus_stop_name: r.bus_stop_name,
        lat: parseFloat(r.rail_lat),
        lon: parseFloat(r.rail_lon)
      }));
    } catch (err) {
      console.warn('[PERF] findBusReachableRailStations timed out or failed:', err.message);
      return [];
    } finally {
      await client.query('RESET statement_timeout').catch(() => {});
      client.release();
    }
  } catch {
    return [];
  }
}

module.exports = { findNearbyRailStations, findNearbyBusStops, findBusReachableRailStations };
