/**
 * Geometry service — route polyline enrichment.
 *
 * Handles:
 *   - Valhalla polyline decoding
 *   - Valhalla & OSRM routing for walk/bus/train geometry
 *   - In-memory caching (walk + bus)
 *   - Coordinate enrichment from DB (ATCO/CRS → lat/lon)
 *   - Merging consecutive walk legs
 *
 * Exports:
 *   decodeValhallaPolyline(encoded, precision)
 *   fetchValhallaGeometry(fromLat, fromLon, toLat, toLon, costing)
 *   fetchOSRMGeometry(waypoints, profile)
 *   fetchValhallaBusGeometry(waypoints)
 *   getBusJourneyWaypoints(journeyId, boardAtco, alightAtco)
 *   getTrainJourneyWaypoints(trainUid, startTiploc, endTiploc)
 *   enrichLegsWithCoordinates(allRoutes, startStop, endStop)
 *   enrichLegsWithGeometry(allRoutes)
 *   mergeConsecutiveWalkLegs(allRoutes)
 */

const pool = require('../db/pool');
const { haversineDistance, calculateBearing, getStationCoords } = require('../utils/geo');
const { findRailTrackPath } = require('../utils/rail-graph');

// ── Helpers ─────────────────────────────────────────────────────────

/** Simple delay helper for rate limiting. */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Caches ──────────────────────────────────────────────────────────

const VALHALLA_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** Walk geometry cache – key: "fromLat,fromLon:toLat,toLon" (4dp ≈ 11 m). */
const valhallaGeoCache = new Map();

/** Bus route geometry cache – key: "journeyId:boardAtco:alightAtco". */
const busGeoCache = new Map();

function getValhallaCacheKey(fromLat, fromLon, toLat, toLon) {
  return `${fromLat.toFixed(4)},${fromLon.toFixed(4)}:${toLat.toFixed(4)},${toLon.toFixed(4)}`;
}

function getCachedGeometry(key) {
  const entry = valhallaGeoCache.get(key);
  if (entry && Date.now() - entry.time < VALHALLA_CACHE_TTL) return entry.geometry;
  if (entry) valhallaGeoCache.delete(key);
  return undefined; // undefined = not cached, null = cached failure
}

function setCachedGeometry(key, geometry) {
  valhallaGeoCache.set(key, { geometry, time: Date.now() });
  if (valhallaGeoCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of valhallaGeoCache) {
      if (now - v.time > VALHALLA_CACHE_TTL) valhallaGeoCache.delete(k);
    }
  }
}

// ── Polyline decoding ───────────────────────────────────────────────

/**
 * Decode a Valhalla-encoded polyline string into [[lat, lon], ...].
 * precision=6 (Valhalla default).
 */
function decodeValhallaPolyline(encoded, precision = 6) {
  const factor = Math.pow(10, precision);
  const points = [];
  let lat = 0, lng = 0, index = 0;

  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / factor, lng / factor]);
  }
  return points;
}

// ── Routing API wrappers ────────────────────────────────────────────

/**
 * Fetch walking/cycling/driving geometry from Valhalla.
 * Retries once on rate-limit (HTML response).
 */
async function fetchValhallaGeometry(fromLat, fromLon, toLat, toLon, costing = 'pedestrian') {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const requestBody = JSON.stringify({
        locations: [
          { lat: fromLat, lon: fromLon, type: 'break' },
          { lat: toLat, lon: toLon, type: 'break' }
        ],
        costing,
        directions_options: { units: 'kilometers' }
      });

      const result = await new Promise((resolve) => {
        const https = require('https');
        const options = {
          hostname: 'valhalla1.openstreetmap.de',
          path: '/route',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody)
          },
          timeout: 8000
        };

        const req = https.request(options, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.trip && parsed.trip.legs && parsed.trip.legs[0] && parsed.trip.legs[0].shape) {
                const points = decodeValhallaPolyline(parsed.trip.legs[0].shape);
                resolve(points.length >= 2 ? points : null);
              } else {
                resolve(null);
              }
            } catch {
              resolve('retry');
            }
          });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', function () { this.destroy(); resolve(null); });
        req.write(requestBody);
        req.end();
      });

      if (result === 'retry' && attempt === 0) { await delay(500); continue; }
      if (result === 'retry') return null;
      return result;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Fetch road-following geometry from OSRM (legacy fallback).
 */
