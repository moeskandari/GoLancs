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
 * Known station coordinates for the Lancashire / NW England area.
 * Keyed by CRS code, values are { lat, lon, name }.
 * Coordinates sourced from NaPTAN / ORR data (WGS84).
 */
const STATION_COORDS = {
  // Lancashire & Cumbria core
  LAN: { lat: 54.0488, lon: -2.8079, name: 'Lancaster' },
  PRE: { lat: 53.7553, lon: -2.7072, name: 'Preston' },
  MCM: { lat: 54.0703, lon: -2.8685, name: 'Morecambe' },
  BAR: { lat: 54.0747, lon: -2.8350, name: 'Bare Lane' },
  CNF: { lat: 54.1310, lon: -2.7700, name: 'Carnforth' },
  HHB: { lat: 54.0328, lon: -2.9155, name: 'Heysham Harbour' },
  OXN: { lat: 54.3195, lon: -2.7251, name: 'Oxenholme Lake District' },
  WDM: { lat: 54.3791, lon: -2.9040, name: 'Windermere' },
  BEN: { lat: 54.1160, lon: -2.5083, name: 'Bentham' },
  WNN: { lat: 54.1139, lon: -2.5870, name: 'Wennington' },
  CPY: { lat: 54.1057, lon: -2.4143, name: 'Clapham (North Yorkshire)' },
  SVR: { lat: 54.1702, lon: -2.8076, name: 'Silverdale' },
  ARN: { lat: 54.2037, lon: -2.8298, name: 'Arnside' },
  GOS: { lat: 54.1946, lon: -2.9021, name: 'Grange-over-Sands' },
  KBK: { lat: 54.1764, lon: -2.9191, name: 'Kents Bank' },
  CAK: { lat: 54.1766, lon: -2.9636, name: 'Cark' },
  ULV: { lat: 54.1938, lon: -3.0942, name: 'Ulverston' },
  DLT: { lat: 54.1544, lon: -3.1808, name: 'Dalton' },
  ROO: { lat: 54.1264, lon: -3.1949, name: 'Roose' },
  BIF: { lat: 54.1177, lon: -3.2263, name: 'Barrow-in-Furness' },
  // Blackpool & Fylde
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
  // South Lancashire
  LEY: { lat: 53.6986, lon: -2.6866, name: 'Leyland' },
  EBA: { lat: 53.6598, lon: -2.6717, name: 'Euxton Balshaw Lane' },
  BMB: { lat: 53.7245, lon: -2.6594, name: 'Bamber Bridge' },
  LOH: { lat: 53.7335, lon: -2.6892, name: 'Lostock Hall' },
  CSO: { lat: 53.6747, lon: -2.7756, name: 'Croston' },
  RUF: { lat: 53.6338, lon: -2.8182, name: 'Rufford' },
  MLH: { lat: 53.7272, lon: -2.5964, name: 'Mill Hill (Lancashire)' },
  PLS: { lat: 53.7345, lon: -2.5575, name: 'Pleasington' },
  // East Lancashire
  BBN: { lat: 53.7485, lon: -2.4806, name: 'Blackburn' },
  CYT: { lat: 53.7328, lon: -2.5177, name: 'Cherry Tree' },
  RIS: { lat: 53.7630, lon: -2.4200, name: 'Rishton' },
  CTW: { lat: 53.7664, lon: -2.3939, name: 'Church & Oswaldtwistle' },
  ACR: { lat: 53.7534, lon: -2.3693, name: 'Accrington' },
  HPN: { lat: 53.7841, lon: -2.3192, name: 'Hapton' },
  RSG: { lat: 53.7926, lon: -2.2955, name: 'Rose Grove' },
  BUB: { lat: 53.7944, lon: -2.2680, name: 'Burnley Barracks' },
  BNC: { lat: 53.7878, lon: -2.2490, name: 'Burnley Central' },
  BYM: { lat: 53.7908, lon: -2.2415, name: 'Burnley Manchester Road' },
  HCT: { lat: 53.7726, lon: -2.3519, name: 'Huncoat' },
  BRF: { lat: 53.8286, lon: -2.2341, name: 'Brierfield' },
  NEL: { lat: 53.8347, lon: -2.2110, name: 'Nelson' },
  CNE: { lat: 53.8551, lon: -2.1757, name: 'Colne' },
  // Greater Manchester / Merseyside / West Yorkshire
  MAN: { lat: 53.4774, lon: -2.2309, name: 'Manchester Piccadilly' },
  MCO: { lat: 53.4745, lon: -2.2426, name: 'Manchester Oxford Road' },
  MIA: { lat: 53.3654, lon: -2.2727, name: 'Manchester Airport' },
  DGT: { lat: 53.4740, lon: -2.2503, name: 'Deansgate' },
  WGN: { lat: 53.5448, lon: -2.6325, name: 'Wigan North Western' },
  BYN: { lat: 53.5091, lon: -2.6489, name: 'Bryn' },
  GSW: { lat: 53.4986, lon: -2.6636, name: 'Garswood' },
  SNH: { lat: 53.4553, lon: -2.7287, name: 'St Helens Central' },
  PSC: { lat: 53.4299, lon: -2.8015, name: 'Prescot' },
  HUY: { lat: 53.4133, lon: -2.8393, name: 'Huyton' },
  ROB: { lat: 53.4048, lon: -2.8517, name: 'Roby' },
  BGE: { lat: 53.3998, lon: -2.8783, name: 'Broad Green' },
  WAV: { lat: 53.3949, lon: -2.9001, name: 'Wavertree Technology Park' },
  EDG: { lat: 53.3947, lon: -2.9173, name: 'Edge Hill' },
  LIV: { lat: 53.4050, lon: -2.9779, name: 'Liverpool Lime Street' },
  ECL: { lat: 53.4469, lon: -2.7711, name: 'Eccleston Park' },
  THH: { lat: 53.4421, lon: -2.7496, name: 'Thatto Heath' },
  LDS: { lat: 53.7952, lon: -1.5479, name: 'Leeds' },
  HFX: { lat: 53.7210, lon: -1.8535, name: 'Halifax' },
  HBD: { lat: 53.7420, lon: -2.0105, name: 'Hebden Bridge' },
  BDI: { lat: 53.7910, lon: -1.7498, name: 'Bradford Interchange' },
  // Ormskirk / Southport
  OMS: { lat: 53.5696, lon: -2.8809, name: 'Ormskirk' },
  BCJ: { lat: 53.5916, lon: -2.8417, name: 'Burscough Junction' },
  PBL: { lat: 53.5909, lon: -2.7711, name: 'Parbold' },
  SOP: { lat: 53.6469, lon: -3.0028, name: 'Southport' },
  // West Cumbria (extended for Barrow line services)
  CKL: { lat: 54.5420, lon: -3.5660, name: 'Corkickle' },
  // Bolton / Chorley line
  CRL: { lat: 53.6531, lon: -2.6318, name: 'Chorley' },
  ADL: { lat: 53.6133, lon: -2.6073, name: 'Adlington (Lancashire)' },
  BSV: { lat: 53.6803, lon: -2.6622, name: 'Buckshaw Parkway' },
  BLK: { lat: 53.5872, lon: -2.5767, name: 'Blackrod' },
  HWI: { lat: 53.5634, lon: -2.5419, name: 'Horwich Parkway' },
  LOT: { lat: 53.5605, lon: -2.5049, name: 'Lostock' },
  BON: { lat: 53.5782, lon: -2.4297, name: 'Bolton' },
  SLD: { lat: 53.4866, lon: -2.2747, name: 'Salford Crescent' },
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
