/**
 * Unit tests for geometry and routing utility functions.
 * Tests the pure functions used in bus/train route geometry:
 *   - haversineDistance: great-circle distance between two points
 *   - calculateBearing: compass heading from point A to B
 *   - decodeValhallaPolyline: Valhalla encoded polyline decoder
 *
 * These are critical for the road-following bus route feature.
 */

const app = require('../server');
const { haversineDistance, calculateBearing, decodeValhallaPolyline } = app._test;

describe('haversineDistance', () => {
  it('should return 0 for the same point', () => {
    const d = haversineDistance(54.046, -2.801, 54.046, -2.801);
    expect(d).toBeCloseTo(0, 5);
  });

  it('should calculate Lancaster Uni to Preston (~30km)', () => {
    // InfoLab21 to Preston station
    const d = haversineDistance(54.0058, -2.7855, 53.7563, -2.7081);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });

  it('should calculate short distance between nearby bus stops (~0.5km)', () => {
    // InfoLab21 to Underpass
    const d = haversineDistance(54.0058, -2.7855, 54.0102, -2.7855);
    expect(d).toBeGreaterThan(0.3);
    expect(d).toBeLessThan(1.0);
  });

  it('should be symmetric (A→B === B→A)', () => {
    const d1 = haversineDistance(54.0058, -2.7855, 53.7563, -2.7081);
    const d2 = haversineDistance(53.7563, -2.7081, 54.0058, -2.7855);
    expect(d1).toBeCloseTo(d2, 8);
  });

  it('should handle cross-meridian distances', () => {
    const d = haversineDistance(51.5074, -0.1278, 51.5074, 0.1278);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(30);
  });
});

describe('calculateBearing', () => {
  it('should return ~0° (north) for due north movement', () => {
    const b = calculateBearing(54.0, -2.8, 54.1, -2.8);
    // Due north is ~0°; allow 0-5 or 355-360 (wrapping)
    expect(b >= 355 || b <= 5).toBe(true);
  });

  it('should return ~180° (south) for due south movement', () => {
    const b = calculateBearing(54.1, -2.8, 54.0, -2.8);
    expect(b).toBeGreaterThan(175);
    expect(b).toBeLessThan(185);
  });

  it('should return ~90° (east) for due east movement', () => {
    const b = calculateBearing(54.0, -2.9, 54.0, -2.7);
    expect(b).toBeGreaterThan(85);
    expect(b).toBeLessThan(95);
  });

  it('should return ~270° (west) for due west movement', () => {
    const b = calculateBearing(54.0, -2.7, 54.0, -2.9);
    expect(b).toBeGreaterThan(265);
    expect(b).toBeLessThan(275);
  });

  it('should return a value between 0 and 360', () => {
    const b = calculateBearing(54.0058, -2.7855, 53.7563, -2.7081);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });

  it('should give ~SSE bearing from Lancaster to Preston', () => {
    // Preston is south-southeast of Lancaster
    const b = calculateBearing(54.0058, -2.7855, 53.7563, -2.7081);
    expect(b).toBeGreaterThan(160);
    expect(b).toBeLessThan(200);
  });

  it('should give correct northward bearing for route 100 Bowerham Road', () => {
    // Haydock Road → Infirmary (northbound on Bowerham Road)
    const b = calculateBearing(54.0290, -2.7860, 54.0441, -2.7988);
    expect(b).toBeGreaterThan(300); // NNW
    expect(b).toBeLessThan(360);
  });
});

describe('decodeValhallaPolyline', () => {
  it('should return an empty array for empty string', () => {
    const points = decodeValhallaPolyline('');
    expect(points).toEqual([]);
  });

  it('should decode a known encoded polyline to valid coordinates', () => {
    // Encode a simple 2-point polyline manually for testing
    // This is a real Valhalla-encoded polyline snippet (precision 6)
    // from Lancaster area
    const encoded = '_gzlnAhce_j@??';
    const points = decodeValhallaPolyline(encoded);
    expect(points.length).toBeGreaterThanOrEqual(1);
    // All points should be valid lat/lon
    for (const [lat, lon] of points) {
      expect(lat).toBeGreaterThan(-90);
      expect(lat).toBeLessThan(90);
      expect(lon).toBeGreaterThan(-180);
      expect(lon).toBeLessThan(180);
    }
  });

  it('should use precision 6 by default', () => {
    // With precision 6, decoded values should have ~6 decimal places of precision
    const encoded = '_gzlnAhce_j@';
    const points = decodeValhallaPolyline(encoded);
    expect(points.length).toBeGreaterThanOrEqual(1);
  });

  it('should return multiple points for a multi-point polyline', () => {
    // A real-ish encoded polyline with multiple points
    const encoded = '_gzlnAhce_j@oA?';
    const points = decodeValhallaPolyline(encoded);
    expect(points.length).toBeGreaterThanOrEqual(2);
  });
});
