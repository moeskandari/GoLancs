/**
 * Rail endpoint routes.
 *
 *   GET /api/rail/stations          – list all rail stations
 *   GET /api/rail/departures/:crs   – live departures (via transport API)
 *   GET /api/rail/facilities/:crs   – station facilities
 *   GET /api/rail/routes            – find trains between stations
 *   GET /api/rail/delay-codes       – delay reason lookup
 */

const { Router } = require('express');
const pool = require('../db/pool');
const { getStationCoords } = require('../utils/geo');

const router = Router();

// GET /api/rail/stations
router.get('/api/rail/stations', async (req, res) => {
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

// GET /api/rail/departures/:crs
router.get('/api/rail/departures/:crs', async (req, res) => {
  try {
    const { crs } = req.params;
    const https = require('https');
    const xml2js = require('xml2js');

    const url = `https://transport.scc.lancs.ac.uk/rail/departures/${crs.toUpperCase()}`;

    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        xml2js.parseString(data, { explicitArray: false, ignoreAttrs: true }, (err, result) => {
          if (err) return res.type('application/xml').send(data);

          try {
            const board = result.StationBoardWithDetails || result;
            const services = [];

            const trainServices = board?.['lt8:trainServices']?.['lt8:service'];
            if (trainServices) {
              const serviceList = Array.isArray(trainServices) ? trainServices : [trainServices];
              for (const svc of serviceList) {
                const origin = svc?.['lt5:origin']?.['lt4:location'];
                const dest = svc?.['lt5:destination']?.['lt4:location'];

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
                  callingPoints,
                });
              }
            }

            res.json({
              station: board?.['lt4:locationName'],
              crs: board?.['lt4:crs'],
              generatedAt: board?.['lt4:generatedAt'],
              messages: board?.['lt4:nrccMessages']?.['lt:message'] || [],
              services,
            });
          } catch {
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

// GET /api/rail/facilities/:crs
router.get('/api/rail/facilities/:crs', async (req, res) => {
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

// GET /api/rail/routes
router.get('/api/rail/routes', async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end CRS codes or ATCO codes required' });
    }

    // Resolve to TIPLOCs
    let startTiplocs, endTiplocs;

    if (start.length === 3 && start === start.toUpperCase()) {
      const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE crs_code = $1', [start]);
      startTiplocs = r.rows.map(r => r.tiploc_code);
    } else {
      const r = await pool.query('SELECT tiploc_code FROM national_rail WHERE atco_code = $1', [start]);
      startTiplocs = r.rows.map(r => r.tiploc_code);
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

    const startPlaceholders = startTiplocs.map((_, i) => `$${i + 1}`).join(',');
    const endPlaceholders = endTiplocs.map((_, i) => `$${startTiplocs.length + i + 1}`).join(',');
    const params = [...startTiplocs, ...endTiplocs];

    const result = await pool.query(`
      SELECT DISTINCT
        rs.train_uid, rs.operator_code, o.name as operator_name,
        sp1.tiploc_code as start_tiploc, nr1.crs_code as start_crs,
        s1.common_name as start_name, sp1.departure_time,
        sp2.tiploc_code as end_tiploc, nr2.crs_code as end_crs,
        s2.common_name as end_name, sp2.arrival_time,
        sp2.sequence_order - sp1.sequence_order as num_stops, 'rail' as mode
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

    const trains = [];
    for (const row of result.rows) {
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
          tiploc: s.tiploc_code, crs: s.crs_code, name: s.common_name,
          arrival: s.arrival_time, departure: s.departure_time
        }))
      });
    }

    res.json({ start, end, trains, totalTrains: trains.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to find rail routes' });
  }
});

// GET /api/rail/delay-codes
router.get('/api/rail/delay-codes', async (req, res) => {
  try {
    const https = require('https');
    const url = 'https://transport.scc.lancs.ac.uk/rail/delay-codes.json';

    https.get(url, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try { res.json(JSON.parse(data)); }
        catch { res.status(500).json({ error: 'Failed to parse delay codes' }); }
      });
    }).on('error', (err) => {
      res.status(500).json({ error: `Failed to fetch delay codes: ${err.message}` });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch delay codes' });
  }
});

module.exports = router;
