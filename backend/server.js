/**
 * Lancaster Travel Routes — Express application entry point.
 *
 * This is the slim entry point that composes all route modules.
 * Business logic lives in /services, data helpers in /utils, and
 * HTTP handlers in /routes.
 */

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const createAuthRoutes = require('./routes/auth');
const { securityHeaders, sanitiseInput } = require('./middleware/security');
const { safeDuration } = require('./utils/time');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ───────────────────────────────────────────────────────
app.use(securityHeaders());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5001',
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// ─── UK Station Coordinates by CRS code ───
// Comprehensive lookup covering all stations referenced by services through Lancashire
// Coordinates sourced from NaPTAN / ORR data (WGS84)
// Scope: Lancaster – Preston – Blackpool / Fylde & Wyre coast
const STATION_COORDS = {
  // Lancaster area
  LAN: { lat: 54.0488, lon: -2.8079, name: 'Lancaster' },
  MCM: { lat: 54.0703, lon: -2.8685, name: 'Morecambe' },
  BAR: { lat: 54.0747, lon: -2.8350, name: 'Bare Lane' },
  CNF: { lat: 54.1310, lon: -2.7700, name: 'Carnforth' },
  HHB: { lat: 54.0328, lon: -2.9155, name: 'Heysham Harbour' },
  SVR: { lat: 54.1702, lon: -2.8076, name: 'Silverdale' },
  // Preston area
  PRE: { lat: 53.7553, lon: -2.7072, name: 'Preston' },
  LEY: { lat: 53.6986, lon: -2.6866, name: 'Leyland' },
  EBA: { lat: 53.6598, lon: -2.6717, name: 'Euxton Balshaw Lane' },
  BMB: { lat: 53.7245, lon: -2.6594, name: 'Bamber Bridge' },
  LOH: { lat: 53.7335, lon: -2.6892, name: 'Lostock Hall' },
  CSO: { lat: 53.6747, lon: -2.7756, name: 'Croston' },
  RUF: { lat: 53.6338, lon: -2.8182, name: 'Rufford' },
  // Blackpool & Fylde coast
  BPN: { lat: 53.8229, lon: -3.0484, name: 'Blackpool North' },
  BPS: { lat: 53.7984, lon: -3.0488, name: 'Blackpool South' },
  BPB: { lat: 53.7879, lon: -3.0539, name: 'Blackpool Pleasure Beach' },
  SQU: { lat: 53.7770, lon: -3.0502, name: 'Squires Gate' },
  SAS: { lat: 53.7534, lon: -3.0249, name: "St Annes-on-the-Sea" },
  LTM: { lat: 53.7393, lon: -2.9642, name: 'Lytham' },
  AFV: { lat: 53.7416, lon: -2.9935, name: 'Ansdell & Fairhaven' },
  MOS: { lat: 53.7646, lon: -2.9144, name: 'Moss Side' },
  KKM: { lat: 53.7869, lon: -2.8834, name: 'Kirkham & Wesham' },
  SAL: { lat: 53.7818, lon: -2.8182, name: 'Salwick' },
  PFY: { lat: 53.8483, lon: -2.9897, name: 'Poulton-le-Fylde' },
  LAY: { lat: 53.8353, lon: -3.0299, name: 'Layton' },
};

// ─── Railway Graph for track-following train geometry ───
let railGraph = null;
try {
  const graphPath = path.join(__dirname, 'data', 'railway_graph.json');
  const raw = fs.readFileSync(graphPath, 'utf8');
  railGraph = JSON.parse(raw);
  console.log(`Railway graph loaded: ${railGraph.points.length} points`);
} catch (err) {
  console.warn('Railway graph not loaded (train routes will use straight lines):', err.message);
}

/**
 * Find the nearest railway graph node to a given coordinate.
 * Uses a simple linear scan (fast enough for ~3600 points).
 */
function findNearestRailNode(lat, lon) {
  if (!railGraph) return -1;
  let bestDist = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < railGraph.points.length; i++) {
    const [plat, plon] = railGraph.points[i];
    const dlat = plat - lat;
    const dlon = plon - lon;
    const d = dlat * dlat + dlon * dlon; // squared Euclidean is fine for nearest-neighbor
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  // Convert squared-degree distance to approximate meters for threshold check
  // 1 degree lat ≈ 111km, so 0.005 deg ≈ 555m → sq = 0.000025
  return bestDist < 0.0001 ? bestIdx : -1; // ~1.1km threshold
}

/**
 * Resolve station coordinates by CRS code.
 * First checks the hardcoded STATION_COORDS lookup, which covers all stations
 * referenced by services through Lancashire. Falls back to database query.
 */
function getStationCoords(crs) {
  if (!crs) return null;
  const entry = STATION_COORDS[crs.toUpperCase()];
  if (entry) return { lat: entry.lat, lon: entry.lon };
  return null;
}

/**
 * Dijkstra shortest-path through the railway graph.
 * Returns array of [lat, lon] coordinates following the railway track,
 * or null if no path exists.
 */
function findRailTrackPath(fromLat, fromLon, toLat, toLon) {
  if (!railGraph) return null;

  const startIdx = findNearestRailNode(fromLat, fromLon);
  const endIdx = findNearestRailNode(toLat, toLon);
  if (startIdx < 0 || endIdx < 0 || startIdx === endIdx) return null;

  const points = railGraph.points;
  const adj = railGraph.adj;

  // Dijkstra with priority queue (simple array-based for small graph)
  const dist = new Float64Array(points.length).fill(Infinity);
  const prev = new Int32Array(points.length).fill(-1);
  dist[startIdx] = 0;

  // Min-heap using array of [distance, nodeIndex]
  const heap = [[0, startIdx]];

  while (heap.length > 0) {
    // Extract min
    let minI = 0;
    for (let i = 1; i < heap.length; i++) {
      if (heap[i][0] < heap[minI][0]) minI = i;
    }
    const [d, u] = heap[minI];
    heap[minI] = heap[heap.length - 1];
    heap.pop();

    if (u === endIdx) break;
    if (d > dist[u]) continue;

    const neighbors = adj[String(u)];
    if (!neighbors) continue;

    for (const v of neighbors) {
      const [ulat, ulon] = points[u];
      const [vlat, vlon] = points[v];
      const dlat = vlat - ulat;
      const dlon = vlon - ulon;
      const edgeDist = Math.sqrt(dlat * dlat + dlon * dlon);
      const newDist = d + edgeDist;
      if (newDist < dist[v]) {
        dist[v] = newDist;
        prev[v] = u;
        heap.push([newDist, v]);
      }
    }
  }

  if (prev[endIdx] === -1 && startIdx !== endIdx) return null;

  // Reconstruct path
  const path = [];
  let node = endIdx;
  while (node !== -1) {
    path.push(points[node]);
    node = prev[node];
  }
  path.reverse();
  return path.map(([lat, lon]) => [lat, lon]);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5050),
  database: process.env.DB_NAME || 'group1db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'group1',
  connectionTimeoutMillis: 5000,  // fail fast when DB is unavailable (e.g. in CI)
});

// Prevent unhandled pool errors from crashing the process (e.g. in CI)
pool.on('error', (err) => {
  console.error('PostgreSQL pool error (non-fatal):', err.message);
});

// ─── Session management (server-side, stored in PostgreSQL) ───
const sessionStore = new PgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true,
  errorLog: (...args) => {
    // Suppress noisy PgSession errors when DB is unavailable (e.g. CI)
    if (process.env.NODE_ENV !== 'test') console.error(...args);
  }
});
// Prevent unhandled 'error' events on the store from crashing the process
sessionStore.on('error', (err) => {
  console.error('Session store error (non-fatal):', err.message);
});

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'lancaster-travel-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true',
    sameSite: 'lax'
  },
  name: 'connect.sid'
}));

// ─── Mount auth routes ───
app.use('/api/auth', createAuthRoutes(pool));

// Haversine distance calculation in kilometers
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

// Fetch nearest bus stops by user location
app.get('/api/stops', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    // Fetch all stops that have routes, plus key stops (bus stations etc.)
    const result = await pool.query(`
      SELECT s.atco_code, s.common_name, s.coordinates,
        CASE WHEN EXISTS (SELECT 1 FROM route_stops rs WHERE rs.atco_code = s.atco_code) THEN true ELSE false END as has_routes
      FROM stops s
      WHERE s.coordinates IS NOT NULL
    `);
    
    let stops = result.rows;
    
    // If user location provided, calculate distances and sort
    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      
      stops = stops.map(stop => {
        const coords = stop.coordinates;
        let stopLat, stopLng;
        
        if (typeof coords === 'object' && coords.x !== undefined) {
          stopLat = coords.y;
          stopLng = coords.x;
        } else if (typeof coords === 'string') {
          // Parse string format "(-2.7,53.5)"
          const match = coords.match(/\(([^,]+),([^)]+)\)/);
          if (!match) return null;
          stopLat = parseFloat(match[2]);
          stopLng = parseFloat(match[1]);
        } else {
          return null;
        }
        
        const distance = haversineDistance(userLat, userLng, stopLat, stopLng);
        return { ...stop, distance };
      }).filter(s => s !== null)
       .sort((a, b) => a.distance - b.distance)
       .slice(0, 5);
    }
    // When no location given, return all stops for autocomplete search
    
    res.json(stops);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stops' });
  }
});

// ─── Geocode: Search places via Nominatim, bounded to Lancashire/Fylde area ───
app.get('/api/geocode', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json([]);
    }

    const https = require('https');

    // Bounding box: roughly Lancashire / Preston / Blackpool / Fylde & Wyre coast / Lancaster
    // SW corner: 53.6, -3.1  NE corner: 54.15, -2.5
    const viewbox = '-3.1,53.6,-2.5,54.15';

    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=6` +
      `&viewbox=${viewbox}&bounded=1` +
      `&countrycodes=gb`;

    const data = await new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'Group1-LancasterTravelPlanner/1.0' },
        timeout: 8000
      }, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
        response.on('error', reject);
      }).on('error', reject)
        .on('timeout', function() { this.destroy(); reject(new Error('Nominatim timeout')); });
    });

    // Format results
    const places = data.map(item => ({
      type: 'place',
      name: item.display_name.split(',').slice(0, 3).join(','),
      fullName: item.display_name,
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      category: item.type,
      osmType: item.osm_type
    }));

    res.json(places);
  } catch (err) {
    console.error('Geocode error:', err.message);
    res.json([]);
  }
});

// ─── Reverse geocode: turn lat/lon into a human-readable address ───
// Supports both /api/reverse-geocode (new) and /api/reverse (legacy drop-pin)
async function handleReverseGeocode(req, res) {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.json({ name: 'My Location' });
    }

    const https = require('https');
    const url = `https://nominatim.openstreetmap.org/reverse?` +
      `lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
      `&format=json&addressdetails=1&zoom=18`;

    const data = await new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'Group1-LancasterTravelPlanner/1.0' },
        timeout: 8000
      }, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
        response.on('error', reject);
      }).on('error', reject)
        .on('timeout', function() { this.destroy(); reject(new Error('Nominatim timeout')); });
    });

    if (data && data.address) {
      const a = data.address;
      // Build a concise name: road + suburb/village or town
      const road = a.road || a.pedestrian || a.footway || a.path || '';
      const area = a.suburb || a.village || a.hamlet || a.neighbourhood || a.town || a.city || '';
      const name = [road, area].filter(Boolean).join(', ') || data.display_name?.split(',').slice(0, 2).join(',') || 'My Location';
      return res.json({ name, display_name: data.display_name, fullName: data.display_name, lat: parseFloat(lat), lon: parseFloat(lon) });
    }

    res.json({ name: 'My Location' });
  } catch (err) {
    console.error('Reverse geocode error:', err.message);
    res.json({ name: 'My Location' });
  }
}
app.get('/api/reverse-geocode', handleReverseGeocode);
app.get('/api/reverse', handleReverseGeocode);

// ─── Search: Combined stop + place search for the frontend ───
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ stops: [], places: [] });
    }

    const query = q.toLowerCase().trim();

    // Search DB stops by name (fast)
    // Prioritize: rail stations > bus stations > exact name matches > partial matches
    const stopResult = await pool.query(`
      SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat,
        CASE
          WHEN s.atco_code LIKE '9100%' THEN 'rail'
          ELSE 'bus'
        END as stop_type
      FROM stops s
      WHERE LOWER(s.common_name) LIKE $1
        AND s.coordinates IS NOT NULL
      ORDER BY
        CASE WHEN LOWER(s.common_name) = $3 THEN 0 ELSE 1 END,
        CASE WHEN s.atco_code LIKE '9100%' THEN 0 ELSE 1 END,
        CASE
          WHEN LOWER(s.common_name) LIKE $3 || ' rail%' THEN 0
          WHEN LOWER(s.common_name) LIKE $3 || ' bus%' THEN 1
          WHEN LOWER(s.common_name) LIKE $2 THEN 2
          ELSE 3
        END,
        s.common_name
      LIMIT 8
    `, [`%${query}%`, `${query}%`, query]);

    const stops = stopResult.rows.map(r => ({
      type: 'stop',
      atco_code: r.atco_code,
      name: r.common_name,
      lat: r.lat,
      lon: r.lon,
      stop_type: r.stop_type
    }));

    // Also search places via Nominatim (parallel)
    const https = require('https');
    const viewbox = '-3.1,53.6,-2.5,54.15';
    const url = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5` +
      `&viewbox=${viewbox}&bounded=1&countrycodes=gb`;

    let places = [];
    try {
      const data = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 3000);
        https.get(url, {
          headers: { 'User-Agent': 'Group1-LancasterTravelPlanner/1.0' }
        }, (response) => {
          let body = '';
          response.on('data', chunk => body += chunk);
          response.on('end', () => {
            clearTimeout(timer);
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(e); }
          });
          response.on('error', e => { clearTimeout(timer); reject(e); });
        }).on('error', e => { clearTimeout(timer); reject(e); });
      });

      places = data.map(item => ({
        type: 'place',
        name: item.display_name.split(',').slice(0, 3).join(','),
        fullName: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
        category: item.type || item.class
      }));
    } catch (e) {
      // Nominatim timeout or error — return stops only
      console.warn('Nominatim search failed:', e.message);
    }

    res.json({ stops, places });
  } catch (err) {
    console.error('Search error:', err.message);
    res.json({ stops: [], places: [] });
  }
});

// ─── Nearby stops: find closest stops to given coordinates ───
app.get('/api/stops/nearby', async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon required' });
    }

    const userLat = parseFloat(lat);
    const userLon = parseFloat(lon);
    const maxKm = parseFloat(radius) || 1.5; // default 1.5km
    const degDelta = maxKm / 111.0; // rough degrees for bounding box

    // Find nearby bus stops that have routes
    const busResult = await pool.query(`
      SELECT s.atco_code, s.common_name,
             s.coordinates[0] as lon, s.coordinates[1] as lat
      FROM stops s
      WHERE s.coordinates IS NOT NULL
        AND s.atco_code NOT LIKE '9100%'
        AND ABS(s.coordinates[0] - $1) < $3
        AND ABS(s.coordinates[1] - $2) < $3
        AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
    `, [userLon, userLat, degDelta]);

    // Find nearby rail stations
    const railResult = await pool.query(`
      SELECT s.atco_code, s.common_name,
             s.coordinates[0] as lon, s.coordinates[1] as lat,
             nr.tiploc_code, nr.crs_code
      FROM stops s
      JOIN national_rail nr ON nr.atco_code = s.atco_code
      WHERE s.coordinates IS NOT NULL
        AND s.atco_code LIKE '9100%'
        AND ABS(s.coordinates[0] - $1) < $3
        AND ABS(s.coordinates[1] - $2) < $3
    `, [userLon, userLat, degDelta * 3]); // Wider search for rail

    const busStops = busResult.rows.map(r => {
      const dist = haversineDistance(userLat, userLon, r.lat, r.lon);
      return {
        atco_code: r.atco_code,
        common_name: r.common_name,
        lat: r.lat, lon: r.lon,
        distance_km: Math.round(dist * 1000) / 1000,
        walk_minutes: Math.ceil(dist / 0.08),
        stop_type: 'bus'
      };
    }).filter(s => s.distance_km <= maxKm).sort((a, b) => a.distance_km - b.distance_km).slice(0, 5);

    const railStops = railResult.rows.map(r => {
      const dist = haversineDistance(userLat, userLon, r.lat, r.lon);
      return {
        atco_code: r.atco_code,
        common_name: r.common_name,
        lat: r.lat, lon: r.lon,
        tiploc_code: r.tiploc_code,
        distance_km: Math.round(dist * 1000) / 1000,
        walk_minutes: Math.ceil(dist / 0.08),
        stop_type: 'rail'
      };
    }).filter(s => s.distance_km <= maxKm * 3).sort((a, b) => a.distance_km - b.distance_km).slice(0, 3);

    res.json({ bus: busStops, rail: railStops });
  } catch (err) {
    console.error('Nearby stops error:', err.message);
    res.status(500).json({ error: 'Failed to find nearby stops' });
  }
});

