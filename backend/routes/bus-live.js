/**
 * Live bus tracking routes — SIRI-VM feed parsing (xml2js-based).
 *
 *   GET /api/bus/live                     — all live buses
 *   GET /api/bus/live/route/:routeNumber  — live buses for a route
 *   GET /api/bus/live/:noc                — live buses for an operator NOC
 *
 * IMPORTANT: /route/:routeNumber must be registered BEFORE /:noc
 * so that "route" is not captured as a NOC code.
 */

const { Router } = require('express');
const https = require('https');
const xml2js = require('xml2js');

const router = Router();

const BUS_OPERATOR_NOCS = ['ROST', 'RLNE', 'SBLK', 'LNUD', 'BLPB'];

const LANCASHIRE_BOUNDS = {
  minLat: 53.5, maxLat: 54.2,
  minLon: -3.1, maxLon: -2.5
};

/**
 * Parse SIRI-VM XML response into an array of vehicle activities.
 * Returns a Promise (uses xml2js).  Exported for unit testing.
 */
function parseSiriVehicles(xmlData) {
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
 * Helper: fetch live vehicles for a single operator via HTTPS.
 */
function fetchOperator(noc) {
  return new Promise((resolve) => {
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
      .on('timeout', function () { this.destroy(); resolve([]); });
  });
}

// GET /api/bus/live/route/:routeNumber  (MUST be before /:noc)
router.get('/api/bus/live/route/:routeNumber', async (req, res) => {
  try {
    const { routeNumber } = req.params;

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
      routeNumber,
      timestamp: new Date().toISOString(),
      count: allVehicles.length,
      vehicles: allVehicles
    });
  } catch (err) {
    console.error('Bus live route endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bus/live/:noc
router.get('/api/bus/live/:noc', async (req, res) => {
  try {
    const { noc } = req.params;
    const lineFilter = req.query.line;
    const url = `https://transport.scc.lancs.ac.uk/bus/live/${noc.toUpperCase()}`;

    https.get(url, { timeout: 10000 }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', async () => {
        try {
          let vehicles = await parseSiriVehicles(data);
          if (lineFilter) {
            vehicles = vehicles.filter(v => v.lineName === lineFilter || v.lineRef === lineFilter);
          }
          res.json({
            operator: noc.toUpperCase(),
            timestamp: new Date().toISOString(),
            count: vehicles.length,
            vehicles
          });
        } catch (parseErr) {
          console.error('Failed to parse bus live data:', parseErr);
          res.status(500).json({ error: 'Failed to parse live bus data' });
        }
      });
    }).on('error', (err) => {
      console.error('Bus live fetch error:', err);
      res.status(500).json({ error: `Failed to fetch live data: ${err.message}` });
    }).on('timeout', function () {
      this.destroy();
      res.status(504).json({ error: 'Transport API timed out' });
    });
  } catch (err) {
    console.error('Bus live endpoint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bus/live — all operators
router.get('/api/bus/live', async (req, res) => {
  try {
    const lineFilter = req.query.line;

    const results = await Promise.all(BUS_OPERATOR_NOCS.map(fetchOperator));
    let allVehicles = results.flat();

    // Deduplicate by vehicleRef
    const seen = new Set();
    allVehicles = allVehicles.filter(v => {
      const key = v.vehicleRef || v.vehicleId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Filter by line/route if requested
    if (lineFilter) {
      allVehicles = allVehicles.filter(v => v.lineName === lineFilter || v.lineRef === lineFilter);
    }

    // Filter to Lancashire bounding box
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

// Export router and also expose helpers for testing
module.exports = router;
module.exports.parseSiriVehicles = parseSiriVehicles;
module.exports.BUS_OPERATOR_NOCS = BUS_OPERATOR_NOCS;
