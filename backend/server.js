/**
 * Lancaster Travel Routes — Express application entry point.
 *
 * This is the slim entry point that composes all route modules.
 * Business logic lives in /services, data helpers in /utils, and
 * HTTP handlers in /routes.
 */

const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ───────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Route modules ───────────────────────────────────────────────────
app.use(require('./routes/health'));
app.use(require('./routes/stops'));
app.use(require('./routes/geocode'));
app.use(require('./routes/rail'));
app.use(require('./routes/bus-timetable'));
app.use(require('./routes/planner'));
app.use(require('./routes/weather'));
app.use(require('./routes/bus-live'));
app.use(require('./routes/road-vms'));

// ── Error handling middleware ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ── Start server (only when run directly, not when imported by tests) ──
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;

// ── Re-export pure functions for unit tests ─────────────────────────
// Tests access these via  app._test.functionName
const { haversineDistance, calculateBearing, getStationCoords, STATION_COORDS } = require('./utils/geo');
const { timeToMinutes, minutesToTime, getDayIndex }    = require('./utils/time');
const { decodeValhallaPolyline, mergeConsecutiveWalkLegs } = require('./services/geometry');
const { parseSiriVehicles } = require('./routes/bus-live');

module.exports._test = {
  haversineDistance,
  calculateBearing,
  decodeValhallaPolyline,
  timeToMinutes,
  minutesToTime,
  getDayIndex,
  mergeConsecutiveWalkLegs,
  getStationCoords,
  parseSiriVehicles,
  STATION_COORDS,
};