// Expand a stop ATCO code into all nearby bay/platform stops (for bus stations etc.)
// Finds all stops within ~150m that have routes, plus the original stop
async function expandStopCode(atcoCode) {
  // Check if this stop itself has routes
  const hasRoutes = await pool.query(
    'SELECT 1 FROM route_stops WHERE atco_code = $1 LIMIT 1', [atcoCode]
  );
  
  // Find all nearby stops that have routes (within ~150m / 0.002 degrees)
  const nearby = await pool.query(`
    SELECT DISTINCT s2.atco_code
    FROM stops s1
    JOIN stops s2 ON s2.atco_code != s1.atco_code
      AND s2.coordinates IS NOT NULL
      AND ABS(s2.coordinates[0] - s1.coordinates[0]) < 0.002
      AND ABS(s2.coordinates[1] - s1.coordinates[1]) < 0.002
    JOIN route_stops rs ON rs.atco_code = s2.atco_code
    WHERE s1.atco_code = $1
      AND s1.coordinates IS NOT NULL
  `, [atcoCode]);

  // If the stop itself has routes and no nearby stops, just return it
  if (hasRoutes.rows.length > 0 && nearby.rows.length === 0) {
    return [atcoCode];
  }
  
  if (nearby.rows.length > 0) {
    const codes = nearby.rows.map(r => r.atco_code);
    // Also include the original code if it has routes
    if (hasRoutes.rows.length > 0 && !codes.includes(atcoCode)) {
      codes.push(atcoCode);
    }
    return codes;
  }
  
  // Fallback: just use the original code
  return [atcoCode];
}

// Find routes between two stops
app.get('/api/routes', async (req, res) => {
  try {
    const { start, end } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end ATCO codes required' });
    }
    
    // Expand StopArea codes into their constituent bay stops
    const startCodes = await expandStopCode(start);
    const endCodes = await expandStopCode(end);
    
    // Build parameter placeholders for arrays
    const startParams = startCodes.map((_, i) => `$${i + 1}`).join(',');
    const endParams = endCodes.map((_, i) => `$${startCodes.length + i + 1}`).join(',');
    const allParams = [...startCodes, ...endCodes];
    
    // Direct routes: find routes that have both a start-area stop and an end-area stop
    const directResult = await pool.query(`
      SELECT DISTINCT ON (br.route_number, br.operator_code)
        br.route_id, br.route_number, br.operator_code,
        array_agg(rs.atco_code ORDER BY rs.stop_sequence) as stops,
        array_agg(rs.travel_time_to_next ORDER BY rs.stop_sequence) as travel_times,
        SUM(COALESCE(rs.travel_time_to_next, 0)) as total_time,
        'direct' as route_type
      FROM bus_routes br
      JOIN route_stops rs ON br.route_id = rs.route_id
      WHERE br.route_id IN (
        SELECT route_id FROM route_stops WHERE atco_code IN (${startParams})
      )
      AND br.route_id IN (
        SELECT route_id FROM route_stops WHERE atco_code IN (${endParams})
      )
      GROUP BY br.route_id, br.route_number, br.operator_code
      ORDER BY br.route_number, br.operator_code
      LIMIT 10
    `, allParams);
    
    // If no direct routes, find transfer options
    let transferRoutes = [];
    if (directResult.rows.length === 0) {
      const transferResult = await pool.query(`
        SELECT DISTINCT
          br1.route_number as first_route,
          br1.operator_code as first_operator,
          br2.route_number as second_route,
          br2.operator_code as second_operator,
          rs1.atco_code as transfer_stop,
          s.common_name as transfer_name,
          'transfer' as route_type
        FROM route_stops rs_start
        JOIN route_stops rs1 ON rs_start.route_id = rs1.route_id
        JOIN route_stops rs2 ON rs1.atco_code = rs2.atco_code AND rs1.route_id != rs2.route_id
        JOIN route_stops rs_end ON rs2.route_id = rs_end.route_id
        JOIN bus_routes br1 ON rs_start.route_id = br1.route_id
        JOIN bus_routes br2 ON rs_end.route_id = br2.route_id
        JOIN stops s ON rs1.atco_code = s.atco_code
        WHERE rs_start.atco_code IN (${startParams})
        AND rs_end.atco_code IN (${endParams})
        LIMIT 10
      `, allParams);
      
      transferRoutes = transferResult.rows;
    }
    
    // Get stop details for both locations
    const stopDetails = await pool.query(
      'SELECT atco_code, common_name, coordinates FROM stops WHERE atco_code IN ($1, $2)',
      [start, end]
    );
    
    const startStop = stopDetails.rows.find(s => s.atco_code === start);
    const endStop = stopDetails.rows.find(s => s.atco_code === end);
    
    res.json({
      start: startStop,
      end: endStop,
      directRoutes: directResult.rows,
      transferOptions: transferRoutes,
      totalOptions: directResult.rows.length + transferRoutes.length,
      expandedStart: startCodes.length > 1 ? startCodes : undefined,
      expandedEnd: endCodes.length > 1 ? endCodes : undefined
    });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to find routes' });
  }
});

// Placeholder for transportation data endpoint
app.get('/api/transport', (req, res) => {
  // TODO: Fetch from database and real-time API

  res.json({
    message: 'Transportation data endpoint - to be implemented'
  });
});

// ========== RAIL ENDPOINTS ==========

// Get all rail stations in our region
app.get('/api/rail/stations', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT nr.tiploc_code, nr.crs_code, nr.stanox, nr.atco_code,
             s.common_name, s.coordinates
      FROM national_rail nr
      LEFT JOIN stops s ON nr.atco_code = s.atco_code
      WHERE nr.crs_code IS NOT NULL
      ORDER BY s.common_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch rail stations' });
  }
});

// Get live departures for a station (proxy to transport API)
app.get('/api/rail/departures/:crs', async (req, res) => {
  try {
    const { crs } = req.params;
    const https = require('https');
    const xml2js = require('xml2js');
    
    const url = `https://transport.scc.lancs.ac.uk/rail/departures/${crs.toUpperCase()}`;
    
    https.get(url, { timeout: 10000 }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        // Parse XML to JSON
        xml2js.parseString(data, { explicitArray: false, ignoreAttrs: true }, (err, result) => {
          if (err) {
            // If xml2js not available, return raw XML
            return res.type('application/xml').send(data);
          }
          
          try {
            const board = result.StationBoardWithDetails || result;
            const services = [];
            
            // Extract train services
            const trainServices = board?.['lt8:trainServices']?.['lt8:service'];
            if (trainServices) {
              const serviceList = Array.isArray(trainServices) ? trainServices : [trainServices];
              for (const svc of serviceList) {
                const origin = svc?.['lt5:origin']?.['lt4:location'];
                const dest = svc?.['lt5:destination']?.['lt4:location'];
                
                // Extract calling points
                const callingPoints = [];
                const cpList = svc?.['lt8:subsequentCallingPoints']?.['lt8:callingPointList']?.['lt8:callingPoint'];
                if (cpList) {
                  const points = Array.isArray(cpList) ? cpList : [cpList];
                  for (const cp of points) {
                    const cpCrs = cp?.['lt8:crs'] || cp?.['lt4:crs'];
                    const cpCoords = getStationCoords(cpCrs);
                    callingPoints.push({
                      name: cp?.['lt8:locationName'] || cp?.['lt4:locationName'],
                      crs: cpCrs,
                      scheduledTime: cp?.['lt8:st'] || cp?.['lt4:st'],
                      estimatedTime: cp?.['lt8:et'] || cp?.['lt4:et'],
                      lat: cpCoords?.lat || null,
                      lon: cpCoords?.lon || null,
                    });
                  }
                }
                
                const originCrs = origin?.['lt4:crs'];
                const destCrs = dest?.['lt4:crs'];
                const originCoords = getStationCoords(originCrs);
                const destCoords = getStationCoords(destCrs);
                // Also resolve the boarding station coords (the station we queried)
                const boardingCoords = getStationCoords(crs.toUpperCase());

                services.push({
                  scheduledDeparture: svc?.['lt4:std'],
                  estimatedDeparture: svc?.['lt4:etd'],
                  platform: svc?.['lt4:platform'],
                  operator: svc?.['lt4:operator'],
                  operatorCode: svc?.['lt4:operatorCode'],
                  serviceType: svc?.['lt4:serviceType'],
                  serviceId: svc?.['lt4:serviceID'],
                  origin: {
                    name: origin?.['lt4:locationName'],
                    crs: originCrs,
                    lat: originCoords?.lat || null,
                    lon: originCoords?.lon || null,
                  },
                  destination: {
                    name: dest?.['lt4:locationName'],
                    crs: destCrs,
                    lat: destCoords?.lat || null,
                    lon: destCoords?.lon || null,
                  },
                  boardingStation: {
                    crs: crs.toUpperCase(),
                    lat: boardingCoords?.lat || null,
                    lon: boardingCoords?.lon || null,
                  },
                  delayReason: svc?.['lt4:delayReason'] || null,
                  cancelReason: svc?.['lt4:cancelReason'] || null,
                  callingPoints: callingPoints
                });
              }
            }
            
            res.json({
              station: board?.['lt4:locationName'],
              crs: board?.['lt4:crs'],
              generatedAt: board?.['lt4:generatedAt'],
              messages: board?.['lt4:nrccMessages']?.['lt:message'] || [],
              services: services
            });
          } catch (parseErr) {
            // Fallback: return raw XML
            res.type('application/xml').send(data);
          }
        });
      });
    }).on('error', (err) => {
      res.status(500).json({ error: `Failed to fetch departures: ${err.message}` });
    }).on('timeout', function() {
      this.destroy();
      res.status(500).json({ error: 'Rail departures API timed out' });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch departures' });
  }
});

// Get station facilities
app.get('/api/rail/facilities/:crs', async (req, res) => {
  try {
    const { crs } = req.params;
    const https = require('https');
    
    const url = `https://transport.scc.lancs.ac.uk/rail/facilities/${crs.toUpperCase()}`;
    
    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          res.json(JSON.parse(data));
        } catch {
          res.status(500).json({ error: 'Failed to parse facilities data' });
        }
      });
    }).on('error', (err) => {
      res.status(500).json({ error: `Failed to fetch facilities: ${err.message}` });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch facilities' });
  }
});

// Find rail routes between two stations
app.get('/api/rail/routes', async (req, res) => {
  try {
    const { start, end } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end CRS codes or ATCO codes required' });
    }
    
    // Resolve CRS codes or ATCO codes to TIPLOCs
    let startTiplocs, endTiplocs;
    
    if (start.length === 3 && start === start.toUpperCase()) {
      // It's a CRS code
      const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE crs_code = $1', [start]);
      startTiplocs = r.rows.map(r => r.tiploc_code);
    } else {
      // It's an ATCO code - find the TIPLOC
      const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [start]);
      startTiplocs = r.rows.map(r => r.tiploc_code);
      // Also try nearby rail station ATCO codes
      if (startTiplocs.length === 0) {
        const r2 = await pool.query(`
          SELECT nr.tiploc_code FROM national_rail nr
          JOIN stops s1 ON nr.atco_code = s1.atco_code
          JOIN stops s2 ON ABS(s1.coordinates[0] - s2.coordinates[0]) < 0.005
                       AND ABS(s1.coordinates[1] - s2.coordinates[1]) < 0.005
          WHERE s2.atco_code = $1 AND s1.coordinates IS NOT NULL AND s2.coordinates IS NOT NULL
        `, [start]);
        startTiplocs = r2.rows.map(r => r.tiploc_code);
      }
    }
    
    if (end.length === 3 && end === end.toUpperCase()) {
      const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE crs_code = $1', [end]);
      endTiplocs = r.rows.map(r => r.tiploc_code);
    } else {
      const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [end]);
      endTiplocs = r.rows.map(r => r.tiploc_code);
      if (endTiplocs.length === 0) {
        const r2 = await pool.query(`
          SELECT nr.tiploc_code FROM national_rail nr
          JOIN stops s1 ON nr.atco_code = s1.atco_code
          JOIN stops s2 ON ABS(s1.coordinates[0] - s2.coordinates[0]) < 0.005
                       AND ABS(s1.coordinates[1] - s2.coordinates[1]) < 0.005
          WHERE s2.atco_code = $1 AND s1.coordinates IS NOT NULL AND s2.coordinates IS NOT NULL
        `, [end]);
        endTiplocs = r2.rows.map(r => r.tiploc_code);
      }
    }
    
    if (startTiplocs.length === 0 || endTiplocs.length === 0) {
      return res.json({ trains: [], error: 'Could not resolve station codes' });
    }
    
    // Find trains that call at both start and end stations (in the right order)
    const startPlaceholders = startTiplocs.map((_, i) => `$${i + 1}`).join(',');
    const endPlaceholders = endTiplocs.map((_, i) => `$${startTiplocs.length + i + 1}`).join(',');
    const params = [...startTiplocs, ...endTiplocs];
    
    const result = await pool.query(`
      SELECT DISTINCT
        rs.train_uid,
        rs.operator_code,
        o.name as operator_name,
        sp1.tiploc_code as start_tiploc,
        nr1.crs_code as start_crs,
        s1.common_name as start_name,
        sp1.departure_time,
        sp2.tiploc_code as end_tiploc,
        nr2.crs_code as end_crs,
        s2.common_name as end_name,
        sp2.arrival_time,
        sp2.sequence_order - sp1.sequence_order as num_stops,
        'rail' as mode
      FROM schedule_points sp1
      JOIN schedule_points sp2 ON sp1.train_uid = sp2.train_uid
        AND sp2.sequence_order > sp1.sequence_order
      JOIN rail_schedule rs ON sp1.train_uid = rs.train_uid
      LEFT JOIN operators o ON rs.operator_code = o.operator_code
      JOIN national_rail nr1 ON sp1.tiploc_code = nr1.tiploc_code
      JOIN national_rail nr2 ON sp2.tiploc_code = nr2.tiploc_code
      LEFT JOIN stops s1 ON nr1.atco_code = s1.atco_code
      LEFT JOIN stops s2 ON nr2.atco_code = s2.atco_code
      WHERE sp1.tiploc_code IN (${startPlaceholders})
      AND sp2.tiploc_code IN (${endPlaceholders})
      AND sp1.departure_time IS NOT NULL
      ORDER BY sp1.departure_time
      LIMIT 20
    `, params);
    
    // Get intermediate stops for each train
    const trains = [];
    for (const row of result.rows) {
      // Get calling points between start and end
      const stopsResult = await pool.query(`
        SELECT sp.tiploc_code, nr.crs_code, s.common_name,
               sp.arrival_time, sp.departure_time, sp.sequence_order
        FROM schedule_points sp
        JOIN national_rail nr ON sp.tiploc_code = nr.tiploc_code
        LEFT JOIN stops s ON nr.atco_code = s.atco_code
        WHERE sp.train_uid = $1
        AND sp.sequence_order >= (SELECT sequence_order FROM schedule_points WHERE train_uid = $1 AND tiploc_code = $2 LIMIT 1)
        AND sp.sequence_order <= (SELECT sequence_order FROM schedule_points WHERE train_uid = $1 AND tiploc_code = $3 LIMIT 1)
        AND (sp.arrival_time IS NOT NULL OR sp.departure_time IS NOT NULL)
        ORDER BY sp.sequence_order
      `, [row.train_uid, row.start_tiploc, row.end_tiploc]);
      
      trains.push({
        trainUid: row.train_uid,
        operator: row.operator_code,
        operatorName: row.operator_name,
        departure: row.departure_time,
        arrival: row.arrival_time,
        startStation: row.start_name,
        startCrs: row.start_crs,
        endStation: row.end_name,
        endCrs: row.end_crs,
        numStops: row.num_stops,
        mode: 'rail',
        callingPoints: stopsResult.rows.map(s => ({
          tiploc: s.tiploc_code,
          crs: s.crs_code,
          name: s.common_name,
          arrival: s.arrival_time,
          departure: s.departure_time
        }))
      });
    }
    
    res.json({
      start: start,
      end: end,
      trains: trains,
      totalTrains: trains.length
    });
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to find rail routes' });
  }
});

// Get delay codes
app.get('/api/rail/delay-codes', async (req, res) => {
  try {
    const https = require('https');
    const url = 'https://transport.scc.lancs.ac.uk/rail/delay-codes.json';
    
    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          res.json(JSON.parse(data));
        } catch {
          res.status(500).json({ error: 'Failed to parse delay codes' });
        }
      });
    }).on('error', (err) => {
      res.status(500).json({ error: `Failed to fetch delay codes: ${err.message}` });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch delay codes' });
  }
});

// ========== BUS TIMETABLE ENDPOINTS ==========