async function fetchOSRMGeometry(waypoints, profile = 'driving') {
  if (!waypoints || waypoints.length < 2) return null;
  try {
    const coords = waypoints.map(w => `${w.lon},${w.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

    return new Promise((resolve) => {
      const https = require('https');
      https.get(url, { timeout: 5000 }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.code === 'Ok' && result.routes && result.routes[0]) {
              const geojsonCoords = result.routes[0].geometry.coordinates;
              resolve(geojsonCoords.map(c => [c[1], c[0]]));
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null))
        .on('timeout', function () { this.destroy(); resolve(null); });
    });
  } catch {
    return null;
  }
}

/**
 * Fetch road-following geometry for a bus route via Valhalla.
 * Groups close stops (<2 km) into multi-waypoint requests with heading constraints.
 */
async function fetchValhallaBusGeometry(waypoints) {
  if (!waypoints || waypoints.length < 2) return null;

  const GAP_THRESHOLD_KM = 2.0;
  const groups = [];
  let currentGroup = [waypoints[0]];

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);

    if (dist > GAP_THRESHOLD_KM) {
      currentGroup.push(curr);
      groups.push(currentGroup);
      currentGroup = [curr];
    } else {
      currentGroup.push(curr);
    }
  }
  if (currentGroup.length >= 2) {
    groups.push(currentGroup);
  } else if (groups.length > 0 && currentGroup.length === 1) {
    groups[groups.length - 1].push(currentGroup[0]);
  }

  const allPoints = [];
  const GROUP_BATCH = 3;

  for (let gb = 0; gb < groups.length; gb += GROUP_BATCH) {
    const batch = groups.slice(gb, gb + GROUP_BATCH);

    const results = await Promise.allSettled(batch.map(async (group) => {
      const locations = group.map((w, i) => {
        const loc = {
          lat: w.lat, lon: w.lon,
          type: i === 0 || i === group.length - 1 ? 'break' : 'via'
        };
        if (i < group.length - 1) {
          loc.heading = Math.round(calculateBearing(w.lat, w.lon, group[i + 1].lat, group[i + 1].lon));
        } else {
          loc.heading = Math.round(calculateBearing(group[i - 1].lat, group[i - 1].lon, w.lat, w.lon));
        }
        loc.heading_tolerance = 60;
        return loc;
      });

      for (const costing of ['bus', 'auto']) {
        const requestBody = JSON.stringify({
          locations, costing,
          directions_options: { units: 'kilometers' }
        });

        const geo = await new Promise((resolve) => {
          const https = require('https');
          const req = https.request({
            hostname: 'valhalla1.openstreetmap.de',
            path: '/route',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(requestBody)
            },
            timeout: 10000
          }, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
              try {
                const parsed = JSON.parse(data);
                if (parsed.trip && parsed.trip.legs) {
                  const pts = [];
                  for (const leg of parsed.trip.legs) {
                    if (leg.shape) {
                      const decoded = decodeValhallaPolyline(leg.shape);
                      if (pts.length > 0 && decoded.length > 0) decoded.shift();
                      pts.push(...decoded);
                    }
                  }
                  resolve(pts.length >= 2 ? pts : null);
                } else { resolve(null); }
              } catch { resolve(null); }
            });
          });
          req.on('error', () => resolve(null));
          req.on('timeout', function () { this.destroy(); resolve(null); });
          req.write(requestBody);
          req.end();
        });

        if (geo && geo.length >= 2) return geo;
      }
      return null;
    }));

    for (const result of results) {
      const geo = result.status === 'fulfilled' ? result.value : null;
      if (geo && geo.length >= 2) {
        if (allPoints.length > 0) geo.shift();
        allPoints.push(...geo);
      }
    }

    if (gb + GROUP_BATCH < groups.length) {
      await delay(100);
    }
  }

  return allPoints.length >= 2 ? allPoints : null;
}

// ── Waypoint fetchers ───────────────────────────────────────────────

/**
 * Get intermediate stop coordinates for a bus journey.
 */
async function getBusJourneyWaypoints(journeyId, boardAtco, alightAtco) {
  const result = await pool.query(`
    SELECT bjs.atco_code, s.coordinates[0] as lon, s.coordinates[1] as lat, bjs.stop_sequence
    FROM bus_journey_stops bjs
    JOIN stops s ON bjs.atco_code = s.atco_code
    WHERE bjs.journey_id = $1
      AND s.coordinates IS NOT NULL
      AND bjs.stop_sequence >= (SELECT stop_sequence FROM bus_journey_stops WHERE journey_id = $1 AND atco_code = $2 LIMIT 1)
      AND bjs.stop_sequence <= (SELECT stop_sequence FROM bus_journey_stops WHERE journey_id = $1 AND atco_code = $3 LIMIT 1)
    ORDER BY bjs.stop_sequence
  `, [journeyId, boardAtco, alightAtco]);

  return result.rows.map(r => ({ lat: parseFloat(r.lat), lon: parseFloat(r.lon) }));
}

/**
 * Get intermediate stop coordinates for a train journey.
 */
async function getTrainJourneyWaypoints(trainUid, startTiploc, endTiploc) {
  const result = await pool.query(`
    SELECT sp.tiploc_code, s.coordinates[0] as lon, s.coordinates[1] as lat, sp.sequence_order
    FROM schedule_points sp
    JOIN national_rail nr ON sp.tiploc_code = nr.tiploc_code
    JOIN stops s ON nr.atco_code = s.atco_code
    WHERE sp.train_uid = $1
      AND s.coordinates IS NOT NULL
      AND sp.sequence_order >= (SELECT sequence_order FROM schedule_points WHERE train_uid = $1 AND tiploc_code = $2 LIMIT 1)
      AND sp.sequence_order <= (SELECT sequence_order FROM schedule_points WHERE train_uid = $1 AND tiploc_code = $3 LIMIT 1)
    ORDER BY sp.sequence_order
  `, [trainUid, startTiploc, endTiploc]);

  return result.rows.map(r => ({ lat: parseFloat(r.lat), lon: parseFloat(r.lon) }));
}

// ── Coordinate enrichment (DB lookups) ──────────────────────────────

/**
 * Enrich route legs with from/to coordinates from the stops table.
 * Also resolves CRS station coordinates for train legs.
 */
async function enrichLegsWithCoordinates(allRoutes, startStop, endStop) {
  const atcoCodes = new Set();
  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.boardAtco) atcoCodes.add(leg.boardAtco);
      if (leg.alightAtco) atcoCodes.add(leg.alightAtco);
    }
  }

  const coordsMap = {};
  if (atcoCodes.size > 0) {
    const codes = [...atcoCodes];
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT atco_code, coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code IN (${placeholders})`,
      codes
    );
    for (const row of result.rows) {
      coordsMap[row.atco_code] = { lat: parseFloat(row.lat), lon: parseFloat(row.lon) };
    }
  }

  for (const route of allRoutes) {
    for (let li = 0; li < route.legs.length; li++) {
      const leg = route.legs[li];
      if (leg.type === 'bus') {
        leg.fromCoords = leg.fromCoords || coordsMap[leg.boardAtco] || null;
        leg.toCoords = leg.toCoords || coordsMap[leg.alightAtco] || null;
      } else if (leg.type === 'train') {
        // Try CRS-based coordinates first (more accurate), fall back to DB
        if (leg.startTiploc) {
          const crsResult = await pool.query(
            'SELECT crs_code FROM national_rail WHERE tiploc_code = $1', [leg.startTiploc]
          );
          if (crsResult.rows.length > 0) {
            const coords = getStationCoords(crsResult.rows[0].crs_code);
            if (coords) leg.fromCoords = coords;
          }
        }
        if (leg.endTiploc) {
          const crsResult = await pool.query(
            'SELECT crs_code FROM national_rail WHERE tiploc_code = $1', [leg.endTiploc]
          );
          if (crsResult.rows.length > 0) {
            const coords = getStationCoords(crsResult.rows[0].crs_code);
            if (coords) leg.toCoords = coords;
          }
        }
        // Fall back to DB coordinates
        if (!leg.fromCoords && leg.boardAtco) leg.fromCoords = coordsMap[leg.boardAtco] || null;
        if (!leg.toCoords && leg.alightAtco) leg.toCoords = coordsMap[leg.alightAtco] || null;
      }
      // Walk legs: use adjacent leg coords or start/end stop as fallback
      if (leg.type === 'walk' && !leg.fromCoords) {
        // Try previous leg's toCoords first (e.g., bus alight → walk → train)
        const prevLeg = li > 0 ? route.legs[li - 1] : null;
        if (prevLeg && prevLeg.toCoords) {
          leg.fromCoords = { ...prevLeg.toCoords };
        } else if (li === 0 && startStop) {
          leg.fromCoords = { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) };
        }
      }
      if (leg.type === 'walk' && !leg.toCoords) {
        // Try next leg's fromCoords first (e.g., walk → train board)
        const nextLeg = li < route.legs.length - 1 ? route.legs[li + 1] : null;
        if (nextLeg && nextLeg.fromCoords) {
          leg.toCoords = { ...nextLeg.fromCoords };
        } else if (li === route.legs.length - 1 && endStop) {
          leg.toCoords = { lat: parseFloat(endStop.lat), lon: parseFloat(endStop.lon) };
        }
      }
    }
  }
}

