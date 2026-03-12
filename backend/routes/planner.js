/**
 * Multi-modal journey planner route.
 *
 *   GET /api/plan – plan a route between two locations
 *
 * Supports: bus, train, walk, multi-modal (bus+train, train+bus, bus→bus transfer).
 * Accepts ATCO codes, coordinates, or mixed inputs.
 *
 * This is the largest single route — it orchestrates 7 search strategies:
 *   1.  Direct bus
 *   1b. Direct bus from/to nearby walkable stops
 *   2b. Direct bus to/from bus stops near rail stations
 *   3.  Direct train
 *   4.  Train + Train connections
 *   5.  Bus → Train, Train → Bus, walk-based multi-modal
 *   6.  Bus → Bus transfer
 *   0.  Walk-only (for short distances)
 */

const { Router } = require('express');
const pool = require('../db/pool');
const { haversineDistance } = require('../utils/geo');
const { timeToMinutes, minutesToTime, getDayIndex, safeDuration } = require('../utils/time');
const { expandStopCode } = require('../utils/stop-utils');
const { findNearbyRailStations, findNearbyBusStops, findBusReachableRailStations } = require('../services/nearby');
const { findDirectBusJourneys, findDirectTrainJourneys, findTrainTrainConnections } = require('../services/journey-search');
const { enrichLegsWithCoordinates, enrichLegsWithGeometry, mergeConsecutiveWalkLegs } = require('../services/geometry');

const router = Router();

/** Average walking speed: ~4.8 km/h ≈ 0.08 km/min */
const WALKING_SPEED_KM_PER_MIN = 0.08;

/**
 * Geocode a plain-text location name to lat/lon via Nominatim.
 * Returns { lat, lon, name } or null.
 */
async function geocodeText(text) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}&viewbox=-3.1,54.2,-2.5,53.5&bounded=1&limit=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'LancasterTravelRoutes/1.0' },
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        name: data[0].display_name.split(',').slice(0, 2).join(',')
      };
    }
  } catch (err) {
    console.error('Geocode error for', text, err.message);
  }
  return null;
}