// Get bus departures from a specific stop
app.get('/api/bus/departures/:atco', async (req, res) => {
  try {
    const { atco } = req.params;
    const { day, from, limit } = req.query;

    // day: 0=Mon .. 6=Sun (defaults to today)
    const dayOfWeek = day !== undefined ? parseInt(day) : (new Date().getDay() + 6) % 7;
    const dayPosition = dayOfWeek + 1; // 1-indexed position in days_of_week string
    const fromTime = from || '00:00:00';
    const maxResults = Math.min(parseInt(limit) || 20, 50);

    // Expand to nearby stops (same logic as expandStopCode for bus stations)
    const expandedStops = await expandStopCode(atco);
    const atcoCodes = expandedStops.length > 0 ? expandedStops : [atco];

    const placeholders = atcoCodes.map((_, i) => `$${i + 1}`).join(',');

    const result = await pool.query(`
      SELECT bjs.departure_time, bjs.arrival_time, bjs.atco_code,
             s.common_name as stop_name,
             bj.journey_id, bj.route_number, bj.operator_code, bj.direction,
             bj.days_of_week, bj.valid_from, bj.valid_until,
             o.name as operator_name,
             bj.route_id
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

    // For each departure, get the destination (last stop of the journey)
    const departures = [];
    for (const row of result.rows) {
      // Get destination
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
      departures: departures,
      totalDepartures: departures.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bus departures' });
  }
});

// Get full journey details (all stops with times)
app.get('/api/bus/journey/:journeyId', async (req, res) => {
  try {
    const { journeyId } = req.params;

    // Get journey info
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

    // Get all stops
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
        sequence: s.stop_sequence,
        atco: s.atco_code,
        name: s.common_name,
        coordinates: s.coordinates,
        arrival: s.arrival_time,
        departure: s.departure_time,
        activity: s.activity
      }))
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch journey details' });
  }
});

// ========== MULTI-MODAL JOURNEY PLANNER ==========

/**
 * Find nearby rail stations within walking distance of a stop.
 * Returns array of { tiploc_code, crs_code, atco_code, common_name, walk_km, walk_minutes }
 */
async function findNearbyRailStations(atcoCode, maxDistKm = 2.0) {
  const result = await pool.query(`
    SELECT nr.tiploc_code, nr.crs_code, nr.atco_code as rail_atco,
           s_rail.common_name as rail_name,
           s_rail.coordinates[0] as rail_lon, s_rail.coordinates[1] as rail_lat,
           s_stop.coordinates[0] as stop_lon, s_stop.coordinates[1] as stop_lat
    FROM stops s_stop
    JOIN stops s_rail ON s_rail.atco_code LIKE '9100%'
      AND ABS(s_rail.coordinates[0] - s_stop.coordinates[0]) < 0.06
      AND ABS(s_rail.coordinates[1] - s_stop.coordinates[1]) < 0.06
    JOIN national_rail nr ON nr.atco_code = s_rail.atco_code
    WHERE s_stop.atco_code = $1
      AND s_stop.coordinates IS NOT NULL
      AND s_rail.coordinates IS NOT NULL
      AND nr.crs_code IS NOT NULL
  `, [atcoCode]);

  return result.rows
    .map(r => {
      const dist = haversineDistance(r.stop_lat, r.stop_lon, r.rail_lat, r.rail_lon);
      return {
        tiploc_code: r.tiploc_code,
        crs_code: r.crs_code,
        atco_code: r.rail_atco,
        common_name: r.rail_name,
        walk_km: Math.round(dist * 1000) / 1000,
        walk_minutes: Math.ceil(dist / 0.08) // ~5 km/h walking speed = 0.083 km/min
      };
    })
    .filter(r => r.walk_km <= maxDistKm)
    .sort((a, b) => a.walk_km - b.walk_km);
}

/**
 * Find bus stops near a given stop (within walking distance).
 * Returns stops that have bus journey services.
 */
async function findNearbyBusStops(atcoCode, maxDistKm = 0.8) {
  const result = await pool.query(`
    SELECT DISTINCT s2.atco_code, s2.common_name,
           s2.coordinates[0] as lon, s2.coordinates[1] as lat,
           s1.coordinates[0] as origin_lon, s1.coordinates[1] as origin_lat
    FROM stops s1
    JOIN stops s2 ON s2.atco_code != s1.atco_code
      AND s2.coordinates IS NOT NULL
      AND ABS(s2.coordinates[0] - s1.coordinates[0]) < 0.012
      AND ABS(s2.coordinates[1] - s1.coordinates[1]) < 0.012
    WHERE s1.atco_code = $1
      AND s1.coordinates IS NOT NULL
      AND s2.atco_code NOT LIKE '9100%'
      AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s2.atco_code LIMIT 1)
  `, [atcoCode]);

  return result.rows
    .map(r => {
      const dist = haversineDistance(r.origin_lat, r.origin_lon, r.lat, r.lon);
      return {
        atco_code: r.atco_code,
        common_name: r.common_name,
        walk_km: Math.round(dist * 1000) / 1000,
        walk_minutes: Math.ceil(dist / 0.08)
      };
    })
    .filter(r => r.walk_km <= maxDistKm)
    .sort((a, b) => a.walk_km - b.walk_km);
}

/**
 * Find rail stations reachable by direct bus from a given stop.
 * Instead of walking distance, this finds stations where a bus route connects
 * the origin stop to a bus stop near the rail station.
 * Returns array of { tiploc_code, crs_code, atco_code, common_name, bus_stop_atco, bus_stop_name }
 */
async function findBusReachableRailStations(atcoCode, dayIndex, departAfter, limit = 5) {
  const expandedCodes = await expandStopCode(atcoCode);
  const placeholders = expandedCodes.map((_, i) => `$${i + 1}`).join(',');
  const dayPos = dayIndex + 1;

  console.log(`[findBusReachableRailStations] atco=${atcoCode} expanded=${expandedCodes.length} day=${dayPos} after=${departAfter} limit=${limit}`);

  // Find rail stations where a bus journey from the origin stop also stops
  // at a bus stop near the rail station (within ~300m / 0.004 degrees)
  const result = await pool.query(`
    SELECT DISTINCT ON (nr.tiploc_code)
      nr.tiploc_code, nr.crs_code, nr.atco_code as rail_atco,
      s_rail.common_name as rail_name,
      s_rail.coordinates[0] as rail_lon, s_rail.coordinates[1] as rail_lat,
      bjs_near.atco_code as bus_stop_atco,
      s_bus.common_name as bus_stop_name,
      MIN(bjs_origin.departure_time) as earliest_bus,
      MIN(bjs_near.arrival_time) as earliest_arrival
    FROM bus_journey_stops bjs_origin
    JOIN bus_journeys bj ON bjs_origin.journey_id = bj.journey_id
    JOIN bus_journey_stops bjs_near ON bj.journey_id = bjs_near.journey_id
      AND bjs_near.stop_sequence > bjs_origin.stop_sequence
    JOIN stops s_bus ON bjs_near.atco_code = s_bus.atco_code
    JOIN stops s_rail ON s_rail.atco_code LIKE '9100%'
      AND s_rail.coordinates IS NOT NULL
      AND ABS(s_rail.coordinates[0] - s_bus.coordinates[0]) < 0.004
      AND ABS(s_rail.coordinates[1] - s_bus.coordinates[1]) < 0.004
    JOIN national_rail nr ON nr.atco_code = s_rail.atco_code
    WHERE bjs_origin.atco_code IN (${placeholders})
      AND SUBSTRING(bj.days_of_week FROM ${dayPos} FOR 1) = '1'
      AND bjs_origin.departure_time >= $${expandedCodes.length + 1}::time
      AND nr.crs_code IS NOT NULL
      AND s_bus.coordinates IS NOT NULL
    GROUP BY nr.tiploc_code, nr.crs_code, nr.atco_code,
             s_rail.common_name, s_rail.coordinates[0], s_rail.coordinates[1],
             bjs_near.atco_code, s_bus.common_name
    ORDER BY nr.tiploc_code, MIN(bjs_near.arrival_time)
    LIMIT $${expandedCodes.length + 2}
  `, [...expandedCodes, departAfter, limit * 2]);

  console.log(`[findBusReachableRailStations] found=${result.rows.length} tiplocs=${result.rows.map(r => r.tiploc_code).join(',')}`);
  
  return result.rows.map(r => ({
    tiploc_code: r.tiploc_code,
    crs_code: r.crs_code,
    atco_code: r.rail_atco,
    common_name: r.rail_name,
    bus_stop_atco: r.bus_stop_atco,
    bus_stop_name: r.bus_stop_name,
    earliest_bus: r.earliest_bus,
    earliest_arrival: r.earliest_arrival
  }));
}

/**
 * Parse a time string "HH:MM" or "HH:MM:SS" to minutes since midnight.
 */
function timeToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.toString().split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * Format minutes since midnight to "HH:MM".
 * Wraps around midnight (e.g. 1456 → "00:16" not "24:16").
 */
function minutesToTime(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440; // handle negatives too
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Get the day-of-week index (0=Mon..6=Sun) from a day parameter or current time.
 */
function getDayIndex(day) {
  if (day !== undefined && day !== null) {
    // Support both numeric index and day name
    const num = parseInt(day);
    if (!isNaN(num)) return num;
    const names = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
    const idx = names[String(day).toLowerCase()];
    if (idx !== undefined) return idx;
  }
  return (new Date().getDay() + 6) % 7; // JS: 0=Sun, convert to 0=Mon
}

/**
 * Find direct bus journeys between two stops.
 */
async function findDirectBusJourneys(startAtco, endAtco, departAfter, dayIndex, limit = 5) {
  const startCodes = await expandStopCode(startAtco);
  const endCodes = await expandStopCode(endAtco);
  const dayPos = dayIndex + 1;

  const sPlaceholders = startCodes.map((_, i) => `$${i + 1}`).join(',');
  const ePlaceholders = endCodes.map((_, i) => `$${startCodes.length + i + 1}`).join(',');

  const result = await pool.query(`
    SELECT bj.journey_id, bj.route_number, bj.operator_code, bj.direction,
           o.name as operator_name,
           bjs1.atco_code as board_atco, s1.common_name as board_name,
           bjs1.departure_time as board_time,
           bjs2.atco_code as alight_atco, s2.common_name as alight_name,
           bjs2.arrival_time as alight_time,
           bjs2.stop_sequence - bjs1.stop_sequence as num_stops
    FROM bus_journeys bj
    JOIN bus_journey_stops bjs1 ON bj.journey_id = bjs1.journey_id
      AND bjs1.atco_code IN (${sPlaceholders})
    JOIN bus_journey_stops bjs2 ON bj.journey_id = bjs2.journey_id
      AND bjs2.atco_code IN (${ePlaceholders})
      AND bjs2.stop_sequence > bjs1.stop_sequence
    JOIN stops s1 ON bjs1.atco_code = s1.atco_code
    JOIN stops s2 ON bjs2.atco_code = s2.atco_code
    LEFT JOIN operators o ON bj.operator_code = o.operator_code
    WHERE SUBSTRING(bj.days_of_week FROM ${dayPos} FOR 1) = '1'
      AND bjs1.departure_time >= $${startCodes.length + endCodes.length + 1}::time
    ORDER BY bjs1.departure_time
    LIMIT $${startCodes.length + endCodes.length + 2}
  `, [...startCodes, ...endCodes, departAfter, limit]);

  return result.rows.map(r => ({
    type: 'bus',
    journeyId: r.journey_id,
    routeNumber: r.route_number,
    operator: r.operator_code,
    operatorName: r.operator_name,
    direction: r.direction,
    boardAtco: r.board_atco,
    boardName: r.board_name,
    boardTime: r.board_time,
    alightAtco: r.alight_atco,
    alightName: r.alight_name,
    alightTime: r.alight_time,
    numStops: r.num_stops
  }));
}

/**
 * Find direct train journeys between two TIPLOCs.
 */
async function findDirectTrainJourneys(startTiplocs, endTiplocs, departAfter, limit = 5) {
  if (!startTiplocs.length || !endTiplocs.length) return [];

  const sPlaceholders = startTiplocs.map((_, i) => `$${i + 1}`).join(',');
  const ePlaceholders = endTiplocs.map((_, i) => `$${startTiplocs.length + i + 1}`).join(',');

  const result = await pool.query(`
    SELECT rs.train_uid, rs.operator_code, o.name as operator_name,
           sp1.tiploc_code as start_tiploc, nr1.crs_code as start_crs,
           s1.common_name as start_name,
           sp1.departure_time,
           sp2.tiploc_code as end_tiploc, nr2.crs_code as end_crs,
           s2.common_name as end_name,
           sp2.arrival_time,
           sp2.sequence_order - sp1.sequence_order as num_stops
    FROM schedule_points sp1
    JOIN schedule_points sp2 ON sp1.train_uid = sp2.train_uid
      AND sp2.sequence_order > sp1.sequence_order
    JOIN rail_schedule rs ON sp1.train_uid = rs.train_uid
    LEFT JOIN operators o ON rs.operator_code = o.operator_code
    JOIN national_rail nr1 ON sp1.tiploc_code = nr1.tiploc_code
    JOIN national_rail nr2 ON sp2.tiploc_code = nr2.tiploc_code
    LEFT JOIN stops s1 ON nr1.atco_code = s1.atco_code
    LEFT JOIN stops s2 ON nr2.atco_code = s2.atco_code
    WHERE sp1.tiploc_code IN (${sPlaceholders})
      AND sp2.tiploc_code IN (${ePlaceholders})
      AND sp1.departure_time IS NOT NULL
      AND sp1.departure_time >= $${startTiplocs.length + endTiplocs.length + 1}::time
    ORDER BY sp1.departure_time
    LIMIT $${startTiplocs.length + endTiplocs.length + 2}
  `, [...startTiplocs, ...endTiplocs, departAfter, limit]);

  return result.rows.map(r => ({
    type: 'train',
    trainUid: r.train_uid,
    operator: r.operator_code,
    operatorName: r.operator_name,
    startTiploc: r.start_tiploc,
    startCrs: r.start_crs,
    boardName: r.start_name,
    boardTime: r.departure_time,
    endTiploc: r.end_tiploc,
    endCrs: r.end_crs,
    alightName: r.end_name,
    alightTime: r.arrival_time,
    numStops: r.num_stops
  }));
}

/**
 * Find connecting train journeys (train A → transfer → train B).
 */
async function findTrainTrainConnections(startTiplocs, endTiplocs, departAfter, limit = 5) {
  if (!startTiplocs.length || !endTiplocs.length) return [];

  // Get all TIPLOC codes that could serve as transfer points
  const sPlaceholders = startTiplocs.map((_, i) => `$${i + 1}`).join(',');
  const ePlaceholders = endTiplocs.map((_, i) => `$${startTiplocs.length + i + 1}`).join(',');

  const result = await pool.query(`
    SELECT
      t1.train_uid as train1_uid, t1.operator_code as train1_operator, o1.name as train1_operator_name,
      sp1.tiploc_code as start_tiploc, nr1.crs_code as start_crs, s1.common_name as start_name,
      sp1.departure_time as train1_depart,
      sp2.tiploc_code as transfer_tiploc, nr_t.crs_code as transfer_crs, s_t.common_name as transfer_name,
      sp2.arrival_time as train1_arrive,
      t2.train_uid as train2_uid, t2.operator_code as train2_operator, o2.name as train2_operator_name,
      sp3.departure_time as train2_depart,
      sp4.tiploc_code as end_tiploc, nr2.crs_code as end_crs, s2.common_name as end_name,
      sp4.arrival_time as train2_arrive
    FROM schedule_points sp1
    JOIN schedule_points sp2 ON sp1.train_uid = sp2.train_uid
      AND sp2.sequence_order > sp1.sequence_order
    JOIN rail_schedule t1 ON sp1.train_uid = t1.train_uid
    LEFT JOIN operators o1 ON t1.operator_code = o1.operator_code
    JOIN schedule_points sp3 ON sp3.tiploc_code = sp2.tiploc_code
      AND sp3.train_uid != sp1.train_uid
      AND sp3.departure_time >= sp2.arrival_time + INTERVAL '3 minutes'
      AND sp3.departure_time <= sp2.arrival_time + INTERVAL '60 minutes'
    JOIN schedule_points sp4 ON sp3.train_uid = sp4.train_uid
      AND sp4.sequence_order > sp3.sequence_order
    JOIN rail_schedule t2 ON sp3.train_uid = t2.train_uid
    LEFT JOIN operators o2 ON t2.operator_code = o2.operator_code
    JOIN national_rail nr1 ON sp1.tiploc_code = nr1.tiploc_code
    JOIN national_rail nr_t ON sp2.tiploc_code = nr_t.tiploc_code
    JOIN national_rail nr2 ON sp4.tiploc_code = nr2.tiploc_code
    LEFT JOIN stops s1 ON nr1.atco_code = s1.atco_code
    LEFT JOIN stops s_t ON nr_t.atco_code = s_t.atco_code
    LEFT JOIN stops s2 ON nr2.atco_code = s2.atco_code
    WHERE sp1.tiploc_code IN (${sPlaceholders})
      AND sp4.tiploc_code IN (${ePlaceholders})
      AND sp1.departure_time IS NOT NULL
      AND sp1.departure_time >= $${startTiplocs.length + endTiplocs.length + 1}::time
    ORDER BY sp1.departure_time, sp3.departure_time
    LIMIT $${startTiplocs.length + endTiplocs.length + 2}
  `, [...startTiplocs, ...endTiplocs, departAfter, limit * 3]);

  // Deduplicate by picking the best connection for each first train
  const seen = new Set();
  const connections = [];
  for (const r of result.rows) {
    const key = `${r.train1_uid}→${r.train2_uid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    connections.push({
      legs: [
        {
          type: 'train',
          trainUid: r.train1_uid,
          operator: r.train1_operator,
          operatorName: r.train1_operator_name,
          boardName: r.start_name,
          boardTime: r.train1_depart,
          alightName: r.transfer_name,
          alightTime: r.train1_arrive,
          startTiploc: r.start_tiploc,
          startCrs: r.start_crs,
          endTiploc: r.transfer_tiploc,
          endCrs: r.transfer_crs
        },
        {
          type: 'transfer',
          station: r.transfer_name,
          crs: r.transfer_crs,
          waitMinutes: safeDuration(r.train1_arrive, r.train2_depart)
        },
        {
          type: 'train',
          trainUid: r.train2_uid,
          operator: r.train2_operator,
          operatorName: r.train2_operator_name,
          boardName: r.transfer_name,
          boardTime: r.train2_depart,
          alightName: r.end_name,
          alightTime: r.train2_arrive,
          startTiploc: r.transfer_tiploc,
          startCrs: r.transfer_crs,
          endTiploc: r.end_tiploc,
          endCrs: r.end_crs
        }
      ]
    });
    if (connections.length >= limit) break;
  }
  return connections;
}

/**
 * Find bus journeys TO/FROM a rail station area for multi-modal connections.
 */
async function findBusRailConnections(busAtco, railAtco, departAfter, dayIndex, direction, limit = 3) {
  // Find bus stops near the rail station (within 800m)
  const nearbyBusStops = await findNearbyBusStops(railAtco, 0.8);
  if (nearbyBusStops.length === 0) return [];

  const busStopCodes = nearbyBusStops.map(s => s.atco_code);
  const startCodes = await expandStopCode(busAtco);

  if (direction === 'bus_to_rail') {
    // Bus from origin → near rail station
    return findDirectBusJourneys(busAtco, busStopCodes[0], departAfter, dayIndex, limit);
  } else {
    // Bus from near rail station → destination
    const results = [];
    for (const busStop of busStopCodes.slice(0, 5)) {
      const journeys = await findDirectBusJourneys(busStop, busAtco, departAfter, dayIndex, 2);
      results.push(...journeys);
    }
    return results.sort((a, b) => timeToMinutes(a.boardTime) - timeToMinutes(b.boardTime)).slice(0, limit);
  }
}

// Main journey planner endpoint
/**
 * Enrich all route legs with from/to coordinates so the frontend can draw polylines.
 * Resolves ATCO codes (bus stops) and CRS codes (rail stations) to lat/lon.
 */
async function enrichLegsWithCoordinates(allRoutes, startStop, endStop) {
  // Collect all ATCO codes and CRS codes referenced by legs
  const atcoCodes = new Set();
  const crsCodes = new Set();

  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.boardAtco) atcoCodes.add(leg.boardAtco);
      if (leg.alightAtco) atcoCodes.add(leg.alightAtco);
      if (leg.atco) atcoCodes.add(leg.atco);
      if (leg.fromAtco) atcoCodes.add(leg.fromAtco);
      if (leg.toAtco) atcoCodes.add(leg.toAtco);
      if (leg.startCrs) crsCodes.add(leg.startCrs);
      if (leg.endCrs) crsCodes.add(leg.endCrs);
      if (leg.crs) crsCodes.add(leg.crs);
    }
  }

  // Build coordinate lookup map
  const coordMap = {};
  coordMap[startStop.atco_code] = { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) };
  coordMap[endStop.atco_code] = { lat: parseFloat(endStop.lat), lon: parseFloat(endStop.lon) };

  // Resolve bus stop coordinates by ATCO code
  if (atcoCodes.size > 0) {
    const codes = [...atcoCodes];
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT atco_code, coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code IN (${placeholders})`,
      codes
    );
    for (const row of result.rows) {
      coordMap[row.atco_code] = { lat: parseFloat(row.lat), lon: parseFloat(row.lon) };
    }
  }

  // Resolve rail station coordinates by CRS code
  if (crsCodes.size > 0) {
    const codes = [...crsCodes];
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(',');
    const result = await pool.query(
      `SELECT nr.crs_code, nr.atco_code, s.coordinates[0] as lon, s.coordinates[1] as lat
       FROM national_rail nr JOIN stops s ON nr.atco_code = s.atco_code
       WHERE nr.crs_code IN (${placeholders})`,
      codes
    );
    for (const row of result.rows) {
      coordMap[`crs:${row.crs_code}`] = { lat: parseFloat(row.lat), lon: parseFloat(row.lon) };
      coordMap[row.atco_code] = { lat: parseFloat(row.lat), lon: parseFloat(row.lon) };
    }
  }

  // Apply coordinates to each leg
  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.type === 'bus') {
        leg.fromCoords = coordMap[leg.boardAtco] || null;
        leg.toCoords = coordMap[leg.alightAtco] || null;
      } else if (leg.type === 'train') {
        leg.fromCoords = coordMap[`crs:${leg.startCrs}`] || null;
        leg.toCoords = coordMap[`crs:${leg.endCrs}`] || null;
      } else if (leg.type === 'transfer') {
        const coords = coordMap[`crs:${leg.crs}`] || coordMap[leg.atco] || null;
        leg.fromCoords = coords;
        leg.toCoords = coords;
      }
    }

    // Resolve walk legs using context from adjacent legs or start/end stops
    for (let i = 0; i < route.legs.length; i++) {
      const leg = route.legs[i];
      if (leg.type !== 'walk') continue;

      // Skip if coords already set (e.g. start/end walk legs from coordinate resolution)
      if (leg.fromCoords && leg.toCoords) continue;

      // fromCoords: if first leg use startStop, otherwise use previous leg's toCoords
      if (!leg.fromCoords) {
        if (i === 0) {
          leg.fromCoords = coordMap[startStop.atco_code];
        } else {
          const prevLeg = route.legs[i - 1];
          leg.fromCoords = prevLeg.toCoords || null;
        }
      }

      // toCoords: if last leg use endStop, otherwise use next leg's fromCoords
      if (!leg.toCoords) {
        if (i === route.legs.length - 1) {
          leg.toCoords = coordMap[endStop.atco_code];
        } else {
          const nextLeg = route.legs[i + 1];
          leg.toCoords = nextLeg.fromCoords || null;
        }
      }

      // Fallback: try to find coords by walk leg's fromAtco/toAtco if provided
      if (!leg.fromCoords && leg.fromAtco) {
        leg.fromCoords = coordMap[leg.fromAtco] || null;
      }
      if (!leg.toCoords && leg.toAtco) {
        leg.toCoords = coordMap[leg.toAtco] || null;
      }
    }
  }
}

/**
 * Decode an encoded polyline string from Valhalla.
 * Valhalla uses precision 6 (1e6) by default, unlike Google's precision 5.
 * Returns an array of [lat, lon] pairs.
 */
function decodeValhallaPolyline(encoded, precision = 6) {
  const factor = Math.pow(10, precision);
  const points = [];
  let lat = 0, lon = 0, index = 0;

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
    lon += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push([lat / factor, lon / factor]);
  }
  return points;
}

/**
 * Fetch walking/driving geometry from Valhalla (valhalla1.openstreetmap.de).
 * Returns an array of [lat, lon] coordinate pairs following actual footpaths/roads.
 * Falls back to null if service is unreachable. Includes retry on rate limit.
 */
async function fetchValhallaGeometry(fromLat, fromLon, toLat, toLon, costing = 'pedestrian') {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const requestBody = JSON.stringify({
        locations: [
          { lat: fromLat, lon: fromLon },
          { lat: toLat, lon: toLon }
        ],
        costing: costing,
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
              // HTML response means rate limit — return 'retry' sentinel
              resolve('retry');
            }
          });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', function() { this.destroy(); resolve(null); });
        req.write(requestBody);
        req.end();
      });

      if (result === 'retry' && attempt === 0) {
        await delay(500); // Wait and retry
        continue;
      }
      if (result === 'retry') return null;
      return result;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Fetch road-following geometry from OSRM for a set of waypoints (legacy fallback).
 * Returns an array of [lat, lon] coordinate pairs.
 * profile: 'driving' for bus/car routes, 'foot' for walking
 * Falls back to null if OSRM is unreachable (e.g. on restricted networks).
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
        .on('timeout', function() { this.destroy(); resolve(null); });
    });
  } catch {
    return null;
  }
}

/**
 * Calculate bearing (compass heading) in degrees from point A to point B.
 * Returns 0-360 where 0=North, 90=East, 180=South, 270=West.
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
            Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Fetch road-following geometry from Valhalla for a bus route.
 * Uses a HYBRID approach:
 * - Groups consecutive close stops (<2km apart) into multi-waypoint requests
 * - Routes each group as a single Valhalla request with heading constraints
 * This balances accuracy (correct roads) with performance (fewer API calls).
 *
 * Waypoints: array of { lat, lon } objects (bus stop positions in order).
 * Returns array of [lat, lon] pairs forming the full road-snapped route, or null.
 */
async function fetchValhallaBusGeometry(waypoints) {
  if (!waypoints || waypoints.length < 2) return null;

  // Split waypoints into groups where each consecutive pair is <2km apart.
  // When there's a gap >2km, start a new group — this forces a clean segment
  // boundary so Valhalla can't take a shortcut via the wrong road.
  const GAP_THRESHOLD_KM = 2.0;
  const groups = []; // each group is an array of waypoints
  let currentGroup = [waypoints[0]];

  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];
    const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);

    if (dist > GAP_THRESHOLD_KM) {
      // Big gap — close current group and start a new one at curr
      currentGroup.push(curr); // include curr as end of this group
      groups.push(currentGroup);
      currentGroup = [curr]; // start new group from curr
    } else {
      currentGroup.push(curr);
    }
  }
  if (currentGroup.length >= 2) {
    groups.push(currentGroup);
  } else if (groups.length > 0 && currentGroup.length === 1) {
    // Lone trailing point — append to last group
    groups[groups.length - 1].push(currentGroup[0]);
  }

  // Route each group as a single Valhalla multi-waypoint request
  const allPoints = [];
  const GROUP_BATCH = 3; // process up to 3 groups in parallel

  for (let gb = 0; gb < groups.length; gb += GROUP_BATCH) {
    const batch = groups.slice(gb, gb + GROUP_BATCH);

    const results = await Promise.allSettled(batch.map(async (group) => {
      // Build locations with heading constraints
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

      // Try bus costing, fall back to auto
      for (const costing of ['bus', 'auto']) {
        const requestBody = JSON.stringify({
          locations,
          costing,
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
          req.on('timeout', function() { this.destroy(); resolve(null); });
          req.write(requestBody);
          req.end();
        });

        if (geo && geo.length >= 2) return geo;
      }
      return null; // both costings failed
    }));

    // Stitch group results in order
    for (const result of results) {
      const geo = result.status === 'fulfilled' ? result.value : null;
      if (geo && geo.length >= 2) {
        if (allPoints.length > 0) geo.shift(); // remove duplicate junction
        allPoints.push(...geo);
      }
    }

    if (gb + GROUP_BATCH < groups.length) {
      await delay(100);
    }
  }

  return allPoints.length >= 2 ? allPoints : null;
}

/**
 * Get intermediate stop coordinates for a bus journey to use as polyline waypoints.
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
 * Get intermediate stop coordinates for a train journey using calling points.
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

/**
 * Simple delay helper for rate limiting.
 */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Persistent in-memory cache for Valhalla walk geometry.
 * Key: "fromLat,fromLon:toLat,toLon" (rounded to 4dp ~11m)
 * Value: array of [lat, lon] points, or null if request failed.
 * Entries expire after 1 hour.
 */
const valhallaGeoCache = new Map();
const VALHALLA_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Persistent in-memory cache for Valhalla bus route geometry.
 * Key: "journeyId:boardAtco:alightAtco"
 * Value: array of [lat, lon] points, or null if request failed.
 */
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
  // Prune cache if too large
  if (valhallaGeoCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of valhallaGeoCache) {
      if (now - v.time > VALHALLA_CACHE_TTL) valhallaGeoCache.delete(k);
    }
  }
}

/**
 * Merge consecutive walk legs in each route into a single walk leg.
 * This handles the case where a place-based walk (e.g. city centre → bus stop)
 * is followed by a strategy-generated walk (e.g. bus stop → rail station),
 * producing one clean walk leg (city centre → rail station) instead of two.
 * Geometry is cleared on merged legs so Valhalla can re-route the full path.
 */
function mergeConsecutiveWalkLegs(allRoutes) {
  for (const route of allRoutes) {
    let i = 0;
    while (i < route.legs.length - 1) {
      if (route.legs[i].type === 'walk' && route.legs[i + 1].type === 'walk') {
        const leg1 = route.legs[i];
        const leg2 = route.legs[i + 1];

        // Recalculate distance from actual coords if available
        let mergedDistance = (leg1.distance_km || 0) + (leg2.distance_km || 0);
        let mergedDuration = (leg1.duration || 0) + (leg2.duration || 0);
        const fromCoords = leg1.fromCoords || null;
        const toCoords = leg2.toCoords || null;

        if (fromCoords && toCoords) {
          // Use direct haversine for a better estimate (actual walk will be fetched by Valhalla)
          const directDist = haversineDistance(fromCoords.lat, fromCoords.lon, toCoords.lat, toCoords.lon);
          mergedDistance = Math.round(directDist * 1000) / 1000;
          mergedDuration = Math.ceil(directDist / 0.08); // ~5 km/h
        }

        const merged = {
          type: 'walk',
          fromName: leg1.fromName,
          toName: leg2.toName,
          fromCoords: fromCoords,
          toCoords: toCoords,
          duration: mergedDuration,
          distance_km: mergedDistance,
          geometry: null // Clear geometry so Valhalla fetches the optimal full-path route
        };

        // Adjust the route's total duration: remove old durations, add merged
        route.durationMinutes -= (leg1.duration || 0) + (leg2.duration || 0);
        route.durationMinutes += mergedDuration;

        // Replace the two legs with the merged one
        route.legs.splice(i, 2, merged);
        // Don't increment — check if the merged leg can merge with the next one too
      } else {
        i++;
      }
    }
  }
}

/**
 * Enrich route legs with geometry from stop waypoints and routing services.
 * - Train legs: use railway graph (local, fast)
 * - Bus legs: get stop waypoints (local), then route via Valhalla auto costing for road-following lines
 * - Walk legs: use Valhalla pedestrian routing (cached + deduplicated)
 */
async function enrichLegsWithGeometry(allRoutes) {
  // --- Phase 1: Train track geometry + bus stop waypoints (all local DB queries) ---
  const localGeometryPromises = [];

  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.type === 'train' && leg.trainUid && leg.startTiploc && leg.endTiploc) {
        localGeometryPromises.push(
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
        // Fetch stop waypoints from DB (local, fast) — store on leg for Phase 2
        localGeometryPromises.push(
          (async () => {
            const waypoints = await getBusJourneyWaypoints(leg.journeyId, leg.boardAtco, leg.alightAtco);
            if (waypoints && waypoints.length >= 2) {
              leg._busWaypoints = waypoints; // temporary, used in Phase 2
              leg.geometry = waypoints.map(w => [w.lat, w.lon]); // straight-line fallback
            }
          })()
        );
      }
    }
  }

  await Promise.allSettled(localGeometryPromises);

  // --- Phase 2a: Bus road-following geometry via Valhalla (cached + batched) ---
  const busRequests = []; // { leg, waypoints, cacheKey }

  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.type === 'bus' && leg._busWaypoints && leg._busWaypoints.length >= 2) {
        const cacheKey = `bus:${leg.journeyId}:${leg.boardAtco}:${leg.alightAtco}`;

        // Check cache
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

        // Cache result
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

  // Clean up any remaining temporary waypoints
  for (const route of allRoutes) {
    for (const leg of route.legs) {
      delete leg._busWaypoints;
    }
  }

  // --- Phase 2b: Valhalla walk geometry (cached + deduplicated + batched) ---
  const walkRequests = new Map(); // dedup key → { fromLat, fromLon, toLat, toLon, legs[] }

  for (const route of allRoutes) {
    for (const leg of route.legs) {
      if (leg.type === 'walk' && leg.fromCoords && leg.toCoords) {
        const key = getValhallaCacheKey(leg.fromCoords.lat, leg.fromCoords.lon, leg.toCoords.lat, leg.toCoords.lon);

        // Check persistent cache first
        const cached = getCachedGeometry(key);
        if (cached !== undefined) {
          if (cached && cached.length >= 2) {
            const geoClone = cached.map(p => [...p]);
            geoClone[0] = [leg.fromCoords.lat, leg.fromCoords.lon];
            geoClone[geoClone.length - 1] = [leg.toCoords.lat, leg.toCoords.lon];
            leg.geometry = geoClone;
          }
          continue; // Skip — already resolved from cache
        }

        // Queue for API fetch (deduplicated)
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

    // Process in batches of 5 with retry
    const BATCH_SIZE = 5;
    for (let i = 0; i < walkQueue.length; i += BATCH_SIZE) {
      const batch = walkQueue.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(batch.map(async ([key, entry]) => {
        const geometry = await fetchValhallaGeometry(
          entry.fromLat, entry.fromLon, entry.toLat, entry.toLon, 'pedestrian'
        );

        // Cache the result (even null = failed)
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

app.get('/api/plan', async (req, res) => {
  try {
    const { start, end, time, day, sort, startLat, startLon, endLat, endLon, startName, endName, arriveBy } = req.query;
    const _t0 = Date.now();
    const _timers = {};
    const _mark = (label) => { _timers[label] = Date.now() - _t0; };

    // Support two modes:
    // 1) ATCO codes: start=2500918&end=9100PRST
    // 2) Coordinates: startLat=53.8&startLon=-2.9&endLat=53.7&endLon=-2.7
    // 3) Mixed: start=2500918&endLat=53.7&endLon=-2.7

    let resolvedStart = start || null;  // ATCO code
    let resolvedEnd = end || null;
    let startWalkLeg = null; // walk leg from place to nearest stop
    let endWalkLeg = null;   // walk leg from nearest stop to place
    let startPlaceName = startName || null;
    let endPlaceName = endName || null;
    let startPlaceCoords = null;
    let endPlaceCoords = null;

    // Resolve start from coordinates if no ATCO code given
    if (!resolvedStart && startLat && startLon) {
      const sLat = parseFloat(startLat);
      const sLon = parseFloat(startLon);
      startPlaceCoords = { lat: sLat, lon: sLon };
      const degDelta = 3.0 / 111.0; // 3km search radius for bus stops

      // Find nearest bus stop and rail station in parallel
      const [busNear, railNear] = await Promise.all([
        pool.query(`
          SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
          FROM stops s
          WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
            AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
            AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
        `, [sLon, sLat, degDelta]),
        pool.query(`
          SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
          FROM stops s WHERE s.coordinates IS NOT NULL AND s.atco_code LIKE '9100%'
            AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
        `, [sLon, sLat, degDelta])
      ]);

      const busWithDist = busNear.rows.map(r => ({
        ...r, dist: haversineDistance(sLat, sLon, parseFloat(r.lat), parseFloat(r.lon)), mode: 'bus'
      })).sort((a, b) => a.dist - b.dist);

      const railWithDist = railNear.rows.map(r => ({
        ...r, dist: haversineDistance(sLat, sLon, parseFloat(r.lat), parseFloat(r.lon)), mode: 'rail'
      })).sort((a, b) => a.dist - b.dist);

      // Prefer bus stops: only consider rail if the nearest bus stop is >500m away
      // and rail is genuinely closer than the nearest bus stop
      let allNear;
      if (busWithDist.length > 0 && (busWithDist[0].dist <= 0.5 || railWithDist.length === 0 || busWithDist[0].dist <= railWithDist[0].dist)) {
        allNear = busWithDist;
      } else if (railWithDist.length > 0 && (busWithDist.length === 0 || railWithDist[0].dist < busWithDist[0].dist)) {
        // Rail is closer and nearest bus is >500m — include both, rail first
        allNear = [...railWithDist, ...busWithDist];
      } else {
        allNear = [...busWithDist, ...railWithDist].sort((a, b) => a.dist - b.dist);
      }

      if (allNear.length === 0) {
        return res.status(404).json({ error: 'No stops found near the start location. Try a location closer to a bus stop or rail station.' });
      }
      const nearest = allNear[0];
      resolvedStart = nearest.atco_code;

      // Add walk leg from place to nearest stop
      if (nearest.dist > 0.05) { // >50m, worth showing a walk
        startWalkLeg = {
          type: 'walk',
          fromName: startPlaceName || 'Start location',
          toName: nearest.common_name,
          fromCoords: { lat: sLat, lon: sLon },
          toCoords: { lat: parseFloat(nearest.lat), lon: parseFloat(nearest.lon) },
          duration: Math.ceil(nearest.dist / 0.08),
          distance_km: Math.round(nearest.dist * 1000) / 1000
        };
      }
    }

    // Resolve end from coordinates if no ATCO code given
    if (!resolvedEnd && endLat && endLon) {
      const eLat = parseFloat(endLat);
      const eLon = parseFloat(endLon);
      endPlaceCoords = { lat: eLat, lon: eLon };
      const degDelta = 3.0 / 111.0; // 3km search radius

      const [busNear, railNear] = await Promise.all([
        pool.query(`
          SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
          FROM stops s
          WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
            AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
            AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
        `, [eLon, eLat, degDelta]),
        pool.query(`
          SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
          FROM stops s WHERE s.coordinates IS NOT NULL AND s.atco_code LIKE '9100%'
            AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
        `, [eLon, eLat, degDelta])
      ]);

      const busWithDist = busNear.rows.map(r => ({
        ...r, dist: haversineDistance(eLat, eLon, parseFloat(r.lat), parseFloat(r.lon)), mode: 'bus'
      })).sort((a, b) => a.dist - b.dist);

      const railWithDist = railNear.rows.map(r => ({
        ...r, dist: haversineDistance(eLat, eLon, parseFloat(r.lat), parseFloat(r.lon)), mode: 'rail'
      })).sort((a, b) => a.dist - b.dist);

      // Prefer bus stops: only consider rail if nearest bus is >500m away and rail is closer
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
          duration: Math.ceil(nearest.dist / 0.08),
          distance_km: Math.round(nearest.dist * 1000) / 1000
        };
      }
    }

    if (!resolvedStart || !resolvedEnd) {
      return res.status(400).json({ error: 'Please provide start and end locations (ATCO codes or coordinates)' });
    }

    const departureTime = time || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}:00`;
    const dayIndex = getDayIndex(day);
    const sortBy = sort || 'arrival';
    const departureMins = timeToMinutes(departureTime);

    // For arrive-by mode we still search from the user's requested earliest
    // departure time, then rank by closeness to arriveBy later.
    // Narrowing the search window here can hide valid alternatives.
    const searchStartMins = departureMins;
    const searchStartTime = searchStartMins !== null ? `${minutesToTime(searchStartMins)}:00` : departureTime;

    const directLimit = arriveBy ? 18 : 5;
    const altLimit = arriveBy ? 8 : 3;
    const crossLimit = arriveBy ? 6 : 2;
    const connLimit = arriveBy ? 10 : 5;

    // --- Short-distance early exit ---
    // If both locations are coordinate-based (pin drops), calculate pin-to-pin distance.
    // For very short distances walking is always faster than any transit option.
    const pinToPin = (startPlaceCoords && endPlaceCoords)
      ? haversineDistance(startPlaceCoords.lat, startPlaceCoords.lon, endPlaceCoords.lat, endPlaceCoords.lon)
      : null;

    if (pinToPin !== null && pinToPin < 0.8) {
      // Under 800m — just return a walk route, no need for transit searches
      const walkMinutes = Math.max(1, Math.ceil(pinToPin / 0.08));
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

      // Enrich geometry for the walk route
      await enrichLegsWithGeometry([walkRoute]);

      return res.json({
        start: {
          atco: resolvedStart,
          name: startPlaceName || 'Start location',
          coordinates: startPlaceCoords
        },
        end: {
          atco: resolvedEnd,
          name: endPlaceName || 'Destination',
          coordinates: endPlaceCoords
        },
        directDistance_km: Math.round(pinToPin * 100) / 100,
        departureTime: depTime,
        dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][dayIndex],
        sortedBy: sortBy,
        routes: [walkRoute],
        totalRoutes: 1,
        nearbyRailStations: { start: [], end: [] }
      });
    }

    // Get coordinates for start and end stops
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

    // === Strategies 1 & 2: Run in parallel (independent DB queries) ===
    const [directBus, startRailStations, endRailStations, nearbyStartStops, nearbyEndStops] = await Promise.all([
      findDirectBusJourneys(resolvedStart, resolvedEnd, searchStartTime, dayIndex, directLimit),
      findNearbyRailStations(resolvedStart, 5.0),
      findNearbyRailStations(resolvedEnd, 5.0),
      // Find walkable bus stops near start & end (within ~1km) for alternative services
      findNearbyBusStops(resolvedStart, 1.0),
      findNearbyBusStops(resolvedEnd, 1.0)
    ]);
    _mark('directBus+nearbyRail');

    // === Strategy 1b: Direct bus from/to nearby walkable stops ===
    // Walk to a nearby stop to catch a different bus service (e.g. walk to underpass)
    const nearbyDirectBus = [];
    {
      const MAX_WALK_MINUTES = 15; // only consider stops within 15 min walk
      const nearbyStartFiltered = nearbyStartStops.filter(s => s.walk_minutes <= MAX_WALK_MINUTES);
      const nearbyEndFiltered = nearbyEndStops.filter(s => s.walk_minutes <= MAX_WALK_MINUTES);

      // Search from nearby start stops → resolved end
      const startPromises = nearbyStartFiltered.slice(0, 6).map(async (stop) => {
        const buses = await findDirectBusJourneys(stop.atco_code, resolvedEnd, searchStartTime, dayIndex, altLimit);
        return buses.map(bus => ({ bus, walkStart: stop, walkEnd: null }));
      });
      // Search from resolved start → nearby end stops
      const endPromises = nearbyEndFiltered.slice(0, 6).map(async (stop) => {
        const buses = await findDirectBusJourneys(resolvedStart, stop.atco_code, searchStartTime, dayIndex, altLimit);
        return buses.map(bus => ({ bus, walkStart: null, walkEnd: stop }));
      });
      // Search from nearby start stops → nearby end stops (both different)
      const crossPromises = nearbyStartFiltered.slice(0, 4).flatMap(startStop2 =>
        nearbyEndFiltered.slice(0, 4).map(async (endStop2) => {
          const buses = await findDirectBusJourneys(startStop2.atco_code, endStop2.atco_code, searchStartTime, dayIndex, crossLimit);
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

    // Also check if start/end IS a rail station
    const startIsRail = resolvedStart.startsWith('9100');
    const endIsRail = resolvedEnd.startsWith('9100');

    let startTiplocs = startRailStations.map(s => s.tiploc_code);
    let endTiplocs = endRailStations.map(s => s.tiploc_code);

    // Resolve rail TIPLOC codes in parallel
    const [startRailResult, endRailResult] = await Promise.all([
      startIsRail ? pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [resolvedStart]) : null,
      endIsRail ? pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [resolvedEnd]) : null
    ]);
    if (startRailResult?.rows.length > 0) startTiplocs = [startRailResult.rows[0].tiploc_code, ...startTiplocs];
    if (endRailResult?.rows.length > 0) endTiplocs = [endRailResult.rows[0].tiploc_code, ...endTiplocs];

    // When start or end IS a rail station, find nearby bus stops so bus searches can work
    // (buses don't stop at rail station ATCO codes like 9100PRST)
    // Run both queries in parallel
    let busEndCodes = [resolvedEnd];
    let busStartCodes = [resolvedStart];
    const [endNearbyBusResult, startNearbyBusResult] = await Promise.all([
      endIsRail ? pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s
        WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < 0.008 AND ABS(s.coordinates[1] - $2) < 0.008
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [parseFloat(endStop.lon), parseFloat(endStop.lat)]) : null,
      startIsRail ? pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s
        WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < 0.008 AND ABS(s.coordinates[1] - $2) < 0.008
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [parseFloat(startStop.lon), parseFloat(startStop.lat)]) : null
    ]);
    if (endNearbyBusResult) {
      const endBusStops = endNearbyBusResult.rows.map(r => ({
        ...r, dist: haversineDistance(parseFloat(endStop.lat), parseFloat(endStop.lon), parseFloat(r.lat), parseFloat(r.lon))
      })).filter(r => r.dist <= 1.0).sort((a, b) => a.dist - b.dist).slice(0, 5);
      if (endBusStops.length > 0) busEndCodes = endBusStops.map(s => s.atco_code);
    }
    if (startNearbyBusResult) {
      const startBusStops = startNearbyBusResult.rows.map(r => ({
        ...r, dist: haversineDistance(parseFloat(startStop.lat), parseFloat(startStop.lon), parseFloat(r.lat), parseFloat(r.lon))
      })).filter(r => r.dist <= 1.0).sort((a, b) => a.dist - b.dist).slice(0, 5);
      if (startBusStops.length > 0) busStartCodes = startBusStops.map(s => s.atco_code);
    }

    // === Strategies 3 + 2b + 4: Direct train, rail-adjacent bus, and train connections ===
    // Run Strategy 3 (direct train) concurrently with Strategy 2b (bus near rail stations)
    const walkToStation = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
    const trainDepartAfter = (startTiplocs.length > 0 && endTiplocs.length > 0)
      ? minutesToTime(timeToMinutes(searchStartTime) + walkToStation) + ':00' : null;

    // Build all Strategy 2b bus searches as parallel promises
    const extraBusPromises = [];
    if (endIsRail && busEndCodes.length > 0) {
      for (const busEndCode of busEndCodes) {
        extraBusPromises.push(findDirectBusJourneys(resolvedStart, busEndCode, searchStartTime, dayIndex, altLimit));
      }
    }
    if (startIsRail && busStartCodes.length > 0) {
      for (const busStartCode of busStartCodes) {
        extraBusPromises.push(findDirectBusJourneys(busStartCode, resolvedEnd, searchStartTime, dayIndex, altLimit));
      }
    }
    if (endIsRail && busEndCodes.length > 0 && startIsRail && busStartCodes.length > 0) {
      for (const busStartCode of busStartCodes) {
        for (const busEndCode of busEndCodes) {
          extraBusPromises.push(findDirectBusJourneys(busStartCode, busEndCode, searchStartTime, dayIndex, altLimit));
        }
      }
    }

    // Run Strategy 3 + 2b in parallel
    const [directTrainResult, ...extraBusResults] = await Promise.all([
      trainDepartAfter ? findDirectTrainJourneys(startTiplocs, endTiplocs, trainDepartAfter, directLimit) : [],
      ...extraBusPromises
    ]);
    let directTrain = directTrainResult;

    // Deduplicate extra bus results from Strategy 2b
    const seenBusJourneys = new Set(directBus.map(b => b.journeyId));
    for (const extraBuses of extraBusResults) {
      for (const bus of extraBuses) {
        if (!seenBusJourneys.has(bus.journeyId)) {
          seenBusJourneys.add(bus.journeyId);
          directBus.push(bus);
        }
      }
    }

    _mark('directTrain');

    // === Strategy 4: Train + Train connections ===
    let trainConnections = [];
    if (startTiplocs.length > 0 && endTiplocs.length > 0 && directTrain.length === 0) {
      trainConnections = await findTrainTrainConnections(startTiplocs, endTiplocs, trainDepartAfter, connLimit);
    }

    _mark('trainConnections');

    // === Strategy 5: Bus → Train → Walk/Bus (and reverse) ===
    let multiModal = [];

    // 5a: If start is walkable to rail, use walk+train strategies (already covered by Strategy 3/4)
    // 5b: Bus → Train (find rail stations reachable by bus from the start)
    {
      const busReachableFromStart = await findBusReachableRailStations(resolvedStart, dayIndex, searchStartTime, directLimit);

      // Also check nearby walkable bus stops for bus→rail connections in parallel
      // (the nearest stop may not have routes to rail stations, but a stop 0.5km walk away might)
      const MAX_WALK_TO_BUS = 15;
      const nearbyForBusRail = nearbyStartStops.filter(s => s.walk_minutes <= MAX_WALK_TO_BUS).slice(0, 6);
      const nearbyReachableResults = await Promise.all(
        nearbyForBusRail.map(async (nearbyStop) => {
          const reachable = await findBusReachableRailStations(nearbyStop.atco_code, dayIndex, searchStartTime, altLimit);
          return { nearbyStop, reachable };
        })
      );
      const nearbyBusReachable = [];
      for (const { nearbyStop, reachable } of nearbyReachableResults) {
        console.log(`[5b-DEBUG] Nearby stop ${nearbyStop.atco_code} found reachable stations: ${reachable.map(s => s.tiploc_code).join(', ')}`);
        for (const station of reachable) {
          const isDuplicateStart = busReachableFromStart.some(s => s.tiploc_code === station.tiploc_code);
          const isDuplicateNearby = nearbyBusReachable.some(s => s.station.tiploc_code === station.tiploc_code);
          console.log(`[5b-DEBUG] Station ${station.tiploc_code}: isDuplicateStart=${isDuplicateStart}, isDuplicateNearby=${isDuplicateNearby}`);
          if (!isDuplicateStart && !isDuplicateNearby) {
            nearbyBusReachable.push({ station, walkStop: nearbyStop });
          }
        }
      }
      console.log(`[5b-DEBUG] Nearby bus-reachable stations: ${nearbyBusReachable.map(x => x.station.tiploc_code).join(', ')}`);
      console.log(`[5b-DEBUG] Nearby start stops checked: ${nearbyForBusRail.map(s => s.atco_code).join(', ')}`);

      // Pre-fetch coordinates for all bus-reachable stations in one query
      const stationAtcoCodes = [
        ...busReachableFromStart.flatMap(s => [s.bus_stop_atco, s.atco_code]),
        ...nearbyBusReachable.flatMap(({ station, walkStop }) => [station.bus_stop_atco, station.atco_code, walkStop.atco_code])
      ];
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

      // targetTiplocs = endTiplocs (already includes the rail station TIPLOC if endIsRail,
      // resolved earlier when building endTiplocs from endRailResult)
      const targetTiplocs = [...endTiplocs];
      console.log(`[5b-DEBUG] Bus-reachable stations: ${busReachableFromStart.map(s => s.tiploc_code).join(', ')}`);
      console.log(`[5b-DEBUG] Target tiplocs: ${targetTiplocs.join(', ')}`);

      for (const station of busReachableFromStart) {
        // Skip if this station is the end destination itself (already handled by direct train)
        if (station.atco_code === resolvedEnd) continue;
        // Cap total multi-modal results to avoid excessive searching
        if (multiModal.length >= 10) break;
        console.log(`[5b-DEBUG] Processing station ${station.tiploc_code} (${station.common_name}), bus_stop=${station.bus_stop_atco}`);

        // Find the actual bus journey from origin to the bus stop near this rail station
        const busLegs = await findDirectBusJourneys(resolvedStart, station.bus_stop_atco, searchStartTime, dayIndex, altLimit);
        console.log(`[5b-DEBUG] Found ${busLegs.length} bus legs to ${station.tiploc_code}`);

        for (const bus of busLegs) {
          // Use pre-fetched coordinates for walk time calculation
          const busStopCoords = stationCoordsMap[station.bus_stop_atco];
          const railStopCoords = stationCoordsMap[station.atco_code];
          let walkToStationMins = 2; // default short walk
          if (busStopCoords && railStopCoords) {
            const walkDist = haversineDistance(
              busStopCoords.lat, busStopCoords.lon,
              railStopCoords.lat, railStopCoords.lon
            );
            walkToStationMins = Math.max(1, Math.ceil(walkDist / 0.08));
          }

          const arrivalAtStation = timeToMinutes(bus.alightTime) + walkToStationMins;
          const trainDepartAfter = minutesToTime(arrivalAtStation) + ':00';

          // Find trains from this station to the destination area
          if (targetTiplocs.length > 0) {
            const trains = await findDirectTrainJourneys([station.tiploc_code], targetTiplocs, trainDepartAfter, 3);

            for (const train of trains) {
              const walkFromEnd = endRailStations.length > 0 && !endIsRail ? endRailStations[0].walk_minutes : 0;
              const legs = [bus];

              // Add walk from bus stop to rail station if needed
              if (walkToStationMins > 1 && station.bus_stop_atco !== station.atco_code) {
                legs.push({
                  type: 'walk',
                  fromAtco: station.bus_stop_atco,
                  toAtco: station.atco_code,
                  fromName: station.bus_stop_name || bus.alightName,
                  toName: station.common_name,
                  duration: walkToStationMins,
                  distance_km: Math.round(walkToStationMins * 0.08 * 100) / 100
                });
              }

              legs.push(train);

              // Add walk from destination rail station if needed
              if (walkFromEnd > 0) {
                legs.push({
                  type: 'walk',
                  fromAtco: endRailStations[0].atco_code,
                  toAtco: endStop.atco_code,
                  fromName: endRailStations[0].common_name,
                  toName: endStop.common_name,
                  duration: walkFromEnd,
                  distance_km: endRailStations[0].walk_km
                });
              }

              multiModal.push({ legs });
            }

            // If no direct trains, try train+train connections (bus→train→transfer→train)
            if (trains.length === 0) {
              const trainConns = await findTrainTrainConnections([station.tiploc_code], targetTiplocs, trainDepartAfter, 3);
              for (const conn of trainConns) {
                const lastTrainLeg = conn.legs[conn.legs.length - 1];
                const walkFromStation = endRailStations.find(s => s.tiploc_code === lastTrainLeg.endTiploc)
                  || endRailStations[0] || null;
                const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;

                const legs = [bus];

                if (walkToStationMins > 1 && station.bus_stop_atco !== station.atco_code) {
                  legs.push({
                    type: 'walk',
                    fromAtco: station.bus_stop_atco,
                    toAtco: station.atco_code,
                    fromName: station.bus_stop_name || bus.alightName,
                    toName: station.common_name,
                    duration: walkToStationMins,
                    distance_km: Math.round(walkToStationMins * 0.08 * 100) / 100
                  });
                }

                legs.push(...conn.legs);

                if (walkFrom > 0 && !endIsRail) {
                  legs.push({
                    type: 'walk',
                    fromAtco: walkFromStation.atco_code,
                    toAtco: endStop.atco_code,
                    fromName: walkFromStation.common_name,
                    toName: endStop.common_name,
                    duration: walkFrom,
                    distance_km: walkFromStation.walk_km
                  });
                }

                multiModal.push({ legs });
              }
            }
          }
        }
      }

      // 5b-ext: Walk → Bus → Train from nearby walkable bus stops
      // When the nearest stop doesn't have routes to rail stations, check nearby stops
      for (const { station, walkStop } of nearbyBusReachable) {
        if (station.atco_code === resolvedEnd) continue;
        if (multiModal.length >= 15) break;

        // Find bus journeys from the nearby walkable stop to the bus stop near this rail station
        const busLegs = await findDirectBusJourneys(walkStop.atco_code, station.bus_stop_atco, searchStartTime, dayIndex, altLimit);

        for (const bus of busLegs) {
          const busStopCoords = stationCoordsMap[station.bus_stop_atco];
          const railStopCoords = stationCoordsMap[station.atco_code];
          let walkToStationMins = 2;
          if (busStopCoords && railStopCoords) {
            const walkDist = haversineDistance(
              busStopCoords.lat, busStopCoords.lon,
              railStopCoords.lat, railStopCoords.lon
            );
            walkToStationMins = Math.max(1, Math.ceil(walkDist / 0.08));
          }

          const arrivalAtStation = timeToMinutes(bus.alightTime) + walkToStationMins;
          const trainDepartAfter = minutesToTime(arrivalAtStation) + ':00';

          if (targetTiplocs.length > 0) {
            const trains = await findDirectTrainJourneys([station.tiploc_code], targetTiplocs, trainDepartAfter, 3);

            for (const train of trains) {
              const walkFromEnd = endRailStations.length > 0 && !endIsRail ? endRailStations[0].walk_minutes : 0;
              const legs = [];

              // Add walk from start to the nearby bus stop
              if (walkStop.walk_minutes > 0) {
                const walkStopCoords = stationCoordsMap[walkStop.atco_code];
                legs.push({
                  type: 'walk',
                  fromName: startPlaceName || startStop.common_name,
                  toName: walkStop.common_name,
                  fromCoords: startPlaceCoords || { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) },
                  toCoords: walkStopCoords || null,
                  duration: walkStop.walk_minutes,
                  distance_km: walkStop.walk_km
                });
              }

              legs.push(bus);

              if (walkToStationMins > 1 && station.bus_stop_atco !== station.atco_code) {
                legs.push({
                  type: 'walk',
                  fromAtco: station.bus_stop_atco,
                  toAtco: station.atco_code,
                  fromName: station.bus_stop_name || bus.alightName,
                  toName: station.common_name,
                  duration: walkToStationMins,
                  distance_km: Math.round(walkToStationMins * 0.08 * 100) / 100
                });
              }

              legs.push(train);

              if (walkFromEnd > 0) {
                legs.push({
                  type: 'walk',
                  fromAtco: endRailStations[0].atco_code,
                  toAtco: endStop.atco_code,
                  fromName: endRailStations[0].common_name,
                  toName: endStop.common_name,
                  duration: walkFromEnd,
                  distance_km: endRailStations[0].walk_km
                });
              }

              multiModal.push({ legs });
            }

            // If no direct trains, try train+train connections
            if (trains.length === 0) {
              const trainConns = await findTrainTrainConnections([station.tiploc_code], targetTiplocs, trainDepartAfter, 3);
              for (const conn of trainConns) {
                const lastTrainLeg = conn.legs[conn.legs.length - 1];
                const walkFromStation = endRailStations.find(s => s.tiploc_code === lastTrainLeg.endTiploc)
                  || endRailStations[0] || null;
                const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;

                const legs = [];

                if (walkStop.walk_minutes > 0) {
                  const walkStopCoords2 = stationCoordsMap[walkStop.atco_code];
                  legs.push({
                    type: 'walk',
                    fromAtco: walkStop.atco_code,
                    fromName: startPlaceName || startStop.common_name,
                    toName: walkStop.common_name,
                    fromCoords: startPlaceCoords || { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) },
                    toCoords: walkStopCoords2 || null,
                    duration: walkStop.walk_minutes,
                    distance_km: walkStop.walk_km
                  });
                }

                legs.push(bus);

                if (walkToStationMins > 1 && station.bus_stop_atco !== station.atco_code) {
                  legs.push({
                    type: 'walk',
                    fromAtco: station.bus_stop_atco,
                    toAtco: station.atco_code,
                    fromName: station.bus_stop_name || bus.alightName,
                    toName: station.common_name,
                    duration: walkToStationMins,
                    distance_km: Math.round(walkToStationMins * 0.08 * 100) / 100
                  });
                }

                legs.push(...conn.legs);

                if (walkFrom > 0 && !endIsRail) {
                  legs.push({
                    type: 'walk',
                    fromAtco: walkFromStation.atco_code,
                    toAtco: endStop.atco_code,
                    fromName: walkFromStation.common_name,
                    toName: endStop.common_name,
                    duration: walkFrom,
                    distance_km: walkFromStation.walk_km
                  });
                }

                multiModal.push({ legs });
              }
            }
          }
        }
      }
    }

    // 5c: Train → Bus (find rail stations near the end that connect to the destination by bus)
    {
      const busReachableFromEnd = await findBusReachableRailStations(resolvedEnd, dayIndex, '00:00:00', 5);

      // sourceTiplocs = startTiplocs (already includes rail station TIPLOC if startIsRail)
      const sourceTiplocs = [...startTiplocs];

      // Also try bus-reachable stations from start as source TIPLOCs
      // (in case start isn't within walking distance of a station)
      if (sourceTiplocs.length === 0) {
        const busReachableStart = await findBusReachableRailStations(resolvedStart, dayIndex, searchStartTime, altLimit);
        // For train→bus, we can still use bus→train→bus but that gets complex.
        // Instead just use walk-reachable start stations.
        // (bus→train→bus is handled by combining 5b with 5c results)
      }

      if (sourceTiplocs.length > 0) {
        for (const endStation of busReachableFromEnd) {
          if (endStation.atco_code === start) continue;
          // Cap total multi-modal results to avoid excessive searching
          if (multiModal.length >= 10) break;

          // Find trains from start area to this rail station
          const walkToStart = startRailStations.length > 0 && !startIsRail ? startRailStations[0].walk_minutes : 0;
          const trainDepartAfter = minutesToTime(timeToMinutes(searchStartTime) + walkToStart) + ':00';

          const trains = await findDirectTrainJourneys(sourceTiplocs, [endStation.tiploc_code], trainDepartAfter, 3);

          for (const train of trains) {
            // After arriving at the rail station, walk to nearby bus stop and take bus to destination
            const arrivalMins = timeToMinutes(train.alightTime) + 3; // 3 min walk
            const busAfter = minutesToTime(arrivalMins) + ':00';

            // Find bus from near the rail station to destination
            // If destination is a rail station, also try bus stops near it
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
                legs.push({
                  type: 'walk',
                  fromAtco: startStop.atco_code,
                  toAtco: startRailStations[0].atco_code,
                  fromName: startStop.common_name,
                  toName: startRailStations[0].common_name,
                  duration: walkToStart,
                  distance_km: startRailStations[0].walk_km
                });
              }

              legs.push(train);

              // Walk from station to bus stop if they're different
              if (endStation.bus_stop_atco !== endStation.atco_code) {
                legs.push({
                  type: 'walk',
                  fromAtco: endStation.atco_code,
                  toAtco: endStation.bus_stop_atco,
                  fromName: endStation.common_name,
                  toName: endStation.bus_stop_name || 'Bus stop',
                  duration: 3,
                  distance_km: 0.2
                });
              }

              legs.push(bus);
              multiModal.push({ legs });
            }
          }
        }
      }
    }

    // Strategy 5d removed: was redundant with 5b/5c and added ~30-40 sequential DB queries.
    // All bus→train and train→bus patterns are covered by 5b, 5b-ext, and 5c.

    _mark('multiModal');

    // === Strategy 6: Bus → Bus transfer ===
    // Always search for transfers — even when direct buses exist, a transfer
    // via a nearby stop may offer a faster or more frequent alternative.
    let busTransfers = [];
    {
      // Parallelize all expandStopCode calls for Strategy 6
      const nearbyStartFiltered = nearbyStartStops.filter(s => s.walk_minutes <= 15).slice(0, 5);
      const nearbyEndFiltered = nearbyEndStops.filter(s => s.walk_minutes <= 15).slice(0, 5);
      const startExpandCodes = [resolvedStart, ...nearbyStartFiltered.map(s => s.atco_code), ...(startIsRail ? busStartCodes : [])];
      const endExpandCodes = [resolvedEnd, ...nearbyEndFiltered.map(s => s.atco_code), ...(endIsRail ? busEndCodes : [])];
      const [startExpandResults, endExpandResults] = await Promise.all([
        Promise.all(startExpandCodes.map(code => expandStopCode(code))),
        Promise.all(endExpandCodes.map(code => expandStopCode(code)))
      ]);
      let startCodes = [...new Set(startExpandResults.flat())];
      let endCodes = [...new Set(endExpandResults.flat())];
      const sPlaceholders = startCodes.map((_, i) => `$${i + 1}`).join(',');
      const ePlaceholders = endCodes.map((_, i) => `$${startCodes.length + i + 1}`).join(',');
      const dayPos = dayIndex + 1;

      const transferResult = await pool.query(`
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
        JOIN bus_journey_stops bjs2_start ON bjs2_start.atco_code = bjs1_end.atco_code
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

      // Deduplicate
      const seenTransfers = new Set();
      for (const r of transferResult.rows) {
        const key = `${r.j1_id}→${r.j2_id}`;
        if (seenTransfers.has(key)) continue;
        seenTransfers.add(key);
        busTransfers.push({
          legs: [
            {
              type: 'bus',
              journeyId: r.j1_id,
              routeNumber: r.route1,
              operator: r.op1,
              operatorName: r.op1_name,
              boardAtco: r.board_atco,
              boardName: r.board_name,
              boardTime: r.board_time,
              alightAtco: r.transfer_atco,
              alightName: r.transfer_name,
              alightTime: r.transfer_arrive
            },
            {
              type: 'transfer',
              stop: r.transfer_name,
              atco: r.transfer_atco,
              waitMinutes: safeDuration(r.transfer_arrive, r.transfer_depart)
            },
            {
              type: 'bus',
              journeyId: r.j2_id,
              routeNumber: r.route2,
              operator: r.op2,
              operatorName: r.op2_name,
              boardAtco: r.transfer_atco,
              boardName: r.transfer_name,
              boardTime: r.transfer_depart,
              alightAtco: r.alight_atco,
              alightName: r.alight_name,
              alightTime: r.alight_time
            }
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

      // If bus doesn't stop at the actual start/end (e.g. stops at bus stop near rail station),
      // add walk legs
      const busAlightIsEnd = bus.alightAtco === resolvedEnd;
      const busBoardIsStart = bus.boardAtco === resolvedStart;
      
      if (!busBoardIsStart && startIsRail) {
        // Add walk from rail station to bus stop
        const busStopCoords = await pool.query(
          'SELECT coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code = $1', [bus.boardAtco]
        );
        if (busStopCoords.rows[0]) {
          const walkDist = haversineDistance(parseFloat(startStop.lat), parseFloat(startStop.lon),
            parseFloat(busStopCoords.rows[0].lat), parseFloat(busStopCoords.rows[0].lon));
          const walkMins = Math.max(1, Math.ceil(walkDist / 0.08));
          if (walkMins > 1) {
            legs.unshift({
              type: 'walk',
              fromAtco: startStop.atco_code,
              toAtco: bus.boardAtco,
              fromName: startStop.common_name,
              toName: bus.boardName,
              duration: walkMins,
              distance_km: Math.round(walkDist * 1000) / 1000
            });
            totalDuration += walkMins;
          }
        }
      }

      if (!busAlightIsEnd && endIsRail) {
        // Add walk from bus stop to rail station
        const busStopCoords = await pool.query(
          'SELECT coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code = $1', [bus.alightAtco]
        );
        if (busStopCoords.rows[0]) {
          const walkDist = haversineDistance(parseFloat(busStopCoords.rows[0].lat), parseFloat(busStopCoords.rows[0].lon),
            parseFloat(endStop.lat), parseFloat(endStop.lon));
          const walkMins = Math.max(1, Math.ceil(walkDist / 0.08));
          if (walkMins > 1) {
            legs.push({
              type: 'walk',
              fromAtco: bus.alightAtco,
              toAtco: endStop.atco_code,
              fromName: bus.alightName,
              toName: endStop.common_name,
              duration: walkMins,
              distance_km: Math.round(walkDist * 1000) / 1000
            });
            totalDuration += walkMins;
          }
        }
      }

      const modes = [...new Set(legs.map(l => l.type))];
      allRoutes.push({
        id: `bus-direct-${bus.journeyId}`,
        summary: `Bus ${bus.routeNumber}${busAlightIsEnd ? ' direct' : ''}`,
        modes: modes,
        departureTime: bus.boardTime,
        arrivalTime: minutesToTime(depMins + totalDuration) + ':00',
        durationMinutes: totalDuration,
        legs: legs
      });
    }

    // Nearby-stop bus routes (walk to a different stop to catch alternative services)
    for (const { bus, walkStart, walkEnd } of nearbyDirectBus) {
      const depMins = timeToMinutes(bus.boardTime);
      const arrMins = timeToMinutes(bus.alightTime);
      const legs = [];
      let totalDuration = arrMins - depMins;

      // Add walk leg to the alternative start stop
      if (walkStart) {
        legs.push({
          type: 'walk',
          fromAtco: startStop.atco_code,
          toAtco: walkStart.atco_code,
          fromName: startStop.common_name,
          toName: walkStart.common_name,
          duration: walkStart.walk_minutes,
          distance_km: walkStart.walk_km
        });
        totalDuration += walkStart.walk_minutes;
      }

      legs.push(bus);

      // Add walk leg from the alternative end stop
      if (walkEnd) {
        legs.push({
          type: 'walk',
          fromAtco: walkEnd.atco_code,
          toAtco: endStop.atco_code,
          fromName: walkEnd.common_name,
          toName: endStop.common_name,
          duration: walkEnd.walk_minutes,
          distance_km: walkEnd.walk_km
        });
        totalDuration += walkEnd.walk_minutes;
      }

      const modes = [...new Set(legs.map(l => l.type))];
      const walkInfo = walkStart ? ` (via ${walkStart.common_name})` : '';
      allRoutes.push({
        id: `bus-nearby-${bus.journeyId}`,
        summary: `Bus ${bus.routeNumber}${walkInfo}`,
        modes: modes,
        departureTime: walkStart
          ? minutesToTime(depMins - walkStart.walk_minutes) + ':00'
          : bus.boardTime,
        arrivalTime: minutesToTime(depMins + totalDuration - (walkStart ? walkStart.walk_minutes : 0)) + ':00',
        durationMinutes: totalDuration,
        legs: legs
      });
    }

    // Direct train routes
    for (const train of directTrain) {
      // Match walk leg to the actual train's boarding station
      const walkToStation = startRailStations.find(s => s.tiploc_code === train.startTiploc)
        || startRailStations[0] || null;
      const walkFromStation = endRailStations.find(s => s.tiploc_code === train.endTiploc)
        || endRailStations[0] || null;
      const walkTo = walkToStation ? walkToStation.walk_minutes : 0;
      const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;

      const depMins = timeToMinutes(departureTime);
      const arrMins = timeToMinutes(train.alightTime) + walkFrom;

      const legs = [];
      if (walkToStation && !startIsRail) {
        legs.push({
          type: 'walk',
          fromAtco: startStop.atco_code,
          toAtco: walkToStation.atco_code,
          fromName: startStop.common_name,
          toName: walkToStation.common_name,
          duration: walkTo,
          distance_km: walkToStation.walk_km
        });
      }
      legs.push(train);
      if (walkFromStation && !endIsRail) {
        legs.push({
          type: 'walk',
          fromAtco: walkFromStation.atco_code,
          toAtco: endStop.atco_code,
          fromName: walkFromStation.common_name,
          toName: endStop.common_name,
          duration: walkFrom,
          distance_km: walkFromStation.walk_km
        });
      }

      allRoutes.push({
        id: `train-direct-${train.trainUid}`,
        summary: `Train ${train.operator || ''} direct`,
        modes: walkTo > 0 || walkFrom > 0 ? ['walk', 'train'] : ['train'],
        departureTime: departureTime,
        arrivalTime: minutesToTime(arrMins) + ':00',
        durationMinutes: arrMins - depMins,
        legs: legs
      });
    }

    // Train + Train connections
    for (const conn of trainConnections) {
      const firstTrainLeg = conn.legs[0];
      const lastTrainLeg = conn.legs[conn.legs.length - 1];
      // Match walk leg to the actual train's boarding/alighting station
      const walkToStation = startRailStations.find(s => s.tiploc_code === firstTrainLeg.startTiploc)
        || startRailStations[0] || null;
      const walkFromStation = endRailStations.find(s => s.tiploc_code === lastTrainLeg.endTiploc)
        || endRailStations[0] || null;
      const walkTo = walkToStation ? walkToStation.walk_minutes : 0;
      const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;

      const depMins = timeToMinutes(departureTime);
      const lastLeg = conn.legs[conn.legs.length - 1];
      const arrMins = timeToMinutes(lastLeg.alightTime) + walkFrom;

      const legs = [];
      if (walkToStation && !startIsRail) {
        legs.push({
          type: 'walk',
          fromAtco: startStop.atco_code,
          toAtco: walkToStation.atco_code,
          fromName: startStop.common_name,
          toName: walkToStation.common_name,
          duration: walkTo,
          distance_km: walkToStation.walk_km
        });
      }
      legs.push(...conn.legs);
      if (walkFromStation && !endIsRail) {
        legs.push({
          type: 'walk',
          fromAtco: walkFromStation.atco_code,
          toAtco: endStop.atco_code,
          fromName: walkFromStation.common_name,
          toName: endStop.common_name,
          duration: walkFrom,
          distance_km: walkFromStation.walk_km
        });
      }

      allRoutes.push({
        id: `train-conn-${conn.legs[0].trainUid}-${lastLeg.trainUid}`,
        summary: `Train via ${conn.legs[1].station || 'connection'}`,
        modes: ['walk', 'train'],
        departureTime: departureTime,
        arrivalTime: minutesToTime(arrMins) + ':00',
        durationMinutes: arrMins - depMins,
        legs: legs
      });
    }

    // Multi-modal routes (bus+train, train+bus)
    for (const mm of multiModal) {
      const firstLeg = mm.legs[0];
      const lastLeg = mm.legs[mm.legs.length - 1];
      const depMins = timeToMinutes(firstLeg.type === 'walk' ? departureTime : firstLeg.boardTime);
      const arrTime = lastLeg.type === 'walk' 
        ? minutesToTime(timeToMinutes(mm.legs[mm.legs.length - 2].alightTime) + lastLeg.duration)
        : lastLeg.alightTime;
      const arrMins = timeToMinutes(arrTime);

      const modes = [...new Set(mm.legs.map(l => l.type).filter(t => t !== 'transfer'))];

      allRoutes.push({
        id: `multi-${allRoutes.length}`,
        summary: modes.join(' + '),
        modes: modes,
        departureTime: firstLeg.type === 'walk' ? departureTime : firstLeg.boardTime,
        arrivalTime: arrTime.includes(':') && arrTime.length <= 5 ? arrTime + ':00' : arrTime,
        durationMinutes: arrMins >= depMins ? arrMins - depMins : arrMins + 1440 - depMins,
        legs: mm.legs
      });
    }

    // Bus + Bus transfers
    for (const bt of busTransfers) {
      const firstLeg = bt.legs[0];
      const lastLeg = bt.legs[bt.legs.length - 1];
      const depMins = timeToMinutes(firstLeg.boardTime);
      const arrMins = timeToMinutes(lastLeg.alightTime);

      allRoutes.push({
        id: `bus-transfer-${firstLeg.journeyId}-${lastLeg.journeyId}`,
        summary: `Bus ${firstLeg.routeNumber} → ${lastLeg.routeNumber}`,
        modes: ['bus'],
        departureTime: firstLeg.boardTime,
        arrivalTime: lastLeg.alightTime,
        durationMinutes: arrMins >= depMins ? arrMins - depMins : arrMins + 1440 - depMins,
        transferStop: bt.legs[1].stop,
        legs: bt.legs
      });
    }

    // === Strategy 0: Walking only (for short distances) ===
    // Use actual pin-to-pin distance when both locations are coordinate-based,
    // otherwise fall back to stop-to-stop distance
    const walkDistance = (pinToPin !== null) ? pinToPin : directDistance;
    if (walkDistance <= 3.0) {
      const walkMinutes = Math.max(1, Math.ceil(walkDistance / 0.08)); // ~5 km/h
      const walkFrom = startPlaceCoords || { lat: parseFloat(startStop.lat), lon: parseFloat(startStop.lon) };
      const walkTo = endPlaceCoords || { lat: parseFloat(endStop.lat), lon: parseFloat(endStop.lon) };
      allRoutes.push({
        id: 'walk-only',
        summary: 'Walk',
        modes: ['walk'],
        departureTime: departureTime,
        arrivalTime: minutesToTime(timeToMinutes(departureTime) + walkMinutes) + ':00',
        durationMinutes: walkMinutes,
        legs: [{
          type: 'walk',
          fromName: startPlaceName || startStop.common_name,
          toName: endPlaceName || endStop.common_name,
          fromCoords: walkFrom,
          toCoords: walkTo,
          duration: walkMinutes,
          distance_km: Math.round(walkDistance * 1000) / 1000
        }]
      });
    }

    _mark('busTransfers');

    // === Enrich all legs with coordinates for map polylines (fast, DB-only) ===
    await enrichLegsWithCoordinates(allRoutes, startStop, endStop);
    _mark('enrichCoords');

    // === Prepend/append walk legs for place-based (coordinate) searches ===
    if (startWalkLeg || endWalkLeg) {
      for (const route of allRoutes) {
        if (startWalkLeg) {
          route.legs.unshift({ ...startWalkLeg });
          route.durationMinutes += startWalkLeg.duration;
        }
        if (endWalkLeg) {
          route.legs.push({ ...endWalkLeg });
          route.durationMinutes += endWalkLeg.duration;
        }
      }
      // Merge any consecutive walk legs (e.g. place→bus stop + bus stop→rail station → place→rail station)
      mergeConsecutiveWalkLegs(allRoutes);
    }

    // Filter out unreasonable routes:
    // - Remove routes taking > 4x the reasonable minimum for the distance
    // - Remove routes arriving later than the last sensible option
    // - Remove routes where any single walk leg exceeds 60 minutes (unless it's the only route type)
    // - For short distances: remove transit routes that take much longer than just walking
    const reasonableMinMinutes = Math.max(directDistance * 2, 15); // ~30 km/h avg transit
    const maxReasonableDuration = Math.max(reasonableMinMinutes * 8, 240);
    const maxWalkLegMinutes = 60; // cap individual walk legs at 60 minutes
    // For short distances, calculate what walking would take so we can reject circuitous routes
    const walkOnlyDuration = walkDistance <= 3.0 ? Math.max(1, Math.ceil(walkDistance / 0.08)) : null;
    console.log(`[FILTER] directDist=${directDistance.toFixed(2)}km walkDist=${walkDistance.toFixed(2)}km maxDuration=${maxReasonableDuration}min walkOnly=${walkOnlyDuration}min maxWalkLeg=${maxWalkLegMinutes}min`);
    const filteredRoutes = allRoutes.filter(r => {
      if (r.durationMinutes <= 0 || r.durationMinutes > maxReasonableDuration) {
        console.log(`[FILTER] REJECT ${r.id}: duration=${r.durationMinutes}min (max=${maxReasonableDuration})`);
        return false;
      }
      // Filter out routes with excessively long walk legs (unless walk-only)
      if (r.id !== 'walk-only') {
        const walkLegs = r.legs.filter(l => l.type === 'walk');
        const maxWalk = Math.max(...walkLegs.map(l => l.duration || 0), 0);
        if (maxWalk > maxWalkLegMinutes) {
          console.log(`[FILTER] REJECT ${r.id}: maxWalkLeg=${maxWalk}min (limit=${maxWalkLegMinutes})`);
          return false;
        }
      }
      // For short walkable distances, reject transit routes that take much longer than walking
      // A bus/train should only be shown if it's actually faster or comparable to walking
      if (walkOnlyDuration !== null && r.id !== 'walk-only') {
        // Transit route must not take more than 3x the walking time (includes wait + travel)
        if (r.durationMinutes > walkOnlyDuration * 3) {
          console.log(`[FILTER] REJECT ${r.id}: duration=${r.durationMinutes}min > 3x walkOnly=${walkOnlyDuration * 3}min`);
          return false;
        }
      }
      console.log(`[FILTER] PASS ${r.id}: duration=${r.durationMinutes}min`);
      return true;
    });

    // If arriveBy is specified, sort routes by proximity to target arrival time
    // (overrides the user's sort choice so the closest-arriving routes come first)
    let arriveByTarget = null;
    if (arriveBy) {
      arriveByTarget = timeToMinutes(arriveBy);
      console.log(`[arriveBy] target=${arriveBy} (${arriveByTarget}min) candidates=${filteredRoutes.length}`);
    }

    const getTotalWalkMinutes = (route) => route.legs
      .filter(l => l.type === 'walk')
      .reduce((sum, l) => sum + (Number(l.duration) || 0), 0);

    const getArriveByScore = (route) => {
      const arr = timeToMinutes(route.arrivalTime);
      const dep = timeToMinutes(route.departureTime);
      const delta = arriveByTarget - arr;

      // Primary: closeness to target arrival (prefer on/before target)
      const arrivalScore = delta >= 0 ? delta : 10000 + Math.abs(delta) * 3;

      // Secondary: heavily penalise very long total walking in multimodal routes
      const totalWalk = getTotalWalkMinutes(route);
      const walkPenalty = Math.max(0, totalWalk - 30) * 1.5;

      // Tertiary: slightly prefer later departures when arrival suitability is similar
      const departEarlyPenalty = dep !== null ? Math.max(0, (arriveByTarget - dep) - 120) * 0.05 : 0;

      return arrivalScore + walkPenalty + departEarlyPenalty;
    };

    // Deduplicate routes using two-phase approach:
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
      
      if (!patternGroups.has(patternKey)) {
        patternGroups.set(patternKey, []);
      }
      patternGroups.get(patternKey).push(r);
    }
    
    // From each pattern group, keep the best route.
    // - Normal mode: earliest departure (existing behaviour)
    // - Arrive-by mode: closest arrival to target (prefer later arrivals that are still valid)
    // Also keep one secondary alternative where sensible.
    for (const [pattern, routes] of patternGroups) {
      if (routes.length === 0) continue;

      if (arriveByTarget !== null) {
        // Closest arrival to target first, while avoiding excessively walk-heavy options.
        routes.sort((a, b) => {
          const scoreA = getArriveByScore(a);
          const scoreB = getArriveByScore(b);
          if (scoreA !== scoreB) return scoreA - scoreB;

          const arrA = timeToMinutes(a.arrivalTime);
          const arrB = timeToMinutes(b.arrivalTime);

          // Tie-break: prefer later arrival (closer to target from below)
          if (arrA !== arrB) return arrB - arrA;

          // Then prefer shorter route
          return a.durationMinutes - b.durationMinutes;
        });

        // In arrive-by mode, keep multiple near-target options per pattern so
        // users can choose between alternatives that may have similar timings.
        const perPatternKeep = 3;
        for (let i = 0; i < Math.min(perPatternKeep, routes.length); i++) {
          uniqueRoutes.push(routes[i]);
        }
      } else {
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
    }

    // Sort results BEFORE geometry enrichment (sort is cheap, geometry is expensive)
    // When arriveBy is set, filter out routes that arrive AFTER the target time
    if (arriveByTarget !== null) {
      const grace = 5; // allow a small 5-minute grace window
      for (let i = uniqueRoutes.length - 1; i >= 0; i--) {
        const arr = timeToMinutes(uniqueRoutes[i].arrivalTime);
        if (arr > arriveByTarget + grace) {
          uniqueRoutes.splice(i, 1);
        }
      }
      console.log(`[arriveBy] after filter: ${uniqueRoutes.length} routes arrive by ${arriveBy}`);
    }

    // Sort results according to mode.
    // Arrive-by mode always prioritises closeness to the target arrival time.
    if (arriveByTarget !== null) {
      uniqueRoutes.sort((a, b) => {
        const scoreA = getArriveByScore(a);
        const scoreB = getArriveByScore(b);
        if (scoreA !== scoreB) return scoreA - scoreB;

        const arrA = timeToMinutes(a.arrivalTime);
        const arrB = timeToMinutes(b.arrivalTime);

        // Prefer later arrivals (closer to target) if same score
        if (arrA !== arrB) return arrB - arrA;

        return a.durationMinutes - b.durationMinutes;
      });
    } else if (sortBy === 'changes') {
      const countChanges = (r) => r.legs.filter(l => l.type === 'bus' || l.type === 'train').length;
      uniqueRoutes.sort((a, b) => {
        const diff = countChanges(a) - countChanges(b);
        if (diff !== 0) return diff;
        return timeToMinutes(a.arrivalTime) - timeToMinutes(b.arrivalTime);
      });
    } else if (sortBy === 'arrival') {
      uniqueRoutes.sort((a, b) => timeToMinutes(a.arrivalTime) - timeToMinutes(b.arrivalTime));
    } else if (sortBy === 'duration') {
      uniqueRoutes.sort((a, b) => a.durationMinutes - b.durationMinutes);
    } else {
      uniqueRoutes.sort((a, b) => timeToMinutes(a.departureTime) - timeToMinutes(b.departureTime));
    }

    // === Limit to top routes BEFORE expensive geometry fetching ===
    const MAX_ROUTES_WITH_GEOMETRY = 8;
    const topRoutes = uniqueRoutes.slice(0, MAX_ROUTES_WITH_GEOMETRY);
    _mark('filterSort');

    // === Fetch road/rail-following geometry ONLY for the top routes ===
    await enrichLegsWithGeometry(topRoutes);
    _mark('enrichGeometry');

    _mark('done');
    console.log(`[PERF] /api/plan total=${_timers.done}ms | candidates=${allRoutes.length} filtered=${uniqueRoutes.length} displayed=${topRoutes.length} |`, Object.entries(_timers).map(([k,v]) => `${k}=${v}ms`).join(' '));

    res.json({
      start: {
        atco: resolvedStart,
        name: startPlaceName || startStop.common_name,
        coordinates: startPlaceCoords || { lon: startStop.lon, lat: startStop.lat },
        resolvedStop: startWalkLeg ? startStop.common_name : undefined
      },
      end: {
        atco: resolvedEnd,
        name: endPlaceName || endStop.common_name,
        coordinates: endPlaceCoords || { lon: endStop.lon, lat: endStop.lat },
        resolvedStop: endWalkLeg ? endStop.common_name : undefined
      },
      directDistance_km: Math.round(directDistance * 100) / 100,
      departureTime: departureTime,
      dayOfWeek: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][dayIndex],
      sortedBy: sortBy,
      routes: topRoutes,
      totalRoutes: uniqueRoutes.length,
      nearbyRailStations: {
        start: startRailStations,
        end: endRailStations
      }
    });

  } catch (err) {
    console.error('Route planner error:', err);
    res.status(500).json({ error: 'Failed to plan route', details: err.message });
  }
});

// ─── Weather endpoint (Open-Meteo — free, no API key required) ──────
/**
 * Map WMO weather codes to { main, description, iconBase } so the frontend
 * receives the same shape it used with OpenWeatherMap.
 * Reference: https://open-meteo.com/en/docs#weathervariables
 */
const wmoCodeMap = {
  0:  { main: 'Clear',        description: 'clear sky',            iconBase: '01' },
  1:  { main: 'Clear',        description: 'mainly clear',         iconBase: '01' },
  2:  { main: 'Clouds',       description: 'partly cloudy',        iconBase: '02' },
  3:  { main: 'Clouds',       description: 'overcast',             iconBase: '04' },
  45: { main: 'Fog',          description: 'fog',                  iconBase: '50' },
  48: { main: 'Fog',          description: 'depositing rime fog',  iconBase: '50' },
  51: { main: 'Drizzle',      description: 'light drizzle',        iconBase: '09' },
  53: { main: 'Drizzle',      description: 'moderate drizzle',     iconBase: '09' },
  55: { main: 'Drizzle',      description: 'dense drizzle',        iconBase: '09' },
  56: { main: 'Drizzle',      description: 'light freezing drizzle', iconBase: '09' },
  57: { main: 'Drizzle',      description: 'dense freezing drizzle', iconBase: '09' },
  61: { main: 'Rain',         description: 'slight rain',          iconBase: '10' },
  63: { main: 'Rain',         description: 'moderate rain',        iconBase: '10' },
  65: { main: 'Rain',         description: 'heavy rain',           iconBase: '10' },
  66: { main: 'Rain',         description: 'light freezing rain',  iconBase: '10' },
  67: { main: 'Rain',         description: 'heavy freezing rain',  iconBase: '10' },
  71: { main: 'Snow',         description: 'slight snow fall',     iconBase: '13' },
  73: { main: 'Snow',         description: 'moderate snow fall',   iconBase: '13' },
  75: { main: 'Snow',         description: 'heavy snow fall',      iconBase: '13' },
  77: { main: 'Snow',         description: 'snow grains',          iconBase: '13' },
  80: { main: 'Rain',         description: 'slight rain showers',  iconBase: '09' },
  81: { main: 'Rain',         description: 'moderate rain showers',iconBase: '09' },
  82: { main: 'Rain',         description: 'violent rain showers', iconBase: '09' },
  85: { main: 'Snow',         description: 'slight snow showers',  iconBase: '13' },
  86: { main: 'Snow',         description: 'heavy snow showers',   iconBase: '13' },
  95: { main: 'Thunderstorm', description: 'thunderstorm',         iconBase: '11' },
  96: { main: 'Thunderstorm', description: 'thunderstorm with slight hail', iconBase: '11' },
  99: { main: 'Thunderstorm', description: 'thunderstorm with heavy hail',  iconBase: '11' },
};

app.get('/api/weather', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon query parameters are required' });
    }

    const params = [
      `latitude=${encodeURIComponent(lat)}`,
      `longitude=${encodeURIComponent(lon)}`,
      'current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,rain,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,visibility',
      'wind_speed_unit=kmh',
      'timezone=auto'
    ].join('&');

    const url = `https://api.open-meteo.com/v1/forecast?${params}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.error) {
      return res.status(response.status || 500).json({ error: data.reason || 'Weather API error' });
    }

    const c = data.current;
    const code = c.weather_code;
    const wmo = wmoCodeMap[code] || { main: 'Clouds', description: 'unknown', iconBase: '03' };
    const daySuffix = c.is_day ? 'd' : 'n';

    res.json({
      temp: Math.round(c.temperature_2m),
      feels_like: Math.round(c.apparent_temperature),
      humidity: Math.round(c.relative_humidity_2m),
      wind_speed: Math.round(c.wind_speed_10m),       // already km/h
      wind_gust: c.wind_gusts_10m ? Math.round(c.wind_gusts_10m) : null,
      description: wmo.description,
      icon: wmo.iconBase + daySuffix,                  // e.g. '01d', '10n'
      main: wmo.main,                                  // e.g. 'Rain', 'Clear'
      visibility: c.visibility != null ? Math.round(c.visibility / 1000) : null, // m → km
      rain_1h: c.rain || 0,                            // mm in last interval
      snow_1h: c.snowfall || 0,                        // cm → treated as mm equivalent
      clouds: c.cloud_cover || 0,
      location_name: null                              // Open-Meteo doesn't provide a place name
    });
  } catch (err) {
    console.error('Weather API error:', err);
    res.status(500).json({ error: 'Failed to fetch weather data' });
  }
});