// ── Walk leg merging ────────────────────────────────────────────────

/**
 * Merge consecutive walk legs in each route into a single walk leg.
 */
function mergeConsecutiveWalkLegs(allRoutes) {
  for (const route of allRoutes) {
    let i = 0;
    while (i < route.legs.length - 1) {
      if (route.legs[i].type === 'walk' && route.legs[i + 1].type === 'walk') {
        const leg1 = route.legs[i];
        const leg2 = route.legs[i + 1];

        let mergedDistance = (leg1.distance_km || 0) + (leg2.distance_km || 0);
        let mergedDuration = (leg1.duration || 0) + (leg2.duration || 0);
        const fromCoords = leg1.fromCoords || null;
        const toCoords = leg2.toCoords || null;

        if (fromCoords && toCoords) {
          const directDist = haversineDistance(fromCoords.lat, fromCoords.lon, toCoords.lat, toCoords.lon);
          mergedDistance = Math.round(directDist * 1000) / 1000;
          mergedDuration = Math.ceil(directDist / 0.08);
        }

        const merged = {
          type: 'walk',
          fromName: leg1.fromName,
          toName: leg2.toName,
          fromCoords,
          toCoords,
          duration: mergedDuration,
          distance_km: mergedDistance,
          geometry: null
        };

        route.durationMinutes -= (leg1.duration || 0) + (leg2.duration || 0);
        route.durationMinutes += mergedDuration;

        route.legs.splice(i, 2, merged);
      } else {
        i++;
      }
    }
  }
}

