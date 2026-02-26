const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

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
  password: process.env.DB_PASSWORD || 'group1'
});

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
        headers: { 'User-Agent': 'Group1-LancasterTravelPlanner/1.0' }
      }, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
        response.on('error', reject);
      }).on('error', reject);
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
app.get('/api/reverse-geocode', async (req, res) => {
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
        headers: { 'User-Agent': 'Group1-LancasterTravelPlanner/1.0' }
      }, (response) => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(e); }
        });
        response.on('error', reject);
      }).on('error', reject);
    });

    if (data && data.address) {
      const a = data.address;
      // Build a concise name: road + suburb/village or town
      const road = a.road || a.pedestrian || a.footway || a.path || '';
      const area = a.suburb || a.village || a.hamlet || a.neighbourhood || a.town || a.city || '';
      const name = [road, area].filter(Boolean).join(', ') || data.display_name?.split(',').slice(0, 2).join(',') || 'My Location';
      return res.json({ name, fullName: data.display_name });
    }

    res.json({ name: 'My Location' });
  } catch (err) {
    console.error('Reverse geocode error:', err.message);
    res.json({ name: 'My Location' });
  }
});

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
    
    https.get(url, (response) => {
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
                    callingPoints.push({
                      name: cp?.['lt8:locationName'] || cp?.['lt4:locationName'],
                      crs: cp?.['lt8:crs'] || cp?.['lt4:crs'],
                      scheduledTime: cp?.['lt8:st'] || cp?.['lt4:st'],
                      estimatedTime: cp?.['lt8:et'] || cp?.['lt4:et'],
                    });
                  }
                }
                
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
                    crs: origin?.['lt4:crs']
                  },
                  destination: {
                    name: dest?.['lt4:locationName'],
                    crs: dest?.['lt4:crs']
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
 */
function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
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
          waitMinutes: timeToMinutes(r.train2_depart) - timeToMinutes(r.train1_arrive)
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

      // fromCoords: if first leg use startStop, otherwise use previous leg's toCoords
      if (i === 0) {
        leg.fromCoords = coordMap[startStop.atco_code];
      } else {
        const prevLeg = route.legs[i - 1];
        leg.fromCoords = prevLeg.toCoords || null;
      }

      // toCoords: if last leg use endStop, otherwise use next leg's fromCoords
      if (i === route.legs.length - 1) {
        leg.toCoords = coordMap[endStop.atco_code];
      } else {
        const nextLeg = route.legs[i + 1];
        leg.toCoords = nextLeg.fromCoords || null;
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
 * Fetch road-following geometry from Valhalla for a bus route with multiple waypoints.
 * Uses 'bus' costing with heading constraints to ensure correct direction of travel.
 * Waypoints: array of { lat, lon } objects (bus stop positions in order).
 * Returns array of [lat, lon] pairs forming the full road-snapped route, or null.
 *
 * For routes with many stops, we sample key waypoints to stay within API limits
 * and still produce an accurate road-following route.
 */
async function fetchValhallaBusGeometry(waypoints) {
  if (!waypoints || waypoints.length < 2) return null;

  // Valhalla handles up to ~50 locations per request.
  // For longer routes, sample intermediate stops while keeping first and last.
  let routeWaypoints = waypoints;
  if (waypoints.length > 50) {
    const step = Math.ceil((waypoints.length - 2) / 48);
    routeWaypoints = [waypoints[0]];
    for (let i = 1; i < waypoints.length - 1; i += step) {
      routeWaypoints.push(waypoints[i]);
    }
    routeWaypoints.push(waypoints[waypoints.length - 1]);
  }

  // Build locations with heading info so Valhalla knows direction of travel.
  // This prevents routing the wrong way on one-way streets or approaching
  // stops from the wrong side of the road.
  const locations = routeWaypoints.map((w, i) => {
    const loc = {
      lat: w.lat,
      lon: w.lon,
      type: i === 0 || i === routeWaypoints.length - 1 ? 'break' : 'via'
    };

    // Calculate heading from this stop toward the next stop.
    // For the last stop, use heading from the previous stop.
    if (i < routeWaypoints.length - 1) {
      const next = routeWaypoints[i + 1];
      loc.heading = Math.round(calculateBearing(w.lat, w.lon, next.lat, next.lon));
    } else {
      const prev = routeWaypoints[i - 1];
      loc.heading = Math.round(calculateBearing(prev.lat, prev.lon, w.lat, w.lon));
    }
    loc.heading_tolerance = 60; // degrees of tolerance

    return loc;
  });

  // Try bus costing first (respects bus lanes, transit routes), fall back to auto
  const costings = ['bus', 'auto'];
  for (const costing of costings) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const requestBody = JSON.stringify({
          locations: locations,
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
          timeout: 10000
        };

        const req = https.request(options, (response) => {
          let data = '';
          response.on('data', chunk => data += chunk);
          response.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.trip && parsed.trip.legs) {
                // Combine geometry from all legs into a single polyline
                const allPoints = [];
                for (const leg of parsed.trip.legs) {
                  if (leg.shape) {
                    const points = decodeValhallaPolyline(leg.shape);
                    if (allPoints.length > 0 && points.length > 0) {
                      points.shift(); // Remove duplicate junction point
                    }
                    allPoints.push(...points);
                  }
                }
                resolve(allPoints.length >= 2 ? allPoints : null);
              } else {
                resolve(null);
              }
            } catch {
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
        await delay(500);
        continue;
      }
      if (result === 'retry') break; // try next costing
      if (result) return result; // success
      break; // null result, try next costing
    } catch {
      break; // try next costing
    }
  } // end attempts
  } // end costings
  return null;
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
    console.log(`Valhalla bus route queue: ${busRequests.length} unique requests`);

    // Process bus route geometry in batches of 2 (larger payloads than walk)
    const BUS_BATCH = 2;
    for (let i = 0; i < busRequests.length; i += BUS_BATCH) {
      const batch = busRequests.slice(i, i + BUS_BATCH);

      await Promise.allSettled(batch.map(async ({ leg, waypoints, cacheKey }) => {
        // Try Valhalla first for best quality road-following geometry
        let geometry = await fetchValhallaBusGeometry(waypoints);

        // Fallback to OSRM if Valhalla fails
        if (!geometry || geometry.length < 2) {
          geometry = await fetchOSRMGeometry(waypoints, 'driving');
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
        // else: keeps the straight-line stop waypoints as fallback

        delete leg._busWaypoints;
      }));

      // Small delay between batches to respect rate limits
      if (i + BUS_BATCH < busRequests.length) {
        await delay(200);
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

    // Process in batches of 3 with retry
    const BATCH_SIZE = 3;
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
    const { start, end, time, day, sort, startLat, startLon, endLat, endLon, startName, endName } = req.query;
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

      // Find nearest bus stop with routes (priority)
      const busNear = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s
        WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < $3 AND ABS(s.coordinates[1] - $2) < $3
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [sLon, sLat, degDelta]);

      // Also check rail stations (same radius)
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
    const sortBy = sort || 'departure';

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
    const [directBus, startRailStations, endRailStations] = await Promise.all([
      findDirectBusJourneys(resolvedStart, resolvedEnd, departureTime, dayIndex, 5),
      findNearbyRailStations(resolvedStart, 5.0),
      findNearbyRailStations(resolvedEnd, 5.0)
    ]);
    _mark('directBus+nearbyRail');

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
    let busEndCodes = [resolvedEnd]; // ATCO codes to use as bus destination
    let busStartCodes = [resolvedStart]; // ATCO codes to use as bus origin
    if (endIsRail) {
      const nearbyBusStops = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s
        WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < 0.008 AND ABS(s.coordinates[1] - $2) < 0.008
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [parseFloat(endStop.lon), parseFloat(endStop.lat)]);
      const endBusStops = nearbyBusStops.rows.map(r => ({
        ...r, dist: haversineDistance(parseFloat(endStop.lat), parseFloat(endStop.lon), parseFloat(r.lat), parseFloat(r.lon))
      })).filter(r => r.dist <= 1.0).sort((a, b) => a.dist - b.dist).slice(0, 5);
      if (endBusStops.length > 0) {
        busEndCodes = endBusStops.map(s => s.atco_code);
      }
    }
    if (startIsRail) {
      const nearbyBusStops = await pool.query(`
        SELECT s.atco_code, s.common_name, s.coordinates[0] as lon, s.coordinates[1] as lat
        FROM stops s
        WHERE s.coordinates IS NOT NULL AND s.atco_code NOT LIKE '9100%'
          AND ABS(s.coordinates[0] - $1) < 0.008 AND ABS(s.coordinates[1] - $2) < 0.008
          AND EXISTS (SELECT 1 FROM bus_journey_stops bjs WHERE bjs.atco_code = s.atco_code LIMIT 1)
      `, [parseFloat(startStop.lon), parseFloat(startStop.lat)]);
      const startBusStops = nearbyBusStops.rows.map(r => ({
        ...r, dist: haversineDistance(parseFloat(startStop.lat), parseFloat(startStop.lon), parseFloat(r.lat), parseFloat(r.lon))
      })).filter(r => r.dist <= 1.0).sort((a, b) => a.dist - b.dist).slice(0, 5);
      if (startBusStops.length > 0) {
        busStartCodes = startBusStops.map(s => s.atco_code);
      }
    }

    // === Strategy 3: Direct train (if both near rail stations) ===
    let directTrain = [];
    if (startTiplocs.length > 0 && endTiplocs.length > 0) {
      const walkToStation = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
      const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStation) + ':00';
      directTrain = await findDirectTrainJourneys(startTiplocs, endTiplocs, trainDepartAfter, 5);
    }

    _mark('directTrain');

    // === Strategy 2b: Direct bus to/from bus stops near rail stations ===
    // When start or end is a rail station, also search for bus routes to/from nearby bus stops
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
    // Also search expanded codes for start (bus) -> end near rail
    if (endIsRail && busEndCodes.length > 0 && startIsRail && busStartCodes.length > 0) {
      for (const busStartCode of busStartCodes) {
        for (const busEndCode of busEndCodes) {
          const extra = await findDirectBusJourneys(busStartCode, busEndCode, departureTime, dayIndex, 3);
          extraDirectBus.push(...extra);
        }
      }
    }
    // Deduplicate extra bus results
    const seenBusJourneys = new Set(directBus.map(b => b.journeyId));
    for (const bus of extraDirectBus) {
      if (!seenBusJourneys.has(bus.journeyId)) {
        seenBusJourneys.add(bus.journeyId);
        directBus.push(bus);
      }
    }

    // === Strategy 4: Train + Train connections ===
    let trainConnections = [];
    if (startTiplocs.length > 0 && endTiplocs.length > 0 && directTrain.length === 0) {
      const walkToStation = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
      const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStation) + ':00';
      trainConnections = await findTrainTrainConnections(startTiplocs, endTiplocs, trainDepartAfter, 5);
    }

    _mark('trainConnections');

    // === Strategy 5: Bus → Train → Walk/Bus (and reverse) ===
    let multiModal = [];

    // 5a: If start is walkable to rail, use walk+train strategies (already covered by Strategy 3/4)
    // 5b: Bus → Train (find rail stations reachable by bus from the start)
    {
      const busReachableFromStart = await findBusReachableRailStations(resolvedStart, dayIndex, departureTime, 5);

      // Merge endTiplocs with any rail stations walkable from end
      let targetTiplocs = [...endTiplocs];
      // If end IS a rail station, ensure its TIPLOC is included
      if (endIsRail) {
        const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [resolvedEnd]);
        if (r.rows.length > 0 && !targetTiplocs.includes(r.rows[0].tiploc_code)) {
          targetTiplocs.unshift(r.rows[0].tiploc_code);
        }
      }

      for (const station of busReachableFromStart) {
        // Skip if this station is the end destination itself (already handled by direct train)
        if (station.atco_code === resolvedEnd) continue;

        // Find the actual bus journey from origin to the bus stop near this rail station
        const busLegs = await findDirectBusJourneys(resolvedStart, station.bus_stop_atco, departureTime, dayIndex, 3);

        for (const bus of busLegs) {
          // Calculate walk time from bus stop to rail station (short walk, ~300m max)
          const busStopInfo = await pool.query(
            `SELECT coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code = $1`, [station.bus_stop_atco]
          );
          const railStopInfo = await pool.query(
            `SELECT coordinates[0] as lon, coordinates[1] as lat FROM stops WHERE atco_code = $1`, [station.atco_code]
          );
          let walkToStationMins = 2; // default short walk
          if (busStopInfo.rows[0] && railStopInfo.rows[0]) {
            const walkDist = haversineDistance(
              busStopInfo.rows[0].lat, busStopInfo.rows[0].lon,
              railStopInfo.rows[0].lat, railStopInfo.rows[0].lon
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

      let sourceTiplocs = [...startTiplocs];
      if (startIsRail) {
        const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [resolvedStart]);
        if (r.rows.length > 0 && !sourceTiplocs.includes(r.rows[0].tiploc_code)) {
          sourceTiplocs.unshift(r.rows[0].tiploc_code);
        }
      }

      // Also try bus-reachable stations from start as source TIPLOCs
      // (in case start isn't within walking distance of a station)
      if (sourceTiplocs.length === 0) {
        const busReachableStart = await findBusReachableRailStations(resolvedStart, dayIndex, departureTime, 3);
        // For train→bus, we can still use bus→train→bus but that gets complex.
        // Instead just use walk-reachable start stations.
        // (bus→train→bus is handled by combining 5b with 5c results)
      }

      if (sourceTiplocs.length > 0) {
        for (const endStation of busReachableFromEnd) {
          if (endStation.atco_code === start) continue;

          // Find trains from start area to this rail station
          const walkToStart = startRailStations.length > 0 && !startIsRail ? startRailStations[0].walk_minutes : 0;
          const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStart) + ':00';

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

    // 5d: Walk-based multi-modal (original logic for walkable rail stations)
    if (startRailStations.length > 0 || endRailStations.length > 0) {
      // Try: walk to rail station, train, then bus from end station
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
                ...(walkToStart > 0 ? [{
                  type: 'walk',
                  fromName: startStop.common_name,
                  toName: startRailStations[0].common_name,
                  duration: walkToStart,
                  distance_km: startRailStations[0].walk_km
                }] : []),
                train,
                ...(endStation.walk_minutes > 2 ? [{
                  type: 'walk',
                  fromName: endStation.common_name,
                  toName: 'Bus stop',
                  duration: endStation.walk_minutes,
                  distance_km: endStation.walk_km
                }] : []),
                bus
              ]
            });
          }
        }
      }

      // Try: bus from start → walk-reachable rail station, then train (direct or with connection)
      for (const startStation of startRailStations.slice(0, 2)) {
        if (endTiplocs.length === 0) continue;

        const nearStart = await findNearbyBusStops(startStation.atco_code, 1.0);
        for (const nearStop of nearStart.slice(0, 3)) {
          const busLegs = await findDirectBusJourneys(resolvedStart, nearStop.atco_code, departureTime, dayIndex, 2);
          
          for (const bus of busLegs) {
            const arrivalMins = timeToMinutes(bus.alightTime) + 3;
            const trainAfter = minutesToTime(arrivalMins) + ':00';
            
            // Try direct trains first
            const trains = await findDirectTrainJourneys([startStation.tiploc_code], endTiplocs, trainAfter, 2);
            
            for (const train of trains) {
              const walkFromEnd = endRailStations.length > 0 ? endRailStations[0].walk_minutes : 0;
              multiModal.push({
                legs: [
                  bus,
                  {
                    type: 'walk',
                    fromName: nearStop.common_name,
                    toName: startStation.common_name,
                    duration: nearStop.walk_minutes,
                    distance_km: nearStop.walk_km
                  },
                  train,
                  ...(walkFromEnd > 0 && !endIsRail ? [{
                    type: 'walk',
                    fromName: endRailStations[0].common_name,
                    toName: endStop.common_name,
                    duration: walkFromEnd,
                    distance_km: endRailStations[0].walk_km
                  }] : [])
                ]
              });
            }

            // If no direct trains found, try train+train connections (e.g. bus→train→transfer→train)
            if (trains.length === 0) {
              const trainConns = await findTrainTrainConnections([startStation.tiploc_code], endTiplocs, trainAfter, 3);
              for (const conn of trainConns) {
                const lastTrainLeg = conn.legs[conn.legs.length - 1];
                const walkFromStation = endRailStations.find(s => s.tiploc_code === lastTrainLeg.endTiploc)
                  || endRailStations[0] || null;
                const walkFrom = walkFromStation ? walkFromStation.walk_minutes : 0;

                multiModal.push({
                  legs: [
                    bus,
                    {
                      type: 'walk',
                      fromName: nearStop.common_name,
                      toName: startStation.common_name,
                      duration: nearStop.walk_minutes,
                      distance_km: nearStop.walk_km
                    },
                    ...conn.legs,
                    ...(walkFrom > 0 && !endIsRail ? [{
                      type: 'walk',
                      fromName: walkFromStation.common_name,
                      toName: endStop.common_name,
                      duration: walkFrom,
                      distance_km: walkFromStation.walk_km
                    }] : [])
                  ]
                });
              }
            }
          }
        }
      }
    }

    _mark('multiModal');

    // === Strategy 6: Bus → Bus transfer ===
    let busTransfers = [];
    if (directBus.length === 0) {
      let startCodes = await expandStopCode(resolvedStart);
      let endCodes = await expandStopCode(resolvedEnd);
      // When start/end is a rail station, include nearby bus stops in the transfer search
      if (startIsRail && busStartCodes.length > 0) {
        for (const code of busStartCodes) {
          const expanded = await expandStopCode(code);
          startCodes = [...new Set([...startCodes, ...expanded])];
        }
      }
      if (endIsRail && busEndCodes.length > 0) {
        for (const code of busEndCodes) {
          const expanded = await expandStopCode(code);
          endCodes = [...new Set([...endCodes, ...expanded])];
        }
      }
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
              waitMinutes: timeToMinutes(r.transfer_depart) - timeToMinutes(r.transfer_arrive)
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
    if (directDistance <= 3.0) {
      const walkMinutes = Math.ceil(directDistance / 0.08); // ~5 km/h
      allRoutes.push({
        id: 'walk-only',
        summary: 'Walk',
        modes: ['walk'],
        departureTime: departureTime,
        arrivalTime: minutesToTime(timeToMinutes(departureTime) + walkMinutes) + ':00',
        durationMinutes: walkMinutes,
        legs: [{
          type: 'walk',
          fromName: startStop.common_name,
          toName: endStop.common_name,
          duration: walkMinutes,
          distance_km: Math.round(directDistance * 100) / 100
        }]
      });
    }

    _mark('busTransfers');

    // === Enrich all legs with coordinates for map polylines ===
    await enrichLegsWithCoordinates(allRoutes, startStop, endStop);
    _mark('enrichCoords');

    // === Fetch road/rail-following geometry for each leg ===
    await enrichLegsWithGeometry(allRoutes);
    _mark('enrichGeometry');

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
      // Enrich the merged/new walk legs with Valhalla geometry
      await enrichLegsWithGeometry(allRoutes);
    }

    // Filter out unreasonable routes:
    // - Remove routes taking > 4x the reasonable minimum for the distance
    // - Remove routes arriving later than the last sensible option
    // - Remove routes where any single walk leg exceeds 30 minutes (unless it's the only route type)
    const reasonableMinMinutes = Math.max(directDistance * 2, 15); // ~30 km/h avg transit
    const maxReasonableDuration = Math.max(reasonableMinMinutes * 5, 180);
    const maxWalkLegMinutes = 30; // cap individual walk legs at 30 minutes
    const filteredRoutes = allRoutes.filter(r => {
      if (r.durationMinutes <= 0 || r.durationMinutes > maxReasonableDuration) return false;
      // Filter out routes with excessively long walk legs (unless walk-only)
      if (r.id !== 'walk-only') {
        const walkLegs = r.legs.filter(l => l.type === 'walk');
        const maxWalk = Math.max(...walkLegs.map(l => l.duration || 0), 0);
        if (maxWalk > maxWalkLegMinutes) return false;
      }
      return true;
    });

    // Deduplicate routes by their actual transport legs (same times + route = same journey)
    const uniqueRoutes = [];
    const seenKeys = new Set();
    for (const r of filteredRoutes) {
      // Build a key from the actual transport legs (ignore walk/transfer legs)
      // Use route number + board time for buses and trainUid for trains
      // This collapses routes that differ only by which nearby stop they use
      const transportKey = r.legs
        .filter(l => l.type === 'bus' || l.type === 'train')
        .map(l => {
          if (l.type === 'bus') return `bus:${l.routeNumber}:${l.boardTime}`;
          return `train:${l.trainUid}`;
        })
        .join('→');
      const key = transportKey || `${r.departureTime}-${r.arrivalTime}-${r.summary}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueRoutes.push(r);
      }
    }

    // Sort results
    if (sortBy === 'arrival') {
      uniqueRoutes.sort((a, b) => timeToMinutes(a.arrivalTime) - timeToMinutes(b.arrivalTime));
    } else if (sortBy === 'duration') {
      uniqueRoutes.sort((a, b) => a.durationMinutes - b.durationMinutes);
    } else {
      uniqueRoutes.sort((a, b) => timeToMinutes(a.departureTime) - timeToMinutes(b.departureTime));
    }

    _mark('done');
    console.log(`[PERF] /api/plan total=${_timers.done}ms |`, Object.entries(_timers).map(([k,v]) => `${k}=${v}ms`).join(' '));

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
      routes: uniqueRoutes,
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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start the server only when run directly (not when imported by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