// ─── LIVE BUS TRACKING ──────────────────────────────────────────────────────

/**
 * Known bus operator NOC codes for the Lancashire area.
 * These are used to fetch live SIRI vehicle positions from the transport API.
 */
const BUS_OPERATOR_NOCS = ['SCCU', 'SCNW', 'SCMY', 'ARCT', 'BLAC'];

/**
 * Parse SIRI VehicleMonitoringDelivery XML into structured JSON vehicles.
 * Returns an array of vehicle objects with position, route, bearing, etc.
 */
function parseSiriVehicles(xmlData) {
  const xml2js = require('xml2js');
  return new Promise((resolve, reject) => {
    xml2js.parseString(xmlData, { explicitArray: false, ignoreAttrs: false }, (err, result) => {
      if (err) return reject(err);
      try {
        const siri = result?.Siri || result?.['Siri'];
        const delivery = siri?.ServiceDelivery?.VehicleMonitoringDelivery;
        if (!delivery) return resolve([]);

        let activities = delivery.VehicleActivity;
        if (!activities) return resolve([]);
        if (!Array.isArray(activities)) activities = [activities];

        const vehicles = activities.map(activity => {
          const journey = activity.MonitoredVehicleJourney || {};
          const loc = journey.VehicleLocation || {};
          const ext = activity.Extensions?.VehicleJourney || {};
          return {
            vehicleRef: journey.VehicleRef || null,
            vehicleId: ext?.VehicleUniqueId || journey.VehicleRef || null,
            lineRef: journey.LineRef || null,
            lineName: journey.PublishedLineName || journey.LineRef || null,
            operatorRef: journey.OperatorRef || null,
            directionRef: journey.DirectionRef || null,
            originRef: journey.OriginRef || null,
            originName: (journey.OriginName || '').replace(/_/g, ' '),
            destinationRef: journey.DestinationRef || null,
            destinationName: (journey.DestinationName || '').replace(/_/g, ' '),
            aimedDeparture: journey.OriginAimedDepartureTime || null,
            aimedArrival: journey.DestinationAimedArrivalTime || null,
            latitude: loc.Latitude ? parseFloat(loc.Latitude) : null,
            longitude: loc.Longitude ? parseFloat(loc.Longitude) : null,
            bearing: journey.Bearing ? parseFloat(journey.Bearing) : null,
            recordedAt: activity.RecordedAtTime || null,
            validUntil: activity.ValidUntilTime || null,
            journeyCode: ext?.Operational?.TicketMachine?.JourneyCode || null,
          };
        }).filter(v => v.latitude !== null && v.longitude !== null);

        resolve(vehicles);
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

/**
 * GET /api/bus/live/route/:routeNumber
 * Get live buses for a specific route number across all operators.
 * Must be defined BEFORE /api/bus/live/:noc to avoid "route" matching as a NOC code.
 */
app.get('/api/bus/live/route/:routeNumber', async (req, res) => {
  try {
    const { routeNumber } = req.params;
    const https = require('https');

    // Fetch from all operators simultaneously
    const fetchOperator = (noc) => new Promise((resolve) => {
      const url = `https://transport.scc.lancs.ac.uk/bus/live/${noc}`;
      https.get(url, { timeout: 10000 }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', async () => {
          try {
            const vehicles = await parseSiriVehicles(data);
            resolve(vehicles);
          } catch {
            resolve([]);
          }
        });
      }).on('error', () => resolve([]))
        .on('timeout', function() { this.destroy(); resolve([]); });
    });

    const results = await Promise.all(BUS_OPERATOR_NOCS.map(fetchOperator));
    let allVehicles = results.flat();

    // Filter to the requested route number
    allVehicles = allVehicles.filter(v =>
      v.lineName === routeNumber || v.lineRef === routeNumber
    );

    // Deduplicate
    const seen = new Set();
    allVehicles = allVehicles.filter(v => {
      const key = v.vehicleRef || v.vehicleId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({
      routeNumber: routeNumber,
      timestamp: new Date().toISOString(),
      count: allVehicles.length,
      vehicles: allVehicles
    });
  } catch (err) {
    console.error('Bus live route endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/bus/live/:noc
 * Get live GPS positions for all vehicles of a given operator.
 * Optional query params: ?line=100 (filter by route number)
 */
app.get('/api/bus/live/:noc', async (req, res) => {
  try {
    const { noc } = req.params;
    const lineFilter = req.query.line;
    const https = require('https');

    const url = `https://transport.scc.lancs.ac.uk/bus/live/${noc.toUpperCase()}`;

    https.get(url, { timeout: 10000 }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', async () => {
        try {
          let vehicles = await parseSiriVehicles(data);

          // Filter by line/route if requested
          if (lineFilter) {
            vehicles = vehicles.filter(v =>
              v.lineName === lineFilter || v.lineRef === lineFilter
            );
          }

          res.json({
            operator: noc.toUpperCase(),
            timestamp: new Date().toISOString(),
            count: vehicles.length,
            vehicles: vehicles
          });
        } catch (parseErr) {
          console.error('Failed to parse bus live data:', parseErr);
          res.status(500).json({ error: 'Failed to parse live bus data' });
        }
      });
    }).on('error', (err) => {
      console.error('Bus live fetch error:', err);
      res.status(500).json({ error: `Failed to fetch live data: ${err.message}` });
    }).on('timeout', function() {
      this.destroy();
      res.status(500).json({ error: 'Transport API timed out' });
    });
  } catch (err) {
    console.error('Bus live endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/bus/live
 * Get live GPS positions for ALL known operators in the Lancashire area.
 * Optional query params: ?line=100 (filter by route number)
 */
app.get('/api/bus/live', async (req, res) => {
  try {
    const https = require('https');
    const lineFilter = req.query.line;

    const fetchOperator = (noc) => new Promise((resolve) => {
      const url = `https://transport.scc.lancs.ac.uk/bus/live/${noc}`;
      https.get(url, { timeout: 10000 }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', async () => {
          try {
            const vehicles = await parseSiriVehicles(data);
            resolve(vehicles);
          } catch {
            resolve([]);
          }
        });
      }).on('error', () => resolve([]))
        .on('timeout', function() { this.destroy(); resolve([]); });
    });

    const results = await Promise.all(BUS_OPERATOR_NOCS.map(fetchOperator));
    let allVehicles = results.flat();

    // Deduplicate by vehicleRef (some operators may overlap)
    const seen = new Set();
    allVehicles = allVehicles.filter(v => {
      const key = v.vehicleRef || v.vehicleId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter by line/route if requested
    if (lineFilter) {
      allVehicles = allVehicles.filter(v =>
        v.lineName === lineFilter || v.lineRef === lineFilter
      );
    }

    // Filter to Lancashire bounding box (roughly)
    const LANCASHIRE_BOUNDS = {
      minLat: 53.5, maxLat: 54.2,
      minLon: -3.1, maxLon: -2.5
    };
    allVehicles = allVehicles.filter(v =>
      v.latitude >= LANCASHIRE_BOUNDS.minLat && v.latitude <= LANCASHIRE_BOUNDS.maxLat &&
      v.longitude >= LANCASHIRE_BOUNDS.minLon && v.longitude <= LANCASHIRE_BOUNDS.maxLon
    );

    res.json({
      operators: BUS_OPERATOR_NOCS,
      timestamp: new Date().toISOString(),
      count: allVehicles.length,
      vehicles: allVehicles
    });
  } catch (err) {
    console.error('Bus live all endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── ROAD / MOTORWAY VMS SIGNS ──────────────────────────────────────────────

/**
 * GET /api/road/vms
 * Get Variable Message Sign data for motorways in the Lancashire area.
 * Returns active messages from signs on the M6, M55, M65 etc.
 */
app.get('/api/road/vms', async (req, res) => {
  try {
    const https = require('https');
    const xml2js = require('xml2js');

    const url = 'https://transport.scc.lancs.ac.uk/road/vms';

    https.get(url, { timeout: 15000 }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        xml2js.parseString(data, { explicitArray: false, ignoreAttrs: true }, (err, result) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to parse VMS data' });
          }

          try {
            const payload = result?.D2Payload;
            let controllers = payload?.vmsControllerStatus;
            if (!controllers) return res.json({ signs: [] });
            if (!Array.isArray(controllers)) controllers = [controllers];

            // Lancashire area roads of interest
            const LANCASHIRE_ROADS = ['M6', 'M55', 'M65', 'A6', 'A583', 'A585', 'A588', 'A59'];

            const signs = [];
            for (const ctrl of controllers) {
              const status = ctrl?.vmsStatus?.vmsStatus;
              if (!status) continue;

              const ext = status?.vmsStatusExtensionG;
              if (!ext) continue;

              // Check if the sign is on a Lancashire road
              const loc = ext?.vmsLocation?.locPointLocation;
              const desc = loc?.supplementaryPositionalDescription;
              const roadName = desc?.roadInformation?.roadName || '';
              const locationDesc = desc?.locationDescription || '';

              // Filter to Lancashire area roads
              const isLancashireRoad = LANCASHIRE_ROADS.some(road =>
                roadName.startsWith(road) || locationDesc.includes(road)
              );
              if (!isLancashireRoad) continue;

              // Get coordinates
              const coords = loc?.pointByCoordinates?.pointCoordinates;
              const lat = coords?.latitude ? parseFloat(coords.latitude) : null;
              const lon = coords?.longitude ? parseFloat(coords.longitude) : null;

              // Filter by Lancashire bounding box
              if (lat && lon) {
                if (lat < 53.5 || lat > 54.2 || lon < -3.2 || lon > -2.4) continue;
              }

              // Get message info
              const msg = status?.vmsMessage?.vmsMessage;
              const messageText = msg?.reasonForSetting || '';
              const messageType = msg?.messageInformationType || '';
              const lastSet = msg?.timeLastSet || '';

              signs.push({
                id: ext?.externalIdentifier || ctrl?.vmsControllerReference?.idG || null,
                type: ext?.vmsType || null,
                description: ext?.description || null,
                road: roadName,
                location: locationDesc,
                direction: desc?.supplementaryPositionalDescriptionExtensionG?.direction || null,
                latitude: lat,
                longitude: lon,
                workingStatus: status?.workingStatus?.trim() || null,
                messageType: messageType,
                messageText: messageText,
                lastUpdated: lastSet,
              });
            }

            res.json({
              timestamp: payload?.publicationTime || new Date().toISOString(),
              count: signs.length,
              signs: signs
            });
          } catch (parseErr) {
            console.error('VMS parse error:', parseErr);
            res.status(500).json({ error: 'Failed to parse VMS data' });
          }
        });
      });
    }).on('error', (err) => {
      res.status(500).json({ error: `Failed to fetch VMS data: ${err.message}` });
    }).on('timeout', function() {
      this.destroy();
      res.status(504).json({ error: 'VMS API timed out' });
    });
  } catch (err) {
    console.error('VMS endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ─── Ensure auth tables exist before accepting requests ───
async function ensureAuthSchema() {
  try {
    const tableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS exists`
    );
    if (!tableCheck.rows[0].exists) {
      console.log('Auth tables not found – creating them now...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          first_name VARCHAR(100) NOT NULL,
          last_name VARCHAR(100) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          email_verified BOOLEAN DEFAULT FALSE,
          points INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

        CREATE TABLE IF NOT EXISTS email_verification_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token VARCHAR(255) UNIQUE NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_email_verification_token ON email_verification_tokens(token);

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token VARCHAR(255) UNIQUE NOT NULL,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          used BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token);

        CREATE TABLE IF NOT EXISTS point_transactions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          points INTEGER NOT NULL,
          type VARCHAR(50) NOT NULL,
          description TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_point_transactions_user ON point_transactions(user_id);
        CREATE INDEX IF NOT EXISTS idx_point_transactions_created ON point_transactions(created_at);

        CREATE TABLE IF NOT EXISTS user_sessions (
          sid VARCHAR NOT NULL COLLATE "default",
          sess JSON NOT NULL,
          expire TIMESTAMP(6) NOT NULL,
          PRIMARY KEY (sid)
        );
        CREATE INDEX IF NOT EXISTS idx_session_expire ON user_sessions(expire);

        CREATE TABLE IF NOT EXISTS rewards (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          points_cost INTEGER NOT NULL,
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS redeemed_rewards (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reward_id INTEGER NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
          redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        INSERT INTO rewards (name, description, points_cost) VALUES
          ('10% Off Next Ticket', 'Get 10% discount on your next bus or train ticket', 100),
          ('Free Day Pass', 'A free day pass for unlimited bus travel in the Lancashire area', 500),
          ('Priority Seat Booking', 'Book a priority seat on your next journey', 50),
          ('Monthly Pass Discount', 'Get £5 off a monthly travel pass', 250)
        ON CONFLICT DO NOTHING;
      `);
      console.log('✓ Auth tables created successfully');
    } else {
      console.log('Auth tables verified');
    }
  } catch (err) {
    console.error('Failed to ensure auth schema (will retry on next request):', err.message);
  }
}

// ── Start server (only when run directly, not when imported by tests) ──
if (require.main === module) {
  ensureAuthSchema().then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  });
}

module.exports = app;

// ── Re-export pure functions for unit tests ─────────────────────────
// Tests access these via  app._test.functionName
module.exports._test = {
  haversineDistance,
  calculateBearing,
  decodeValhallaPolyline,
  timeToMinutes,
  minutesToTime,
  getDayIndex,
  safeDuration,
  mergeConsecutiveWalkLegs,
  getStationCoords,
  parseSiriVehicles,
  STATION_COORDS,
};
