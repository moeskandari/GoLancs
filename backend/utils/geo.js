/**
 * Geographic utility functions and station coordinate data.
 *
 * Exports:
 *   haversineDistance(lat1, lon1, lat2, lon2)  – great-circle distance (km)
 *   calculateBearing(lat1, lon1, lat2, lon2)   – compass heading 0-360°
 *   STATION_COORDS                             – CRS → { lat, lon, name }
 *   getStationCoords(crs)                      – lookup helper
 */

/**
 * Known station coordinates for the Lancaster – Preston – Fylde & Wyre coast area.
 * Keyed by CRS code, values are { lat, lon, name }.
 * Coordinates sourced from NaPTAN / ORR data (WGS84).
 */
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

/**
 * Look up coordinates for a station by CRS code.
 * Returns { lat, lon } or null if unknown.
 */
function getStationCoords(crs) {
  if (!crs) return null;
  const entry = STATION_COORDS[crs.toUpperCase()];
  return entry ? { lat: entry.lat, lon: entry.lon } : null;
}

/**
 * Calculate the great-circle (Haversine) distance between two points in km.
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

module.exports = {
  STATION_COORDS,
  getStationCoords,
  haversineDistance,
  calculateBearing,
};