// ── Full geometry enrichment ────────────────────────────────────────

/**
 * Enrich route legs with geometry from stop waypoints and routing services.
 * - Train: railway graph (local)
 * - Bus: stop waypoints → Valhalla bus routing (cached)
 * - Walk: Valhalla pedestrian routing (cached + deduplicated)
 */
async function enrichLegsWithGeometry(allRoutes) {
  // --- Phase 1: Train track + bus stop waypoints (DB-only) ---
  const localPromises = [];

  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.type === 'train' && leg.trainUid && leg.startTiploc && leg.endTiploc) {
        localPromises.push(
          (async () => {
            const waypoints = await getTrainJourneyWaypoints(leg.trainUid, leg.startTiploc, leg.endTiploc);
            if (waypoints && waypoints.length >= 2) {
              const trackPath = findRailTrackPath(
                waypoints[0].lat, waypoints[0].lon,
                waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lon
              );
              if (trackPath && trackPath.length >= 2) {
                leg.geometry = trackPath;
              } else {
                const segments = [];
                for (let i = 0; i < waypoints.length - 1; i++) {
                  const seg = findRailTrackPath(
                    waypoints[i].lat, waypoints[i].lon,
                    waypoints[i + 1].lat, waypoints[i + 1].lon
                  );
                  if (seg && seg.length >= 2) {
                    if (segments.length > 0) seg.shift();
                    segments.push(...seg);
                  } else {
                    if (segments.length > 0) {
                      segments.push([waypoints[i + 1].lat, waypoints[i + 1].lon]);
                    } else {
                      segments.push([waypoints[i].lat, waypoints[i].lon]);
                      segments.push([waypoints[i + 1].lat, waypoints[i + 1].lon]);
                    }
                  }
                }
                leg.geometry = segments.length >= 2 ? segments : waypoints.map(w => [w.lat, w.lon]);
              }
            }
          })()
        );
      } else if (leg.type === 'bus' && leg.journeyId && leg.boardAtco && leg.alightAtco) {
        localPromises.push(
          (async () => {
            const waypoints = await getBusJourneyWaypoints(leg.journeyId, leg.boardAtco, leg.alightAtco);
            if (waypoints && waypoints.length >= 2) {
              leg._busWaypoints = waypoints;
              leg.geometry = waypoints.map(w => [w.lat, w.lon]);
            }
          })()
        );
      }
    }
  }

  await Promise.allSettled(localPromises);

  // --- Phase 2a: Bus road-following geometry ---
  const busRequests = [];

  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.type === 'bus' && leg._busWaypoints && leg._busWaypoints.length >= 2) {
        const cacheKey = `bus:${leg.journeyId}:${leg.boardAtco}:${leg.alightAtco}`;
        const cached = busGeoCache.get(cacheKey);
        if (cached && Date.now() - cached.time < VALHALLA_CACHE_TTL) {
          if (cached.geometry && cached.geometry.length >= 2) {
            leg.geometry = cached.geometry;
          }
          delete leg._busWaypoints;
          continue;
        }
        busRequests.push({ leg, waypoints: leg._busWaypoints, cacheKey });
      }
    }
  }

  if (busRequests.length > 0) {
    console.log(`Valhalla bus route queue: ${busRequests.length} requests`);

    const BUS_BATCH = 4;
    const MAX_CHUNK = 15;
    for (let i = 0; i < busRequests.length; i += BUS_BATCH) {
      const batch = busRequests.slice(i, i + BUS_BATCH);

      await Promise.allSettled(batch.map(async ({ leg, waypoints, cacheKey }) => {
        let geometry = null;

        if (waypoints.length <= MAX_CHUNK) {
          // Short route: fetch in one go
          geometry = await fetchValhallaBusGeometry(waypoints);
          if (!geometry || geometry.length < 2) {
            geometry = await fetchOSRMGeometry(waypoints, 'driving');
          }
        } else {
          // Long route: chunk into overlapping segments of MAX_CHUNK stops,
          // fetch road-following geometry for each, and stitch together
          const allPts = [];
          for (let s = 0; s < waypoints.length - 1; s += MAX_CHUNK - 1) {
            const chunk = waypoints.slice(s, s + MAX_CHUNK);
            if (chunk.length < 2) break;
            let chunkGeo = await fetchValhallaBusGeometry(chunk);
            if (!chunkGeo || chunkGeo.length < 2) {
              chunkGeo = await fetchOSRMGeometry(chunk, 'driving');
            }
            if (chunkGeo && chunkGeo.length >= 2) {
              if (allPts.length > 0) chunkGeo.shift(); // skip duplicate join point
              allPts.push(...chunkGeo);
            }
            if (s + MAX_CHUNK < waypoints.length) await delay(80);
          }
          if (allPts.length >= 2) geometry = allPts;
        }

        busGeoCache.set(cacheKey, { geometry, time: Date.now() });
        if (busGeoCache.size > 300) {
          const now = Date.now();
          for (const [k, v] of busGeoCache) {
            if (now - v.time > VALHALLA_CACHE_TTL) busGeoCache.delete(k);
          }
        }

        if (geometry && geometry.length >= 2) {
          leg.geometry = geometry;
        }
        delete leg._busWaypoints;
      }));

      if (i + BUS_BATCH < busRequests.length) {
        await delay(80);
      }
    }
  }

  // Clean up
  for (const route of allRoutes) {
    for (const leg of route.legs) {
      delete leg._busWaypoints;
    }
  }

  // --- Phase 2b: Walk geometry (Valhalla pedestrian) ---
  const walkRequests = new Map();

  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.type === 'walk' && leg.fromCoords && leg.toCoords) {
        const key = getValhallaCacheKey(leg.fromCoords.lat, leg.fromCoords.lon, leg.toCoords.lat, leg.toCoords.lon);

        const cached = getCachedGeometry(key);
        if (cached !== undefined) {
          if (cached && cached.length >= 2) {
            const geoClone = cached.map(p => [...p]);
            geoClone[0] = [leg.fromCoords.lat, leg.fromCoords.lon];
            geoClone[geoClone.length - 1] = [leg.toCoords.lat, leg.toCoords.lon];
            leg.geometry = geoClone;
          }
          continue;
        }

        if (!walkRequests.has(key)) {
          walkRequests.set(key, {
            fromLat: leg.fromCoords.lat, fromLon: leg.fromCoords.lon,
            toLat: leg.toCoords.lat, toLon: leg.toCoords.lon,
            legs: [leg]
          });
        } else {
          walkRequests.get(key).legs.push(leg);
        }
      }
    }
  }

  const walkQueue = [...walkRequests.entries()];
  if (walkQueue.length > 0) {
    console.log(`Valhalla walk queue: ${walkQueue.length} unique requests`);

    const BATCH_SIZE = 5;
    for (let i = 0; i < walkQueue.length; i += BATCH_SIZE) {
      const batch = walkQueue.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(batch.map(async ([key, entry]) => {
        const geometry = await fetchValhallaGeometry(
          entry.fromLat, entry.fromLon, entry.toLat, entry.toLon, 'pedestrian'
        );

        setCachedGeometry(key, geometry);

        if (geometry && geometry.length >= 2) {
          for (const leg of entry.legs) {
            const geoClone = geometry.map(p => [...p]);
            geoClone[0] = [leg.fromCoords.lat, leg.fromCoords.lon];
            geoClone[geoClone.length - 1] = [leg.toCoords.lat, leg.toCoords.lon];
            leg.geometry = geoClone;
          }
        }
      }));
    }
  }
}

module.exports = {
  decodeValhallaPolyline,
  fetchValhallaGeometry,
  fetchOSRMGeometry,
  fetchValhallaBusGeometry,
  getBusJourneyWaypoints,
  getTrainJourneyWaypoints,
  enrichLegsWithCoordinates,
  enrichLegsWithGeometry,
  mergeConsecutiveWalkLegs,
};
