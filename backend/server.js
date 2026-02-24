const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

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
    } else {
      stops = stops.slice(0, 5);
    }
    
    res.json(stops);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stops' });
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
async function findNearbyRailStations(atcoCode, maxDistKm = 1.0) {
  const result = await pool.query(`
    SELECT nr.tiploc_code, nr.crs_code, nr.atco_code as rail_atco,
           s_rail.common_name as rail_name,
           s_rail.coordinates[0] as rail_lon, s_rail.coordinates[1] as rail_lat,
           s_stop.coordinates[0] as stop_lon, s_stop.coordinates[1] as stop_lat
    FROM stops s_stop
    JOIN stops s_rail ON s_rail.atco_code LIKE '9100%'
      AND ABS(s_rail.coordinates[0] - s_stop.coordinates[0]) < 0.025
      AND ABS(s_rail.coordinates[1] - s_stop.coordinates[1]) < 0.025
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
  if (day !== undefined && day !== null) return parseInt(day);
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
app.get('/api/plan', async (req, res) => {
  try {
    const { start, end, time, day, sort } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: 'start and end ATCO codes required' });
    }

    const departureTime = time || `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}:00`;
    const dayIndex = getDayIndex(day);
    const sortBy = sort || 'departure'; // 'departure', 'arrival', 'duration'

    // Get coordinates for start and end stops
    const stopInfo = await pool.query(
      `SELECT atco_code, common_name, coordinates[0] as lon, coordinates[1] as lat, stop_type
       FROM stops WHERE atco_code IN ($1, $2)`,
      [start, end]
    );
    const startStop = stopInfo.rows.find(s => s.atco_code === start);
    const endStop = stopInfo.rows.find(s => s.atco_code === end);

    if (!startStop || !endStop) {
      return res.status(404).json({ error: 'One or both stops not found' });
    }

    const directDistance = haversineDistance(startStop.lat, startStop.lon, endStop.lat, endStop.lon);

    // === Strategy 1: Direct bus ===
    const directBus = await findDirectBusJourneys(start, end, departureTime, dayIndex, 5);

    // === Strategy 2: Find nearby rail stations for both start and end ===
    const startRailStations = await findNearbyRailStations(start, 1.5);
    const endRailStations = await findNearbyRailStations(end, 2.0);

    // Also check if start/end IS a rail station
    const startIsRail = start.startsWith('9100');
    const endIsRail = end.startsWith('9100');

    let startTiplocs = startRailStations.map(s => s.tiploc_code);
    let endTiplocs = endRailStations.map(s => s.tiploc_code);

    if (startIsRail) {
      const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [start]);
      if (r.rows.length > 0) startTiplocs = [r.rows[0].tiploc_code, ...startTiplocs];
    }
    if (endIsRail) {
      const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [end]);
      if (r.rows.length > 0) endTiplocs = [r.rows[0].tiploc_code, ...endTiplocs];
    }

    // === Strategy 3: Direct train (if both near rail stations) ===
    let directTrain = [];
    if (startTiplocs.length > 0 && endTiplocs.length > 0) {
      const walkToStation = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
      const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStation) + ':00';
      directTrain = await findDirectTrainJourneys(startTiplocs, endTiplocs, trainDepartAfter, 5);
    }

    // === Strategy 4: Train + Train connections ===
    let trainConnections = [];
    if (startTiplocs.length > 0 && endTiplocs.length > 0 && directTrain.length === 0) {
      const walkToStation = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
      const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStation) + ':00';
      trainConnections = await findTrainTrainConnections(startTiplocs, endTiplocs, trainDepartAfter, 5);
    }

    // === Strategy 5: Bus → Train → Walk/Bus (and reverse) ===
    let multiModal = [];
    if (startTiplocs.length > 0 || endTiplocs.length > 0) {
      // If start has rail and end has rail: walk+train+walk already covered
      // If start has rail but end doesn't: train to nearest station, then bus
      // If end has rail but start doesn't: bus to station, then train
      
      // Try: train from start area → each end rail station, then bus to end
      for (const endStation of endRailStations.slice(0, 2)) {
        if (startTiplocs.length === 0) continue;
        
        const walkToStart = startRailStations.length > 0 ? startRailStations[0].walk_minutes : 0;
        const trainDepartAfter = minutesToTime(timeToMinutes(departureTime) + walkToStart) + ':00';
        
        // Train to a hub, then bus onward
        const trains = await findDirectTrainJourneys(startTiplocs, [endStation.tiploc_code], trainDepartAfter, 3);
        
        for (const train of trains) {
          const arrivalMins = timeToMinutes(train.alightTime) + endStation.walk_minutes;
          const busAfter = minutesToTime(arrivalMins) + ':00';
          
          // Find bus from near the rail station to the destination
          const busLegs = await findDirectBusJourneys(endStation.atco_code, end, busAfter, dayIndex, 2);
          
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

      // Try: bus from start → rail station, then train onward
      for (const startStation of startRailStations.slice(0, 2)) {
        if (endTiplocs.length === 0) continue;

        // Find bus from start to near the rail station
        const nearStart = await findNearbyBusStops(startStation.atco_code, 0.5);
        for (const nearStop of nearStart.slice(0, 3)) {
          const busLegs = await findDirectBusJourneys(start, nearStop.atco_code, departureTime, dayIndex, 2);
          
          for (const bus of busLegs) {
            const arrivalMins = timeToMinutes(bus.alightTime) + 3; // 3 min walk to station
            const trainAfter = minutesToTime(arrivalMins) + ':00';
            
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
          }
        }
      }
    }

    // === Strategy 6: Bus → Bus transfer ===
    let busTransfers = [];
    if (directBus.length === 0) {
      const startCodes = await expandStopCode(start);
      const endCodes = await expandStopCode(end);
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
      allRoutes.push({
        id: `bus-direct-${bus.journeyId}`,
        summary: `Bus ${bus.routeNumber} direct`,
        modes: ['bus'],
        departureTime: bus.boardTime,
        arrivalTime: bus.alightTime,
        durationMinutes: arrMins - depMins,
        legs: [bus]
      });
    }

    // Direct train routes
    for (const train of directTrain) {
      const walkToStation = startRailStations.length > 0 ? startRailStations[0] : null;
      const walkFromStation = endRailStations.length > 0 ? endRailStations[0] : null;
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
      const walkToStation = startRailStations.length > 0 ? startRailStations[0] : null;
      const walkFromStation = endRailStations.length > 0 ? endRailStations[0] : null;
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

    // Filter out unreasonable routes:
    // - Remove routes taking > 4x the reasonable minimum for the distance
    // - Remove routes arriving later than the last sensible option
    const reasonableMinMinutes = Math.max(directDistance * 2, 15); // ~30 km/h avg transit
    const maxReasonableDuration = Math.max(reasonableMinMinutes * 5, 180);
    const filteredRoutes = allRoutes.filter(r => r.durationMinutes <= maxReasonableDuration && r.durationMinutes > 0);

    // Deduplicate routes with same departure and arrival time
    const uniqueRoutes = [];
    const seenKeys = new Set();
    for (const r of filteredRoutes) {
      const key = `${r.departureTime}-${r.arrivalTime}-${r.summary}`;
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

    res.json({
      start: {
        atco: start,
        name: startStop.common_name,
        coordinates: { lon: startStop.lon, lat: startStop.lat }
      },
      end: {
        atco: end,
        name: endStop.common_name,
        coordinates: { lon: endStop.lon, lat: endStop.lat }
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