router.get('/api/plan', async (req, res) => {
  const REQUEST_TIMEOUT_MS = 30000;
  const abortController = new AbortController();
  const requestTimer = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    let { start, end, time, day, sort, startLat, startLon, endLat, endLon, startName, endName } = req.query;
    const _t0 = Date.now();
    const _timers = {};
    const _mark = (label) => { _timers[label] = Date.now() - _t0; };
    const _checkTimeout = () => { if (abortController.signal.aborted) throw new Error('Request timeout: route planning took too long'); };

    // ── Geocode plain text start/end if not ATCO codes or coords ──
    const isAtcoCode = (s) => /^(\d{3,}|9100)/.test(s);
    if (start && !isAtcoCode(start) && !startLat) {
      const geo = await geocodeText(start);
      if (geo) {
        startLat = String(geo.lat);
        startLon = String(geo.lon);
        startName = startName || geo.name;
        start = null;
      }
    }
    if (end && !isAtcoCode(end) && !endLat) {
      const geo = await geocodeText(end);
      if (geo) {
        endLat = String(geo.lat);
        endLon = String(geo.lon);
        endName = endName || geo.name;
        end = null;
      }
    }

    let resolvedStart = start || null;
    let resolvedEnd = end || null;
    let startWalkLeg = null;
    let endWalkLeg = null;
    let startPlaceName = startName || null;
    let endPlaceName = endName || null;
    let startPlaceCoords = null;
    let endPlaceCoords = null;

    // ── Resolve start from coordinates ──────────────────────────────
    if (!resolvedStart && startLat && startLon) {
      const sLat = parseFloat(startLat);
      const sLon = parseFloat(startLon);
      startPlaceCoords = { lat: sLat, lon: sLon };
      const degDelta = 3.0 / 111.0;

      const busNear = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s
        WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [sLon, sLat, degDelta]);

      const railNear = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s WHERE s.coordinates IS NOT NULL AND s.atco_code LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
      `, [sLon, sLat, degDelta]);

      const busWithDist = busNear.rows.map(r => ({
        ...r, dist: haversineDistance(sLat, sLon, parseFloat(r.lat), parseFloat(r.lon)), mode: 'bus'
      })).sort((a, b) => a.dist - b.dist);

      const railWithDist = railNear.rows.map(r => ({
        ...r, dist: haversineDistance(sLat, sLon, parseFloat(r.lat), parseFloat(r.lon)), mode: 'rail'
      })).sort((a, b) => a.dist - b.dist);

      let allNear;
      if (busWithDist.length > 0 && (busWithDist[0].dist <= 0.5 || railWithDist.length === 0 || busWithDist[0].dist <= railWithDist[0].dist)) {
        allNear = busWithDist;
      } else if (railWithDist.length > 0 && (busWithDist.length === 0 || railWithDist[0].dist < busWithDist[0].dist)) {
        allNear = [...railWithDist, ...busWithDist];
      } else {
        allNear = [...busWithDist, ...railWithDist].sort((a, b) => a.dist - b.dist);
      }

      if (allNear.length === 0) {
        return res.status(404).json({ error: 'No stops found near the start location. Try a location closer to a bus stop or rail station.' });
      }
      const nearest = allNear[0];
      resolvedStart = nearest.atco_code;

      if (nearest.dist > 0.05) {
        startWalkLeg = {
          type: 'walk',
          fromName: startPlaceName || 'Start location',
          toName: nearest.common_name,
          fromCoords: { lat: sLat, lon: sLon },
          toCoords: { lat: parseFloat(nearest.lat), lon: parseFloat(nearest.lon) },
          duration: Math.ceil(nearest.dist / WALKING_SPEED_KM_PER_MIN),
          distance_km: Math.round(nearest.dist * 1000) / 1000
        };
      }
    }

    // ── Resolve end from coordinates ────────────────────────────────
    if (!resolvedEnd && endLat && endLon) {
      const eLat = parseFloat(endLat);
      const eLon = parseFloat(endLon);
      endPlaceCoords = { lat: eLat, lon: eLon };
      const degDelta = 3.0 / 111.0;

      const busNear = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s
        WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [eLon, eLat, degDelta]);

      const railNear = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s WHERE s.coordinates IS NOT NULL AND s.atco_code LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
      `, [eLon, eLat, degDelta]);

      const busWithDist = busNear.rows.map(r => ({
        ...r, dist: haversineDistance(eLat, eLon, parseFloat(r.lat), parseFloat(r.lon)), mode: 'bus'
      })).sort((a, b) => a.dist - b.dist);

      const railWithDist = railNear.rows.map(r => ({
        ...r, dist: haversineDistance(eLat, eLon, parseFloat(r.lat), parseFloat(r.lon)), mode: 'rail'
      })).sort((a, b) => a.dist - b.dist);

      let allNear;
      if (busWithDist.length > 0 && (busWithDist[0].dist <= 0.5 || railWithDist.length === 0 || busWithDist[0].dist <= railWithDist[0].dist)) {
        allNear = busWithDist;
      } else if (railWithDist.length > 0 && (busWithDist.length === 0 || railWithDist[0].dist < busWithDist[0].dist)) {
        allNear = [...railWithDist, ...busWithDist];
      } else {
        allNear = [...busWithDist, ...railWithDist].sort((a, b) => a.dist - b.dist);
      }

      if (allNear.length === 0) {
        return res.status(404).json({ error: 'No stops found near the destination. Try a location closer to a bus stop or rail station.' });
      }
      const nearest = allNear[0];
      resolvedEnd = nearest.atco_code;

      if (nearest.dist > 0.05) {
        endWalkLeg = {
          type: 'walk',
          fromName: nearest.common_name,
          toName: endPlaceName || 'Destination',
          fromCoords: { lat: parseFloat(nearest.lat), lon: parseFloat(nearest.lon) },
          toCoords: { lat: eLat, lon: eLon },
          duration: Math.ceil(nearest.dist / WALKING_SPEED_KM_PER_MIN),
          distance_km: Math.round(nearest.dist * 1000) / 1000
        };
      }
    }

    if (!resolvedStart || !resolvedEnd) {
      return res.status(400).json({ error: 'Please provide start and end locations (ATCO codes or coordinates)' });
    }

    const departureTime = time || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}:00`;
    const dayIndex = getDayIndex(day);
    const sortBy = sort || 'departure';

    // ── Short-distance early exit ───────────────────────────────────
    const pinToPin = (startPlaceCoords && endPlaceCoords)
      ? haversineDistance(startPlaceCoords.lat, startPlaceCoords.lon, endPlaceCoords.lat, endPlaceCoords.lon)
      : null;

    if (pinToPin !== null && pinToPin < 0.8) {
      const walkMinutes = Math.max(1, Math.ceil(pinToPin / WALKING_SPEED_KM_PER_MIN));
      const depTime = departureTime;
      const arrTime = minutesToTime(timeToMinutes(depTime) + walkMinutes) + ':00';

      const walkRoute = {
        id: 'walk-only',
        summary: 'Walk',
        modes: ['walk'],
        departureTime: depTime,
        arrivalTime: arrTime,
        durationMinutes: walkMinutes,
        legs: [{
          type: 'walk',
          fromName: startPlaceName || 'Start location',
          toName: endPlaceName || 'Destination',
          fromCoords: { lat: startPlaceCoords.lat, lon: startPlaceCoords.lon },
          toCoords: { lat: endPlaceCoords.lat, lon: endPlaceCoords.lon },
          duration: walkMinutes,
          distance_km: Math.round(pinToPin * 1000) / 1000
        }]
      };

      await enrichLegsWithGeometry([walkRoute]);

      return res.json({
        start: { atco: resolvedStart, name: startPlaceName || 'Start location', coordinates: startPlaceCoords },
        end: { atco: resolvedEnd, name: endPlaceName || 'Destination', coordinates: endPlaceCoords },
        directDistance_km: Math.round(pinToPin * 100) / 100,
        departureTime: depTime,
        dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][dayIndex],
        sortedBy: sortBy,
        routes: [walkRoute],
        totalRoutes: 1,
        nearbyRailStations: { start: [], end: [] }
      });
    }

    // ── Get stop info ───────────────────────────────────────────────
    const stopInfo = await pool.query(
      `SELECT atco_code, common_name, coordinates[0] as lon, coordinates[1] as lat, stop_type
       FROM stops WHERE atco_code IN ($1, $2)`,
      [resolvedStart, resolvedEnd]
    );
    const startStop = stopInfo.rows.find(s => s.atco_code === resolvedStart);
    const endStop = stopInfo.rows.find(s => s.atco_code === resolvedEnd);

    if (!startStop || !endStop) {
      return res.status(404).json({ error: 'One or both resolved stops not found in database' });
    }

    const directDistance = haversineDistance(startStop.lat, startStop.lon, endStop.lat, endStop.lon);
    _mark('init');

    // === Strategy 1 & 2: Parallel searches ===
    // Scale limits based on direct distance – longer journeys need more results
    const busLimit = directDistance > 10 ? 10 : 5;
    const nearbyRadius = directDistance > 10 ? 1.5 : 1.0;
    const [directBus, startRailStations, endRailStations, nearbyStartStops, nearbyEndStops] = await Promise.all([
      findDirectBusJourneys(resolvedStart, resolvedEnd, departureTime, dayIndex, busLimit),
      findNearbyRailStations(resolvedStart, 5.0),
      findNearbyRailStations(resolvedEnd, 5.0),
      findNearbyBusStops(resolvedStart, nearbyRadius),
      findNearbyBusStops(resolvedEnd, nearbyRadius)
    ]);
    _mark('directBus+nearbyRail');

    // === Strategy 1b: Direct bus from/to nearby walkable stops ===
    const nearbyDirectBus = [];
    {
      const MAX_WALK_MINUTES = 15;
      const nearbyStartFiltered = nearbyStartStops.filter(s => s.walk_minutes <= MAX_WALK_MINUTES);
      const nearbyEndFiltered = nearbyEndStops.filter(s => s.walk_minutes <= MAX_WALK_MINUTES);

      const startPromises = nearbyStartFiltered.slice(0, 4).map(async (stop) => {
        const buses = await findDirectBusJourneys(stop.atco_code, resolvedEnd, departureTime, dayIndex, 3);
        return buses.map(bus => ({ bus, walkStart: stop, walkEnd: null }));
      });
      const endPromises = nearbyEndFiltered.slice(0, 4).map(async (stop) => {
        const buses = await findDirectBusJourneys(resolvedStart, stop.atco_code, departureTime, dayIndex, 3);
        return buses.map(bus => ({ bus, walkStart: null, walkEnd: stop }));
      });
      const crossPromises = nearbyStartFiltered.slice(0, 3).flatMap(startStop2 =>
        nearbyEndFiltered.slice(0, 3).map(async (endStop2) => {
          const buses = await findDirectBusJourneys(startStop2.atco_code, endStop2.atco_code, departureTime, dayIndex, 2);
          return buses.map(bus => ({ bus, walkStart: startStop2, walkEnd: endStop2 }));
        })
      );

      const allResults = await Promise.all([...startPromises, ...endPromises, ...crossPromises]);
      const seenJourneys = new Set(directBus.map(b => b.journeyId));
      for (const results of allResults) {
        for (const { bus, walkStart, walkEnd } of results) {
          if (seenJourneys.has(bus.journeyId)) continue;
          seenJourneys.add(bus.journeyId);
          nearbyDirectBus.push({ bus, walkStart, walkEnd });
        }
      }
    }
    _mark('nearbyDirectBus');

    const startIsRail = resolvedStart.startsWith('9100');
    const endIsRail = resolvedEnd.startsWith('9100');

    let startTiplocs = startRailStations.map(s => s.tiploc_code);
    let endTiplocs = endRailStations.map(s => s.tiploc_code);

    const [startRailResult, endRailResult] = await Promise.all([
      startIsRail ? pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [resolvedStart]) : null,
      endIsRail ? pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [resolvedEnd]) : null
    ]);
    if (startRailResult?.rows.length > 0) startTiplocs = [startRailResult.rows[0].tiploc_code, ...startTiplocs];
    if (endRailResult?.rows.length > 0) endTiplocs = [endRailResult.rows[0].tiploc_code, ...endTiplocs];

    // Find bus stops near rail stations for cross-mode searches
    let busEndCodes = [resolvedEnd];
    let busStartCodes = [resolvedStart];
    if (endIsRail) {
      const nearbyBusStops = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < 0.008 AND ABS(s.coordinates[1] - $2) < 0.008
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [parseFloat(endStop.lon), parseFloat(endStop.lat)]);
      const endBusStops = nearbyBusStops.rows.map(r => ({
        ...r, dist: haversineDistance(parseFloat(endStop.lat), parseFloat(endStop.lon), parseFloat(r.lat), parseFloat(r.lon))
      })).filter(r => r.dist <= 1.0).sort((a, b) => a.dist - b.dist).slice(0, 5);
      if (endBusStops.length > 0) busEndCodes = endBusStops.map(s => s.atco_code);
    }
    if (startIsRail) {
      const nearbyBusStops = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < 0.008 AND ABS(s.coordinates[1] - $2) < 0.008
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [parseFloat(startStop.lon), parseFloat(startStop.lat)]);
      const startBusStops = nearbyBusStops.rows.map(r => ({
        ...r, dist: haversineDistance(parseFloat(startStop.lat), parseFloat(startStop.lon), parseFloat(r.lat), parseFloat(r.lon))
      })).filter(r => r.dist <= 1.0).sort((a, b) => a.dist - b.dist).slice(0, 5);
      if (startBusStops.length > 0) busStartCodes = startBusStops.map(s => s.atco_code);
    }

    // === Strategy 3: Direct train ===
    // Only search for trains if the journey is long enough to warrant it (> 3km)
    const useTrainStrategies = directDistance > 3.0;
    let directTrain = [];
    if (useTrainStrategies && startTiplocs.length > 0 && endTiplocs.length > 0) {
      const walkToStation = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
      const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStation) + ':00';
      directTrain = await findDirectTrainJourneys(startTiplocs, endTiplocs, trainDepartAfter, 5);
    }
    _mark('directTrain');
    _checkTimeout();

    // === Strategy 2b: Direct bus to/from bus stops near rail stations ===
    let extraDirectBus = [];
    if (endIsRail && busEndCodes.length > 0) {
      for (const busEndCode of busEndCodes) {
        const extra = await findDirectBusJourneys(resolvedStart, busEndCode, departureTime, dayIndex, 3);
        extraDirectBus.push(...extra);
      }
    }
    if (startIsRail && busStartCodes.length > 0) {
      for (const busStartCode of busStartCodes) {
        const extra = await findDirectBusJourneys(busStartCode, resolvedEnd, departureTime, dayIndex, 3);
        extraDirectBus.push(...extra);
      }
    }
    if (endIsRail && busEndCodes.length > 0 && startIsRail && busStartCodes.length > 0) {
      for (const busStartCode of busStartCodes) {
        for (const busEndCode of busEndCodes) {
          const extra = await findDirectBusJourneys(busStartCode, busEndCode, departureTime, dayIndex, 3);
          extraDirectBus.push(...extra);
        }
      }
    }
    const seenBusJourneys = new Set(directBus.map(b => b.journeyId));
    for (const bus of extraDirectBus) {
      if (!seenBusJourneys.has(bus.journeyId)) {
        seenBusJourneys.add(bus.journeyId);
        directBus.push(bus);
      }
    }

    // === Strategy 4: Train + Train connections ===
    let trainConnections = [];
    if (useTrainStrategies && startTiplocs.length > 0 && endTiplocs.length > 0 && directTrain.length === 0) {
      const walkToStation = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
      const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStation) + ':00';
      trainConnections = await findTrainTrainConnections(startTiplocs, endTiplocs, trainDepartAfter, 5);
    }
    _mark('trainConnections');
    _checkTimeout();

    // === Strategy 5: Multi-modal (bus+train, train+bus) ===
    let multiModal = [];

    if (useTrainStrategies) {

    // 5b: Bus → Train
    {
      const busReachableFromStart = await findBusReachableRailStations(resolvedStart, dayIndex, departureTime, 5);
      const stationAtcoCodes = busReachableFromStart.flatMap(s => [s.bus_stop_atco, s.atco_code]);
      const stationCoordsMap = {};
      if (stationAtcoCodes.length > 0) {
        const uniqueCodes = [...new Set(stationAtcoCodes)];
        const placeholders = uniqueCodes.map((_, i) => `$${i + 1}`).join(',');
        const coordsResult = await pool.query(
          `SELECT atco_code, coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code IN (${placeholders})`,
          uniqueCodes
        );
        for (const row of coordsResult.rows) {
          stationCoordsMap[row.atco_code] = { lat: parseFloat(row.lat), lon: parseFloat(row.lon) };
        }
      }

      let targetTiplocs = [...endTiplocs];
      if (endIsRail) {
        const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [resolvedEnd]);
        if (r.rows.length > 0 && !targetTiplocs.includes(r.rows[0].tiploc_code)) {
          targetTiplocs.unshift(r.rows[0].tiploc_code);
        }
      }

      for (const station of busReachableFromStart) {
        if (station.atco_code === resolvedEnd) continue;
        if (multiModal.length >= 10) break;

        const busLegs = await findDirectBusJourneys(resolvedStart, station.bus_stop_atco, departureTime, dayIndex, 3);

        for (const bus of busLegs) {
          const busStopCoords = stationCoordsMap[station.bus_stop_atco];
          const railStopCoords = stationCoordsMap[station.atco_code];
          let walkToStationMins = 2;
          if (busStopCoords && railStopCoords) {
            const walkDist = haversineDistance(busStopCoords.lat, busStopCoords.lon, railStopCoords.lat, railStopCoords.lon);
            walkToStationMins = Math.max(1, Math.ceil(walkDist / WALKING_SPEED_KM_PER_MIN));
          }

          const arrivalAtStation = timeToMinutes(bus.alightTime) + walkToStationMins;
          const trainDepartAfter = minutesToTime(arrivalAtStation) + ':00';

          if (targetTiplocs.length > 0) {
            const trains = await findDirectTrainJourneys([station.tiploc_code], targetTiplocs, trainDepartAfter, 3);

            for (const train of trains) {
              const walkFromEnd = endRailStations.length > 0 && !endIsRail ? endRailStations[0].walk_minutes : 0;
              const legs = [bus];
              if (walkToStationMins > 1 && station.bus_stop_atco !== station.atco_code) {
                const bsCoords = stationCoordsMap[station.bus_stop_atco];
                const rsCoords = stationCoordsMap[station.atco_code];
                const walkDist = (bsCoords && rsCoords) ? haversineDistance(bsCoords.lat, bsCoords.lon, rsCoords.lat, rsCoords.lon) : walkToStationMins * WALKING_SPEED_KM_PER_MIN;
                legs.push({ type: 'walk', fromName: station.bus_stop_name || bus.alightName, toName: station.common_name, fromCoords: bsCoords || null, toCoords: rsCoords || null, duration: walkToStationMins, distance_km: Math.round(walkDist * 1000) / 1000 });
              }
              legs.push(train);
              if (walkFromEnd > 0) {
                legs.push({ type: 'walk', fromName: endRailStations[0].common_name, toName: endStop.common_name, fromCoords: { lat: endRailStations[0].lat, lon: endRailStations[0].lon }, toCoords: { lat: parseFloat(endStop.lat), lon: parseFloat(endStop.lon) }, duration: walkFromEnd, distance_km: endRailStations[0].walk_km });
              }
              multiModal.push({ legs });
            }

            if (trains.length === 0) {
              const trainConns = await findTrainTrainConnections([station.tiploc_code], targetTiplocs, trainDepartAfter, 3);
              for (const conn of trainConns) {
                const lastTrainLeg = conn.legs[conn.legs.length - 1];
                const walkFromStation = endRailStations.find(s => s.tiploc_code === lastTrainLeg.endTiploc) || endRailStations[0] || null;
                const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;
                const legs = [bus];
                if (walkToStationMins > 1 && station.bus_stop_atco !== station.atco_code) {
                  const bsCoords = stationCoordsMap[station.bus_stop_atco];
                  const rsCoords = stationCoordsMap[station.atco_code];
                  const walkDist = (bsCoords && rsCoords) ? haversineDistance(bsCoords.lat, bsCoords.lon, rsCoords.lat, rsCoords.lon) : walkToStationMins * WALKING_SPEED_KM_PER_MIN;
                  legs.push({ type: 'walk', fromName: station.bus_stop_name || bus.alightName, toName: station.common_name, fromCoords: bsCoords || null, toCoords: rsCoords || null, duration: walkToStationMins, distance_km: Math.round(walkDist * 1000) / 1000 });
                }
                legs.push(...conn.legs);
                if (walkFrom > 0 && !endIsRail) {
                  legs.push({ type: 'walk', fromName: walkFromStation.common_name, toName: endStop.common_name, fromCoords: walkFromStation ? { lat: walkFromStation.lat, lon: walkFromStation.lon } : null, toCoords: { lat: parseFloat(endStop.lat), lon: parseFloat(endStop.lon) }, duration: walkFrom, distance_km: walkFromStation.walk_km });
                }
                multiModal.push({ legs });
              }
            }
          }
        }
      }
    }

    // 5c: Train → Bus
    {
      const busReachableFromEnd = await findBusReachableRailStations(resolvedEnd, dayIndex, '00:00:00', 5);
      let sourceTiplocs = [...startTiplocs];
      if (startIsRail) {
        const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [resolvedStart]);
        if (r.rows.length > 0 && !sourceTiplocs.includes(r.rows[0].tiploc_code)) {
          sourceTiplocs.unshift(r.rows[0].tiploc_code);
        }
      }

      if (sourceTiplocs.length === 0) {
        // placeholder — bus→train→bus handled by combining 5b+5c
      }

      if (sourceTiplocs.length > 0) {
        for (const endStation of busReachableFromEnd) {
          if (endStation.atco_code === start) continue;
          if (multiModal.length >= 10) break;

          const walkToStart = startRailStations.length > 0 && !startIsRail ? startRailStations[0].walk_minutes : 0;
          const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStart) + ':00';
          const trains = await findDirectTrainJourneys(sourceTiplocs, [endStation.tiploc_code], trainDepartAfter, 3);

          for (const train of trains) {
            const arrivalMins = timeToMinutes(train.alightTime) + 3;
            const busAfter = minutesToTime(arrivalMins) + ':00';
            let busLegs = await findDirectBusJourneys(endStation.bus_stop_atco, resolvedEnd, busAfter, dayIndex, 2);
            if (busLegs.length === 0 && endIsRail && busEndCodes.length > 0) {
              for (const busEndCode of busEndCodes) {
                const extra = await findDirectBusJourneys(endStation.bus_stop_atco, busEndCode, busAfter, dayIndex, 2);
                busLegs.push(...extra);
                if (busLegs.length >= 2) break;
              }
            }

            for (const bus of busLegs) {
              const legs = [];
              if (walkToStart > 0) {
                legs.push({ type: 'walk', fromName: startStop.common_name, toName: startRailStations[0].common_name, fromCoords: { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) }, toCoords: { lat: startRailStations[0].lat, lon: startRailStations[0].lon }, duration: walkToStart, distance_km: startRailStations[0].walk_km });
              }
              legs.push(train);
              if (endStation.bus_stop_atco !== endStation.atco_code) {
                legs.push({ type: 'walk', fromName: endStation.common_name, toName: endStation.bus_stop_name || 'Bus stop', fromCoords: { lat: endStation.lat, lon: endStation.lon }, toCoords: null, duration: 3, distance_km: 0.2 });
              }
              legs.push(bus);
              multiModal.push({ legs });
            }
          }
        }
      }
    }

    // 5d: Walk-based multi-modal
    if ((startRailStations.length > 0 || endRailStations.length > 0) && multiModal.length < 10) {
      for (const endStation of endRailStations.slice(0, 2)) {
        if (startTiplocs.length === 0) continue;
        const walkToStart = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
        const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStart) + ':00';
        const trains = await findDirectTrainJourneys(startTiplocs, [endStation.tiploc_code], trainDepartAfter, 3);

        for (const train of trains) {
          const arrivalMins = timeToMinutes(train.alightTime) + endStation.walk_minutes;
          const busAfter = minutesToTime(arrivalMins) + ':00';
          let busLegs = await findDirectBusJourneys(endStation.atco_code, resolvedEnd, busAfter, dayIndex, 2);
          if (busLegs.length === 0 && endIsRail && busEndCodes.length > 0) {
            for (const busEndCode of busEndCodes) {
              const extra = await findDirectBusJourneys(endStation.atco_code, busEndCode, busAfter, dayIndex, 2);
              busLegs.push(...extra);
              if (busLegs.length >= 2) break;
            }
          }

          for (const bus of busLegs) {
            multiModal.push({
              legs: [
                ...(walkToStart > 0 ? [{ type: 'walk', fromName: startStop.common_name, toName: startRailStations[0].common_name, duration: walkToStart, distance_km: startRailStations[0].walk_km }] : []),
                train,
                ...(endStation.walk_minutes > 2 ? [{ type: 'walk', fromName: endStation.common_name, toName: 'Bus stop', duration: endStation.walk_minutes, distance_km: endStation.walk_km }] : []),
                bus
              ]
            });
          }
        }
      }

      for (const startStation of startRailStations.slice(0, 2)) {
        if (endTiplocs.length === 0) continue;
        const nearStart = await findNearbyBusStops(startStation.atco_code, 1.0);
        for (const nearStop of nearStart.slice(0, 3)) {
          const busLegs = await findDirectBusJourneys(resolvedStart, nearStop.atco_code, departureTime, dayIndex, 2);
          for (const bus of busLegs) {
            const arrivalMins = timeToMinutes(bus.alightTime) + 3;
            const trainAfter = minutesToTime(arrivalMins) + ':00';
            const trains = await findDirectTrainJourneys([startStation.tiploc_code], endTiplocs, trainAfter, 2);

            for (const train of trains) {
              const walkFromEnd = endRailStations.length > 0 ? endRailStations[0].walk_minutes : 0;
              multiModal.push({
                legs: [
                  bus,
                  { type: 'walk', fromName: nearStop.common_name, toName: startStation.common_name, duration: nearStop.walk_minutes, distance_km: nearStop.walk_km },
                  train,
                  ...(walkFromEnd > 0 && !endIsRail ? [{ type: 'walk', fromName: endRailStations[0].common_name, toName: endStop.common_name, duration: walkFromEnd, distance_km: endRailStations[0].walk_km }] : [])
                ]
              });
            }

            if (trains.length === 0) {
              const trainConns = await findTrainTrainConnections([startStation.tiploc_code], endTiplocs, trainAfter, 3);
              for (const conn of trainConns) {
                const lastTrainLeg = conn.legs[conn.legs.length - 1];
                const walkFromStation = endRailStations.find(s => s.tiploc_code === lastTrainLeg.endTiploc) || endRailStations[0] || null;
                const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;
                multiModal.push({
                  legs: [
                    bus,
                    { type: 'walk', fromName: nearStop.common_name, toName: startStation.common_name, duration: nearStop.walk_minutes, distance_km: nearStop.walk_km },
                    ...conn.legs,
                    ...(walkFrom > 0 && !endIsRail ? [{ type: 'walk', fromName: walkFromStation.common_name, toName: endStop.common_name, duration: walkFrom, distance_km: walkFromStation.walk_km }] : [])
                  ]
                });
              }
            }
          }
        }
      }
    }
    } // end useTrainStrategies guard
    _mark('multiModal');

    // === Strategy 6: Bus → Bus transfer ===
    let busTransfers = [];
    _checkTimeout();
    {
      let startCodes = await expandStopCode(resolvedStart);
      let endCodes = await expandStopCode(resolvedEnd);

      // Expand nearby stops in parallel, limit to 3 nearby stops (was 5)
      const nearbyStartExpansions = await Promise.all(
        nearbyStartStops.filter(s => s.walk_minutes <= 10).slice(0, 3)
          .map(stop => expandStopCode(stop.atco_code))
      );
      for (const expanded of nearbyStartExpansions) {
        startCodes = [...new Set([...startCodes, ...expanded])];
      }
      const nearbyEndExpansions = await Promise.all(
        nearbyEndStops.filter(s => s.walk_minutes <= 10).slice(0, 3)
          .map(stop => expandStopCode(stop.atco_code))
      );
      for (const expanded of nearbyEndExpansions) {
        endCodes = [...new Set([...endCodes, ...expanded])];
      }

      if (startIsRail && busStartCodes.length > 0) {
        const railExpansions = await Promise.all(busStartCodes.map(code => expandStopCode(code)));
        for (const expanded of railExpansions) {
          startCodes = [...new Set([...startCodes, ...expanded])];
        }
      }
      if (endIsRail && busEndCodes.length > 0) {
        const railExpansions = await Promise.all(busEndCodes.map(code => expandStopCode(code)));
        for (const expanded of railExpansions) {
          endCodes = [...new Set([...endCodes, ...expanded])];
        }
      }

      // Cap the number of codes to prevent combinatorial explosion
      const MAX_TRANSFER_CODES = 20;
      if (startCodes.length > MAX_TRANSFER_CODES) startCodes = startCodes.slice(0, MAX_TRANSFER_CODES);
      if (endCodes.length > MAX_TRANSFER_CODES) endCodes = endCodes.slice(0, MAX_TRANSFER_CODES);

      const sPlaceholders = startCodes.map((_, i) => `$${i + 1}`).join(',');
      const ePlaceholders = endCodes.map((_, i) => `$${startCodes.length + i + 1}`).join(',');
      const dayPos = dayIndex + 1;

      // Set a per-query timeout for the expensive transfer query (8 seconds)
      await pool.query('SET statement_timeout = 8000');
      let transferResult;
      try {
        transferResult = await pool.query(`
        SELECT
          bj1.journey_id as j1_id, bj1.route_number as route1, bj1.operator_code as op1,
          o1.name as op1_name,
          bjs1_start.departure_time as board_time,
          s_start.common_name as board_name, bjs1_start.atco_code as board_atco,
          bjs1_end.atco_code as transfer_atco, s_transfer.common_name as transfer_name,
          bjs1_end.arrival_time as transfer_arrive,
          bj2.journey_id as j2_id, bj2.route_number as route2, bj2.operator_code as op2,
          o2.name as op2_name,
          bjs2_start.departure_time as transfer_depart,
          bjs2_end.atco_code as alight_atco, s_end.common_name as alight_name,
          bjs2_end.arrival_time as alight_time
        FROM bus_journey_stops bjs1_start
        JOIN bus_journeys bj1 ON bjs1_start.journey_id = bj1.journey_id
        JOIN bus_journey_stops bjs1_end ON bj1.journey_id = bjs1_end.journey_id
          AND bjs1_end.stop_sequence > bjs1_start.stop_sequence
        -- Match transfer stops by exact ATCO code or same 7-char cluster prefix
        -- (heuristic: NaPTAN ATCO codes often share a 7-char base for stops in the same locality)
        JOIN bus_journey_stops bjs2_start ON
              (bjs2_start.atco_code = bjs1_end.atco_code
               OR SUBSTRING(bjs2_start.atco_code FROM 1 FOR 7) = SUBSTRING(bjs1_end.atco_code FROM 1 FOR 7))
          AND bjs2_start.journey_id != bj1.journey_id
          AND bjs2_start.departure_time >= bjs1_end.arrival_time + INTERVAL '2 minutes'
          AND bjs2_start.departure_time <= bjs1_end.arrival_time + INTERVAL '45 minutes'
        JOIN bus_journeys bj2 ON bjs2_start.journey_id = bj2.journey_id
        JOIN bus_journey_stops bjs2_end ON bj2.journey_id = bjs2_end.journey_id
          AND bjs2_end.stop_sequence > bjs2_start.stop_sequence
        JOIN stops s_start ON bjs1_start.atco_code = s_start.atco_code
        JOIN stops s_transfer ON bjs1_end.atco_code = s_transfer.atco_code
        JOIN stops s_end ON bjs2_end.atco_code = s_end.atco_code
        LEFT JOIN operators o1 ON bj1.operator_code = o1.operator_code
        LEFT JOIN operators o2 ON bj2.operator_code = o2.operator_code
        WHERE bjs1_start.atco_code IN (${sPlaceholders})
          AND bjs2_end.atco_code IN (${ePlaceholders})
          AND SUBSTRING(bj1.days_of_week FROM ${dayPos} FOR 1) = '1'
          AND SUBSTRING(bj2.days_of_week FROM ${dayPos} FOR 1) = '1'
          AND bjs1_start.departure_time >= $${startCodes.length + endCodes.length + 1}::time
        ORDER BY bjs1_start.departure_time, bjs2_start.departure_time
        LIMIT 15
      `, [...startCodes, ...endCodes, departureTime]);
      } catch (transferErr) {
        console.warn(`[PERF] Bus transfer query timed out or failed (startCodes=${startCodes.length}, endCodes=${endCodes.length}):`, transferErr.message);
        transferResult = { rows: [] };
      }
      await pool.query('RESET statement_timeout').catch(() => {});
      _checkTimeout();

      const seenTransfers = new Set();
      for (const r of transferResult.rows) {
        const key = `${r.j1_id}→${r.j2_id}`;
        if (seenTransfers.has(key)) continue;
        seenTransfers.add(key);
        busTransfers.push({
          legs: [
            { type: 'bus', journeyId: r.j1_id, routeNumber: r.route1, operator: r.op1, operatorName: r.op1_name, boardAtco: r.board_atco, boardName: r.board_name, boardTime: r.board_time, alightAtco: r.transfer_atco, alightName: r.transfer_name, alightTime: r.transfer_arrive },
            { type: 'transfer', stop: r.transfer_name, atco: r.transfer_atco, waitMinutes: safeDuration(r.transfer_arrive, r.transfer_depart), arrivalTime: r.transfer_arrive, nextDepartureTime: r.transfer_depart },
            { type: 'bus', journeyId: r.j2_id, routeNumber: r.route2, operator: r.op2, operatorName: r.op2_name, boardAtco: r.transfer_atco, boardName: r.transfer_name, boardTime: r.transfer_depart, alightAtco: r.alight_atco, alightName: r.alight_name, alightTime: r.alight_time }
          ]
        });
        if (busTransfers.length >= 5) break;
      }
    }

    // === Compile all route options ===
    const allRoutes = [];

    // Direct bus routes
    for (const bus of directBus) {
      const depMins = timeToMinutes(bus.boardTime);
      const arrMins = timeToMinutes(bus.alightTime);
      const legs = [bus];
      let totalDuration = arrMins - depMins;

      const busAlightIsEnd = bus.alightAtco === resolvedEnd;
      const busBoardIsStart = bus.boardAtco === resolvedStart;

      if (!busBoardIsStart && startIsRail) {
        const busStopCoords = await pool.query('SELECT coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code = $1', [bus.boardAtco]);
        if (busStopCoords.rows[0]) {
          const walkDist = haversineDistance(parseFloat(startStop.lat), parseFloat(startStop.lon), parseFloat(busStopCoords.rows[0].lat), parseFloat(busStopCoords.rows[0].lon));
          const walkMins = Math.max(1, Math.ceil(walkDist / WALKING_SPEED_KM_PER_MIN));
          if (walkMins > 1) { legs.unshift({ type: 'walk', fromName: startStop.common_name, toName: bus.boardName, duration: walkMins, distance_km: Math.round(walkDist * 1000) / 1000 }); totalDuration += walkMins; }
        }
      }
      if (!busAlightIsEnd && endIsRail) {
        const busStopCoords = await pool.query('SELECT coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code = $1', [bus.alightAtco]);
        if (busStopCoords.rows[0]) {
          const walkDist = haversineDistance(parseFloat(busStopCoords.rows[0].lat), parseFloat(busStopCoords.rows[0].lon), parseFloat(endStop.lat), parseFloat(endStop.lon));
          const walkMins = Math.max(1, Math.ceil(walkDist / WALKING_SPEED_KM_PER_MIN));
          if (walkMins > 1) { legs.push({ type: 'walk', fromName: bus.alightName, toName: endStop.common_name, duration: walkMins, distance_km: Math.round(walkDist * 1000) / 1000 }); totalDuration += walkMins; }
        }
      }

      const modes = [...new Set(legs.map(l => l.type))];
      allRoutes.push({ id: `bus-direct-${bus.journeyId}`, summary: `Bus ${bus.routeNumber}${busAlightIsEnd ? ' direct' : ''}`, modes, departureTime: bus.boardTime, arrivalTime: minutesToTime(depMins + totalDuration) + ':00', durationMinutes: totalDuration, legs });
    }

    // Nearby-stop bus routes
    for (const { bus, walkStart, walkEnd } of nearbyDirectBus) {
      const depMins = timeToMinutes(bus.boardTime);
      const arrMins = timeToMinutes(bus.alightTime);
      const legs = [];
      let totalDuration = arrMins - depMins;
      if (walkStart) { legs.push({ type: 'walk', fromName: startStop.common_name, toName: walkStart.common_name, duration: walkStart.walk_minutes, distance_km: walkStart.walk_km }); totalDuration += walkStart.walk_minutes; }
      legs.push(bus);
      if (walkEnd) { legs.push({ type: 'walk', fromName: walkEnd.common_name, toName: endStop.common_name, duration: walkEnd.walk_minutes, distance_km: walkEnd.walk_km }); totalDuration += walkEnd.walk_minutes; }
      const modes = [...new Set(legs.map(l => l.type))];
      const walkInfo = walkStart ? ` (via ${walkStart.common_name})` : '';
      allRoutes.push({ id: `bus-nearby-${bus.journeyId}`, summary: `Bus ${bus.routeNumber}${walkInfo}`, modes, departureTime: walkStart ? minutesToTime(depMins - walkStart.walk_minutes) + ':00' : bus.boardTime, arrivalTime: minutesToTime(depMins + totalDuration - (walkStart ? walkStart.walk_minutes : 0)) + ':00', durationMinutes: totalDuration, legs });
    }

    // Direct train routes
    for (const train of directTrain) {
      const walkToStation = startRailStations.find(s => s.tiploc_code === train.startTiploc) || startRailStations[0] || null;
      const walkFromStation = endRailStations.find(s => s.tiploc_code === train.endTiploc) || endRailStations[0] || null;
      const walkTo = walkToStation ? walkToStation.walk_minutes : 0;
      const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;
      // actualDepartureTime = when the user physically leaves: train boardTime minus any walk to station
      const actualDepartureTime = (walkTo > 0 && !startIsRail)
        ? minutesToTime(timeToMinutes(train.boardTime) - walkTo)
        : train.boardTime;
      const depMins = timeToMinutes(actualDepartureTime);
      const arrMins = timeToMinutes(train.alightTime) + walkFrom;
      const legs = [];
      if (walkToStation && !startIsRail) {
        legs.push({
          type: 'walk', fromName: startStop.common_name, toName: walkToStation.common_name,
          fromCoords: { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) },
          toCoords: { lat: walkToStation.lat, lon: walkToStation.lon },
          duration: walkTo, distance_km: walkToStation.walk_km
        });
      }
      legs.push(train);
      if (walkFromStation && !endIsRail) {
        legs.push({
          type: 'walk', fromName: walkFromStation.common_name, toName: endStop.common_name,
          fromCoords: { lat: walkFromStation.lat, lon: walkFromStation.lon },
          toCoords: { lat: parseFloat(endStop.lat), lon: parseFloat(endStop.lon) },
          duration: walkFrom, distance_km: walkFromStation.walk_km
        });
      }
      allRoutes.push({ id: `train-direct-${train.trainUid}`, summary: `Train ${train.operator || ''} direct`, modes: walkTo > 0 || walkFrom > 0 ? ['walk', 'train'] : ['train'], departureTime: actualDepartureTime, arrivalTime: minutesToTime(arrMins) + ':00', durationMinutes: arrMins - depMins, legs });
    }

    // Train + Train connections
    for (const conn of trainConnections) {
      const firstTrainLeg = conn.legs[0];
      const lastTrainLeg = conn.legs[conn.legs.length - 1];
      const walkToStation = startRailStations.find(s => s.tiploc_code === firstTrainLeg.startTiploc) || startRailStations[0] || null;
      const walkFromStation = endRailStations.find(s => s.tiploc_code === lastTrainLeg.endTiploc) || endRailStations[0] || null;
      const walkTo = walkToStation ? walkToStation.walk_minutes : 0;
      const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;
      // actualDepartureTime = when the user physically leaves: first train boardTime minus any walk
      const actualDepartureTime = (walkTo > 0 && !startIsRail)
        ? minutesToTime(timeToMinutes(firstTrainLeg.boardTime) - walkTo)
        : firstTrainLeg.boardTime;
      const depMins = timeToMinutes(actualDepartureTime);
      const lastLeg = conn.legs[conn.legs.length - 1];
      const arrMins = timeToMinutes(lastLeg.alightTime) + walkFrom;
      const legs = [];
      if (walkToStation && !startIsRail) {
        legs.push({
          type: 'walk', fromName: startStop.common_name, toName: walkToStation.common_name,
          fromCoords: { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) },
          toCoords: { lat: walkToStation.lat, lon: walkToStation.lon },
          duration: walkTo, distance_km: walkToStation.walk_km
        });
      }
      legs.push(...conn.legs);
      if (walkFromStation && !endIsRail) {
        legs.push({
          type: 'walk', fromName: walkFromStation.common_name, toName: endStop.common_name,
          fromCoords: { lat: walkFromStation.lat, lon: walkFromStation.lon },
          toCoords: { lat: parseFloat(endStop.lat), lon: parseFloat(endStop.lon) },
          duration: walkFrom, distance_km: walkFromStation.walk_km
        });
      }
      allRoutes.push({ id: `train-conn-${conn.legs[0].trainUid}-${lastLeg.trainUid}`, summary: `Train via ${conn.legs[1].station || 'connection'}`, modes: ['walk', 'train'], departureTime: actualDepartureTime, arrivalTime: minutesToTime(arrMins) + ':00', durationMinutes: arrMins - depMins, legs });
    }

    // Multi-modal routes
    for (const mm of multiModal) {
      const firstLeg = mm.legs[0];
      const lastLeg = mm.legs[mm.legs.length - 1];
      // Compute actual departure: first transport boardTime minus any leading walk duration
      let actualDepartureTime;
      if (firstLeg.type === 'walk') {
        const firstTransport = mm.legs.find(l => l.boardTime);
        actualDepartureTime = firstTransport
          ? minutesToTime(timeToMinutes(firstTransport.boardTime) - firstLeg.duration)
          : departureTime;
      } else {
        actualDepartureTime = firstLeg.boardTime;
      }
      const depMins = timeToMinutes(actualDepartureTime);
      const arrTime = lastLeg.type === 'walk'
        ? minutesToTime(timeToMinutes(mm.legs[mm.legs.length - 2].alightTime) + lastLeg.duration)
        : lastLeg.alightTime;
      const arrMins = timeToMinutes(arrTime);
      const modes = [...new Set(mm.legs.map(l => l.type).filter(t => t !== 'transfer'))];
      allRoutes.push({ id: `multi-${allRoutes.length}`, summary: modes.join(' + '), modes, departureTime: actualDepartureTime, arrivalTime: arrTime.includes(':') && arrTime.length <= 5 ? arrTime + ':00' : arrTime, durationMinutes: arrMins >= depMins ? arrMins - depMins : arrMins + 1440 - depMins, legs: mm.legs });
    }

    // Bus + Bus transfers
    for (const bt of busTransfers) {
      const firstLeg = bt.legs[0];
      const lastLeg = bt.legs[bt.legs.length - 1];
      const depMins = timeToMinutes(firstLeg.boardTime);
      const arrMins = timeToMinutes(lastLeg.alightTime);
      allRoutes.push({ id: `bus-transfer-${firstLeg.journeyId}-${lastLeg.journeyId}`, summary: `Bus ${firstLeg.routeNumber} → ${lastLeg.routeNumber}`, modes: ['bus'], departureTime: firstLeg.boardTime, arrivalTime: lastLeg.alightTime, durationMinutes: arrMins >= depMins ? arrMins - depMins : arrMins + 1440 - depMins, transferStop: bt.legs[1].stop, legs: bt.legs });
    }

    // === Strategy 0: Walking only (short distances) ===
    const walkDistance = (pinToPin !== null) ? pinToPin : directDistance;
    if (walkDistance <= 3.0) {
      const walkMinutes = Math.max(1, Math.ceil(walkDistance / WALKING_SPEED_KM_PER_MIN));
      const walkFrom = startPlaceCoords || { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) };
      const walkTo = endPlaceCoords || { lat: parseFloat(endStop.lat), lon: parseFloat(endStop.lon) };
      allRoutes.push({ id: 'walk-only', summary: 'Walk', modes: ['walk'], departureTime, arrivalTime: minutesToTime(timeToMinutes(departureTime) + walkMinutes) + ':00', durationMinutes: walkMinutes, legs: [{ type: 'walk', fromName: startPlaceName || startStop.common_name, toName: endPlaceName || endStop.common_name, fromCoords: walkFrom, toCoords: walkTo, duration: walkMinutes, distance_km: Math.round(walkDistance * 1000) / 1000 }] });
    }
    _mark('busTransfers');

    // === Enrich coordinates ===
    _checkTimeout();
    await enrichLegsWithCoordinates(allRoutes, startStop, endStop);
    _mark('enrichCoords');

    // === Prepend/append walk legs for place-based searches ===
    if (startWalkLeg || endWalkLeg) {
      for (const route of allRoutes) {
        if (startWalkLeg) {
          // Skip if route already starts with a walk leg from the same location
          const firstLeg = route.legs[0];
          if (firstLeg && firstLeg.type === 'walk') {
            // Merge: update the existing walk leg's start to be the user's location
            firstLeg.fromName = startWalkLeg.fromName;
            firstLeg.fromCoords = startWalkLeg.fromCoords;
            // Recalculate distance and duration for the combined walk
            if (firstLeg.fromCoords && firstLeg.toCoords) {
              const dist = haversineDistance(firstLeg.fromCoords.lat, firstLeg.fromCoords.lon, firstLeg.toCoords.lat, firstLeg.toCoords.lon);
              const newDuration = Math.max(1, Math.ceil(dist / WALKING_SPEED_KM_PER_MIN));
              route.durationMinutes += newDuration - (firstLeg.duration || 0);
              firstLeg.duration = newDuration;
              firstLeg.distance_km = Math.round(dist * 1000) / 1000;
            } else {
              route.durationMinutes += startWalkLeg.duration;
              firstLeg.duration = (firstLeg.duration || 0) + startWalkLeg.duration;
              firstLeg.distance_km = (firstLeg.distance_km || 0) + (startWalkLeg.distance_km || 0);
            }
          } else {
            route.legs.unshift({ ...startWalkLeg });
            route.durationMinutes += startWalkLeg.duration;
            // Update departure time to reflect the walk start
            route.departureTime = minutesToTime(timeToMinutes(route.departureTime) - startWalkLeg.duration);
          }
        }
        if (endWalkLeg) {
          // Skip if route already ends with a walk leg to the same destination
          const lastLeg = route.legs[route.legs.length - 1];
          if (lastLeg && lastLeg.type === 'walk') {
            // Merge: update the existing walk leg's end to be the user's destination
            lastLeg.toName = endWalkLeg.toName;
            lastLeg.toCoords = endWalkLeg.toCoords;
            if (lastLeg.fromCoords && lastLeg.toCoords) {
              const dist = haversineDistance(lastLeg.fromCoords.lat, lastLeg.fromCoords.lon, lastLeg.toCoords.lat, lastLeg.toCoords.lon);
              const newDuration = Math.max(1, Math.ceil(dist / WALKING_SPEED_KM_PER_MIN));
              route.durationMinutes += newDuration - (lastLeg.duration || 0);
              lastLeg.duration = newDuration;
              lastLeg.distance_km = Math.round(dist * 1000) / 1000;
            } else {
              route.durationMinutes += endWalkLeg.duration;
              lastLeg.duration = (lastLeg.duration || 0) + endWalkLeg.duration;
              lastLeg.distance_km = (lastLeg.distance_km || 0) + (endWalkLeg.distance_km || 0);
            }
          } else {
            route.legs.push({ ...endWalkLeg });
            route.durationMinutes += endWalkLeg.duration;
          }
        }
      }
    }

    // === Filter unreasonable routes ===
    const reasonableMinMinutes = Math.max(directDistance * 2, 15);
    const maxReasonableDuration = Math.max(reasonableMinMinutes * 5, 180);
    // Scale max walk leg with journey distance: 15 min for short trips, up to 40 min for long ones
    const maxWalkLegMinutes = Math.min(40, Math.max(15, Math.ceil(directDistance * 1.5)));
    const walkOnlyDuration = walkDistance <= 3.0 ? Math.max(1, Math.ceil(walkDistance / WALKING_SPEED_KM_PER_MIN)) : null;
    const queryDepMins = timeToMinutes(departureTime);
    const filteredRoutes = allRoutes.filter(r => {
      if (r.durationMinutes <= 0 || r.durationMinutes > maxReasonableDuration) {
        console.log(`[FILTER] ${r.id}: REJECTED duration=${r.durationMinutes}min (max=${maxReasonableDuration})`);
        return false;
      }
      // Reject routes that require leaving before the requested departure time
      if (timeToMinutes(r.departureTime) < queryDepMins) {
        console.log(`[FILTER] ${r.id}: REJECTED departs ${r.departureTime} before requested ${departureTime}`);
        return false;
      }
      if (r.id !== 'walk-only') {
        const walkLegs = r.legs.filter(l => l.type === 'walk');
        const maxWalk = Math.max(...walkLegs.map(l => l.duration || 0), 0);
        if (maxWalk > maxWalkLegMinutes) {
          console.log(`[FILTER] ${r.id}: REJECTED maxWalk=${maxWalk}min (limit=${maxWalkLegMinutes})`);
          return false;
        }
      }
      // Only apply walk-vs-transit comparison for short walkable distances
      if (walkOnlyDuration !== null && r.id !== 'walk-only') {
        if (r.durationMinutes > walkOnlyDuration * 2.5) {
          console.log(`[FILTER] ${r.id}: REJECTED slower than 2.5x walking (${r.durationMinutes} vs ${walkOnlyDuration * 2.5})`);
          return false;
        }
      }
      return true;
    });
    console.log(`[FILTER] directDist=${directDistance.toFixed(1)}km maxWalk=${maxWalkLegMinutes}min maxDuration=${maxReasonableDuration}min | ${allRoutes.length} candidates → ${filteredRoutes.length} after filter`);

    // === Deduplicate ===
    // Two-phase deduplication:
    // 1. Exact duplicates (same transport legs with same times)
    // 2. Near-duplicates (same route pattern but different departure times for same service)
    const uniqueRoutes = [];
    const seenExactKeys = new Set();
    const patternGroups = new Map(); // Groups routes by their journey pattern (ignoring specific times)
    
    for (const r of filteredRoutes) {
      // Phase 1: Exact deduplication (same vehicles, same times)
      const exactKey = r.legs
        .filter(l => l.type === 'bus' || l.type === 'train')
        .map(l => l.type === 'bus' ? `bus:${l.routeNumber}:${l.boardTime}` : `train:${l.trainUid}`)
        .join('→');
      const fullExactKey = exactKey || `${r.departureTime}-${r.arrivalTime}-${r.summary}`;
      
      if (seenExactKeys.has(fullExactKey)) continue;
      seenExactKeys.add(fullExactKey);
      
      // Phase 2: Pattern-based grouping (same route numbers and interchange points, different times)
      // This catches near-identical routes like "Bus 42 → Train from Poulton" at different times
      const patternKey = r.legs
        .filter(l => l.type === 'bus' || l.type === 'train')
        .map(l => {
          if (l.type === 'bus') return `bus:${l.routeNumber}:${l.boardName}→${l.alightName}`;
          if (l.type === 'train') return `train:${l.boardName}→${l.alightName}`;
          return '';
        })
        .join('|');
      
      console.log(`[DEDUP] Route ${r.id} pattern: ${patternKey}`);
      
      if (!patternGroups.has(patternKey)) {
        patternGroups.set(patternKey, []);
      }
      patternGroups.get(patternKey).push(r);
    }
    
    console.log(`[DEDUP] Pattern groups: ${patternGroups.size}, routes per group:`, [...patternGroups.entries()].map(([k, v]) => `${k.substring(0, 50)}...: ${v.length}`));
    
    // From each pattern group, keep the best route (earliest departure that arrives soonest)
    // and optionally one alternative if times differ significantly (>30 min)
    for (const [pattern, routes] of patternGroups) {
      if (routes.length === 0) continue;
      
      // Sort by departure time, then by duration
      routes.sort((a, b) => {
        const depDiff = timeToMinutes(a.departureTime) - timeToMinutes(b.departureTime);
        if (depDiff !== 0) return depDiff;
        return a.durationMinutes - b.durationMinutes;
      });
      
      // Always add the first (earliest) route
      uniqueRoutes.push(routes[0]);
      
      // Add one more if it departs significantly later (>30 min) and is meaningfully different
      if (routes.length > 1) {
        const firstDepMins = timeToMinutes(routes[0].departureTime);
        for (let i = 1; i < routes.length; i++) {
          const thisDepMins = timeToMinutes(routes[i].departureTime);
          if (thisDepMins - firstDepMins >= 30) {
            uniqueRoutes.push(routes[i]);
            break; // Only add one alternative per pattern
          }
        }
      }
    }

    // === Sort ===
    if (sortBy === 'arrival') {
      uniqueRoutes.sort((a, b) => timeToMinutes(a.arrivalTime) - timeToMinutes(b.arrivalTime));
    } else if (sortBy === 'duration') {
      uniqueRoutes.sort((a, b) => a.durationMinutes - b.durationMinutes);
    } else {
      uniqueRoutes.sort((a, b) => timeToMinutes(a.departureTime) - timeToMinutes(b.departureTime));
    }

    // === Geometry enrichment (top routes only) ===
    const MAX_ROUTES_WITH_GEOMETRY = 8;
    const topRoutes = uniqueRoutes.slice(0, MAX_ROUTES_WITH_GEOMETRY);
    _mark('filterSort');

    await enrichLegsWithGeometry(topRoutes);
    _mark('enrichGeometry');

    clearTimeout(requestTimer);
    _mark('done');
    console.log(`[PERF] /api/plan total=${_timers.done}ms | candidates=${allRoutes.length} filtered=${uniqueRoutes.length} displayed=${topRoutes.length} |`, Object.entries(_timers).map(([k, v]) => `${k}=${v}ms`).join(' '));

    // ── Next-available fallback when no routes found ────────────────
    let nextAvailable = null;
    if (topRoutes.length === 0) {
      // Try next morning (06:00) on the next day
      const nextDayIndex = (dayIndex + 1) % 7;
      const nextDayTime = '06:00:00';
      const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

      try {
        // Quick search: direct bus + direct train for next morning
        const [nextBus, nextTrain] = await Promise.all([
          findDirectBusJourneys(resolvedStart, resolvedEnd, nextDayTime, nextDayIndex, 3),
          (startTiplocs.length > 0 && endTiplocs.length > 0)
            ? findDirectTrainJourneys(startTiplocs, endTiplocs, nextDayTime, 3)
            : Promise.resolve([])
        ]);

        // Also check nearby-stop buses
        const nearbyNextPromises = nearbyStartStops
          .filter(s => s.walk_minutes <= 15).slice(0, 4)
          .map(stop => findDirectBusJourneys(stop.atco_code, resolvedEnd, nextDayTime, nextDayIndex, 1));
        const nearbyNextResults = await Promise.all(nearbyNextPromises);
        const nearbyNextBus = nearbyNextResults.flat();

        const allNext = [...nextBus, ...nearbyNextBus, ...nextTrain];

        if (allNext.length > 0) {
          // Find earliest departure
          const earliest = allNext.reduce((best, item) => {
            const t = item.boardTime || item.departTime;
            if (!t) return best;
            if (!best || timeToMinutes(t) < timeToMinutes(best.time)) {
              return { time: t, mode: item.type || (item.trainUid ? 'train' : 'bus'), summary: item.routeNumber || item.operator || '' };
            }
            return best;
          }, null);

          if (earliest) {
            nextAvailable = {
              day: dayNames[nextDayIndex],
              dayIndex: nextDayIndex,
              time: earliest.time,
              mode: earliest.mode,
              summary: earliest.summary,
              message: `No services available at ${departureTime.substring(0, 5)} on ${dayNames[dayIndex]}. First available: ${earliest.time.substring(0, 5)} on ${dayNames[nextDayIndex]} (${earliest.mode}${earliest.summary ? ' ' + earliest.summary : ''}).`
            };
          }
        }

        // If nothing found next day, try searching the same day from 06:00
        if (!nextAvailable) {
          const [sameDayBus, sameDayTrain] = await Promise.all([
            findDirectBusJourneys(resolvedStart, resolvedEnd, '06:00:00', dayIndex, 1),
            (startTiplocs.length > 0 && endTiplocs.length > 0)
              ? findDirectTrainJourneys(startTiplocs, endTiplocs, '06:00:00', 1)
              : Promise.resolve([])
          ]);
          const allSameDay = [...sameDayBus, ...sameDayTrain];
          if (allSameDay.length > 0) {
            const earliest = allSameDay[0];
            const t = earliest.boardTime || earliest.departTime;
            if (t) {
              nextAvailable = {
                day: dayNames[dayIndex],
                dayIndex,
                time: t,
                mode: earliest.type || (earliest.trainUid ? 'train' : 'bus'),
                summary: earliest.routeNumber || earliest.operator || '',
                message: `No services available at ${departureTime.substring(0, 5)}. Services run on ${dayNames[dayIndex]} from ${t.substring(0, 5)}.`
              };
            }
          }
        }

        if (!nextAvailable) {
          nextAvailable = {
            message: `No services found between these locations at ${departureTime.substring(0, 5)} on ${dayNames[dayIndex]}. Try a different time or day.`
          };
        }
      } catch (err) {
        console.error('Next-available search error:', err.message);
        nextAvailable = {
          message: `No routes available at ${departureTime.substring(0, 5)} on ${dayNames[dayIndex]}. Try a different departure time.`
        };
      }
    }

    res.json({
      start: { atco: resolvedStart, name: startPlaceName || startStop.common_name, coordinates: startPlaceCoords || { lon: startStop.lon, lat: startStop.lat }, resolvedStop: startWalkLeg ? startStop.common_name : undefined },
      end: { atco: resolvedEnd, name: endPlaceName || endStop.common_name, coordinates: endPlaceCoords || { lon: endStop.lon, lat: endStop.lat }, resolvedStop: endWalkLeg ? endStop.common_name : undefined },
      directDistance_km: Math.round(directDistance * 100) / 100,
      departureTime,
      dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][dayIndex],
      sortedBy: sortBy,
      routes: topRoutes,
      totalRoutes: uniqueRoutes.length,
      nearbyRailStations: { start: startRailStations, end: endRailStations },
      ...(nextAvailable ? { nextAvailable } : {})
    });

  } catch (err) {
    clearTimeout(requestTimer);
    if (err.message && err.message.includes('Request timeout')) {
      console.error(`[PERF] Route planning timed out after ${REQUEST_TIMEOUT_MS}ms`);
      return res.status(504).json({ error: 'Route planning took too long. Try locations closer to major bus stops or rail stations.' });
    }
    if (err.message && err.message.includes('statement timeout')) {
      console.error('[PERF] Database query timed out (statement_timeout)');
      return res.status(504).json({ error: 'Route search took too long. Try a different start or end location.' });
    }
    console.error('Route planner error:', err);
    res.status(500).json({ error: 'Failed to plan route', details: err.message });
  }
});

module.exports = router;

