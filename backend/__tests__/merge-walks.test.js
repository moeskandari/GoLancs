/**
 * Unit tests for mergeConsecutiveWalkLegs.
 * This function merges back-to-back walk legs into a single walk leg
 * (e.g. when a route has walk→bus→walk and the bus segment is removed).
 */

const app = require('../server');
const { mergeConsecutiveWalkLegs, haversineDistance } = app._test;

describe('mergeConsecutiveWalkLegs', () => {
  it('should not change routes with no consecutive walks', () => {
    const routes = [{
      legs: [
        { type: 'walk', fromName: 'A', toName: 'B', duration: 5, distance_km: 0.4 },
        { type: 'bus', fromName: 'B', toName: 'C', duration: 15, distance_km: 5 },
        { type: 'walk', fromName: 'C', toName: 'D', duration: 3, distance_km: 0.2 },
      ],
      durationMinutes: 23,
    }];
    mergeConsecutiveWalkLegs(routes);
    expect(routes[0].legs.length).toBe(3);
  });

  it('should merge two consecutive walk legs into one', () => {
    const routes = [{
      legs: [
        {
          type: 'walk', fromName: 'A', toName: 'B', duration: 5, distance_km: 0.4,
          fromCoords: { lat: 54.0, lon: -2.8 }, toCoords: { lat: 54.01, lon: -2.8 }
        },
        {
          type: 'walk', fromName: 'B', toName: 'C', duration: 3, distance_km: 0.2,
          fromCoords: { lat: 54.01, lon: -2.8 }, toCoords: { lat: 54.02, lon: -2.8 }
        },
      ],
      durationMinutes: 8,
    }];
    mergeConsecutiveWalkLegs(routes);
    expect(routes[0].legs.length).toBe(1);
    expect(routes[0].legs[0].fromName).toBe('A');
    expect(routes[0].legs[0].toName).toBe('C');
    expect(routes[0].legs[0].type).toBe('walk');
  });

  it('should merge three consecutive walk legs', () => {
    const routes = [{
      legs: [
        {
          type: 'walk', fromName: 'A', toName: 'B', duration: 5, distance_km: 0.4,
          fromCoords: { lat: 54.0, lon: -2.8 }, toCoords: { lat: 54.01, lon: -2.8 }
        },
        {
          type: 'walk', fromName: 'B', toName: 'C', duration: 3, distance_km: 0.2,
          fromCoords: { lat: 54.01, lon: -2.8 }, toCoords: { lat: 54.02, lon: -2.8 }
        },
        {
          type: 'walk', fromName: 'C', toName: 'D', duration: 4, distance_km: 0.3,
          fromCoords: { lat: 54.02, lon: -2.8 }, toCoords: { lat: 54.03, lon: -2.8 }
        },
      ],
      durationMinutes: 12,
    }];
    mergeConsecutiveWalkLegs(routes);
    expect(routes[0].legs.length).toBe(1);
    expect(routes[0].legs[0].fromName).toBe('A');
    expect(routes[0].legs[0].toName).toBe('D');
  });

  it('should handle routes with no walk legs', () => {
    const routes = [{
      legs: [
        { type: 'bus', fromName: 'A', toName: 'B', duration: 15, distance_km: 5 },
        { type: 'train', fromName: 'B', toName: 'C', duration: 20, distance_km: 15 },
      ],
      durationMinutes: 35,
    }];
    mergeConsecutiveWalkLegs(routes);
    expect(routes[0].legs.length).toBe(2);
  });

  it('should handle empty routes array', () => {
    const routes = [];
    expect(() => mergeConsecutiveWalkLegs(routes)).not.toThrow();
  });

  it('should handle route with empty legs', () => {
    const routes = [{ legs: [], durationMinutes: 0 }];
    expect(() => mergeConsecutiveWalkLegs(routes)).not.toThrow();
  });

  it('should recalculate distance using haversine when coords available', () => {
    const from = { lat: 54.0, lon: -2.8 };
    const to = { lat: 54.02, lon: -2.8 };
    const expectedDist = haversineDistance(from.lat, from.lon, to.lat, to.lon);

    const routes = [{
      legs: [
        { type: 'walk', fromName: 'A', toName: 'B', duration: 5, distance_km: 0.4,
          fromCoords: from, toCoords: { lat: 54.01, lon: -2.8 } },
        { type: 'walk', fromName: 'B', toName: 'C', duration: 3, distance_km: 0.2,
          fromCoords: { lat: 54.01, lon: -2.8 }, toCoords: to },
      ],
      durationMinutes: 8,
    }];
    mergeConsecutiveWalkLegs(routes);
    expect(routes[0].legs[0].distance_km).toBeCloseTo(expectedDist, 2);
  });
});
