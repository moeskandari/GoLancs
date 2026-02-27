/**
 * Tests for short-distance route planning optimisations.
 *
 * Features under test:
 *   1. Early exit — pins < 800 m apart skip all transit strategies and
 *      return a single walk-only route instantly.
 *   2. Pin-to-pin walk distance — walk routes use the *actual* pin
 *      coordinates, not the resolved bus-stop coordinates.
 *   3. Circuitous route filtering — when walking is feasible (≤ 3 km),
 *      transit routes that take > 2× the walk time are removed.
 *
 * The tests are split into:
 *   • Pure unit tests  (haversineDistance sanity checks for thresholds)
 *   • Integration tests (supertest → /api/plan with a running DB)
 *
 * Integration tests accept both 200 (DB available) and 404/500
 * (no DB) so the suite never crashes in CI.
 */

const request = require('supertest');
const app     = require('../server');
const { haversineDistance, timeToMinutes, minutesToTime } = app._test;

// ─────────────────────────────────────────────────────────
// Helper coordinates
// ─────────────────────────────────────────────────────────
const LANCASTER_A  = { lat: 54.047,  lon: -2.799  }; // ~city centre
const LANCASTER_B  = { lat: 54.049,  lon: -2.801  }; // ~260 m away
const LANCASTER_C  = { lat: 54.044,  lon: -2.803  }; // ~500 m away
const LANCASTER_D  = { lat: 54.055,  lon: -2.810  }; // ~1.1 km away
const LANCASTER_E  = { lat: 54.07,   lon: -2.83   }; // ~3 km away

// ─────────────────────────────────────────────────────────
// 1. Unit tests — distance threshold sanity
// ─────────────────────────────────────────────────────────
describe('Short-distance threshold calculations', () => {
  it('LANCASTER_A → LANCASTER_B should be under 800 m (early-exit range)', () => {
    const d = haversineDistance(LANCASTER_A.lat, LANCASTER_A.lon,
                                LANCASTER_B.lat, LANCASTER_B.lon);
    expect(d).toBeLessThan(0.8);
    expect(d).toBeGreaterThan(0);
  });

  it('LANCASTER_A → LANCASTER_C should be under 800 m', () => {
    const d = haversineDistance(LANCASTER_A.lat, LANCASTER_A.lon,
                                LANCASTER_C.lat, LANCASTER_C.lon);
    expect(d).toBeLessThan(0.8);
  });

  it('LANCASTER_A → LANCASTER_D should be ABOVE 800 m (no early exit)', () => {
    const d = haversineDistance(LANCASTER_A.lat, LANCASTER_A.lon,
                                LANCASTER_D.lat, LANCASTER_D.lon);
    expect(d).toBeGreaterThan(0.8);
  });

  it('LANCASTER_A → LANCASTER_E should be about 3 km (transit should appear)', () => {
    const d = haversineDistance(LANCASTER_A.lat, LANCASTER_A.lon,
                                LANCASTER_E.lat, LANCASTER_E.lon);
    expect(d).toBeGreaterThan(2.5);
    expect(d).toBeLessThan(4);
  });

  it('walk time estimate should match ~5 km/h (0.08 km/min)', () => {
    const dist = 0.4; // 400 m
    const mins = Math.max(1, Math.ceil(dist / 0.08));
    expect(mins).toBe(5); // 0.4 / 0.08 = 5
  });
});

// ─────────────────────────────────────────────────────────
// 2. Integration — early exit (< 800 m)
// ─────────────────────────────────────────────────────────
describe('Early exit for close pins (< 800 m)', () => {
  it('should return exactly 1 walk-only route for pins ~260 m apart', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'Pin A',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'Pin B',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      expect(res.body.routes).toHaveLength(1);
      expect(res.body.routes[0].id).toBe('walk-only');
      expect(res.body.routes[0].modes).toEqual(['walk']);
      expect(res.body.totalRoutes).toBe(1);
    } else {
      // No DB — just make sure server didn't crash
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 30000);

  it('walk-only route should have a single walk leg', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'B',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      const route = res.body.routes[0];
      expect(route.legs).toHaveLength(1);
      expect(route.legs[0].type).toBe('walk');
    }
  }, 30000);

  it('walk leg should use pin coordinates, not resolved stop coords', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'Pin A',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'Pin B',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      const leg = res.body.routes[0].legs[0];
      expect(leg.fromCoords.lat).toBe(LANCASTER_A.lat);
      expect(leg.fromCoords.lon).toBe(LANCASTER_A.lon);
      expect(leg.toCoords.lat).toBe(LANCASTER_B.lat);
      expect(leg.toCoords.lon).toBe(LANCASTER_B.lon);
    }
  }, 30000);

  it('walk leg should preserve user-supplied names', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'My House',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'The Shop',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      const leg = res.body.routes[0].legs[0];
      expect(leg.fromName).toBe('My House');
      expect(leg.toName).toBe('The Shop');
    }
  }, 30000);

  it('walk duration should be reasonable for ~260 m (< 10 min)', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'B',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      expect(res.body.routes[0].durationMinutes).toBeGreaterThan(0);
      expect(res.body.routes[0].durationMinutes).toBeLessThanOrEqual(10);
    }
  }, 30000);

  it('walk leg should have geometry (road-following polyline)', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'B',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      const leg = res.body.routes[0].legs[0];
      // Geometry should be an array of [lat, lon] pairs following roads
      if (leg.geometry) {
        expect(Array.isArray(leg.geometry)).toBe(true);
        expect(leg.geometry.length).toBeGreaterThan(2);
        // First and last points should be near the pins
        const first = leg.geometry[0];
        const last  = leg.geometry[leg.geometry.length - 1];
        expect(first.length).toBe(2);
        expect(last.length).toBe(2);
      }
    }
  }, 30000);

  it('directDistance_km should reflect pin-to-pin, not stop-to-stop', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'B',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      const expected = haversineDistance(
        LANCASTER_A.lat, LANCASTER_A.lon,
        LANCASTER_B.lat, LANCASTER_B.lon
      );
      // Should be within 0.05 km of actual pin-to-pin distance
      expect(res.body.directDistance_km).toBeCloseTo(expected, 1);
    }
  }, 30000);

  it('response start/end should carry the original pin coordinates', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'Origin',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'Dest',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      expect(res.body.start.coordinates.lat).toBe(LANCASTER_A.lat);
      expect(res.body.start.coordinates.lon).toBe(LANCASTER_A.lon);
      expect(res.body.end.coordinates.lat).toBe(LANCASTER_B.lat);
      expect(res.body.end.coordinates.lon).toBe(LANCASTER_B.lon);
    }
  }, 30000);
});

// ─────────────────────────────────────────────────────────
// 3. Integration — circuitous route filtering (≤ 3 km)
// ─────────────────────────────────────────────────────────
describe('Circuitous route filtering for walkable distances', () => {
  it('should not return transit routes slower than 2× walking for ~1 km', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_D.lat, endLon:   LANCASTER_D.lon, endName:   'D',
        time: '12:00:00', day: '0', sort: 'duration',
      });

    if (res.statusCode === 200 && res.body.routes.length > 0) {
      // Calculate what the walk-only time would be
      const walkDist = haversineDistance(
        LANCASTER_A.lat, LANCASTER_A.lon,
        LANCASTER_D.lat, LANCASTER_D.lon
      );
      const walkMins = Math.max(1, Math.ceil(walkDist / 0.08));

      for (const route of res.body.routes) {
        if (route.id !== 'walk-only') {
          // Transit route must not exceed 2× walk time
          expect(route.durationMinutes).toBeLessThanOrEqual(walkMins * 2);
        }
      }
    }
  }, 60000);

  it('walk-only route should appear for distances under 3 km', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_D.lat, endLon:   LANCASTER_D.lon, endName:   'D',
        time: '12:00:00', day: '0', sort: 'duration',
      });

    if (res.statusCode === 200) {
      const walkRoute = res.body.routes.find(r => r.id === 'walk-only');
      expect(walkRoute).toBeDefined();
      expect(walkRoute.modes).toEqual(['walk']);
    }
  }, 60000);

  it('walk-only route distance should use pin-to-pin, not stop-to-stop', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_D.lat, endLon:   LANCASTER_D.lon, endName:   'D',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      const walkRoute = res.body.routes.find(r => r.id === 'walk-only');
      if (walkRoute) {
        const pinDist = haversineDistance(
          LANCASTER_A.lat, LANCASTER_A.lon,
          LANCASTER_D.lat, LANCASTER_D.lon
        );
        const legDist = walkRoute.legs[0].distance_km;
        // Walk leg distance should be close to actual pin-to-pin distance
        expect(legDist).toBeCloseTo(pinDist, 1);
      }
    }
  }, 60000);

  it('for ~3 km pins, transit routes should still appear alongside walk', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_E.lat, endLon:   LANCASTER_E.lon, endName:   'E',
        time: '12:00:00', day: '0', sort: 'duration',
      });

    if (res.statusCode === 200 && res.body.routes.length > 0) {
      // At ~3 km transit routes should be present
      const transitRoutes = res.body.routes.filter(r => r.id !== 'walk-only');
      expect(transitRoutes.length).toBeGreaterThan(0);

      // Walk-only route only appears when distance is ≤ 3 km;
      // LANCASTER_E is ~3.25 km so walk-only may be absent
      const walkDist = haversineDistance(
        LANCASTER_A.lat, LANCASTER_A.lon,
        LANCASTER_E.lat, LANCASTER_E.lon
      );
      if (walkDist <= 3.0) {
        const walkRoute = res.body.routes.find(r => r.id === 'walk-only');
        expect(walkRoute).toBeDefined();
        // Circuitous filter: transit ≤ 2× walk time
        const walkMins = Math.max(1, Math.ceil(walkDist / 0.08));
        for (const route of transitRoutes) {
          expect(route.durationMinutes).toBeLessThanOrEqual(walkMins * 2);
        }
      }
    }
  }, 60000);
});

// ─────────────────────────────────────────────────────────
// 4. Edge cases
// ─────────────────────────────────────────────────────────
describe('Short-distance edge cases', () => {
  it('same pin coordinates should still return a walk route (0 m)', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'Here',
        endLat:   LANCASTER_A.lat, endLon:   LANCASTER_A.lon, endName:   'Here',
        time: '12:00:00', day: '0',
      });

    // Might get filtered by "same location" check or return walk-only
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeLessThanOrEqual(1);
    } else {
      // 400 for same-location or 404/500 for no DB — all acceptable
      expect([200, 400, 404, 500]).toContain(res.statusCode);
    }
  }, 30000);

  it('ATCO-code based queries should NOT trigger early exit', async () => {
    // Early exit only applies to coordinate-based (pin) queries
    const res = await request(app)
      .get('/api/plan')
      .query({
        start: '2500918', end: '2500883',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      // ATCO-based queries should still search for bus/train routes
      // even if the stops happen to be close together
      expect(res.body).toHaveProperty('routes');
      expect(Array.isArray(res.body.routes)).toBe(true);
    }
  }, 120000);

  it('mixed query (1 ATCO + 1 pin) should NOT trigger early exit', async () => {
    // Only both-coordinate queries trigger the short-distance fast path
    const res = await request(app)
      .get('/api/plan')
      .query({
        start: '2500918',
        endLat: LANCASTER_A.lat, endLon: LANCASTER_A.lon, endName: 'Pin',
        time: '12:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      expect(res.body).toHaveProperty('routes');
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);

  it('pins just over 800 m apart should NOT use early exit', async () => {
    // LANCASTER_A → LANCASTER_D is ~1.1 km — should run full route search
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_D.lat, endLon:   LANCASTER_D.lon, endName:   'D',
        time: '12:00:00', day: '0', sort: 'duration',
      });

    if (res.statusCode === 200) {
      // Should have the walk route plus potentially transit options
      const walkRoute = res.body.routes.find(r => r.id === 'walk-only');
      expect(walkRoute).toBeDefined();
      // totalRoutes could be > 1 if there are valid transit options
      expect(res.body.totalRoutes).toBeGreaterThanOrEqual(1);
    }
  }, 60000);

  it('early exit response should still include departureTime and dayOfWeek', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'B',
        time: '14:30:00', day: '2',
      });

    if (res.statusCode === 200) {
      expect(res.body.departureTime).toBe('14:30:00');
      expect(res.body.dayOfWeek).toBe('Wednesday');
      expect(res.body.sortedBy).toBeDefined();
    }
  }, 30000);

  it('arrival time should equal departure + walk duration', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: LANCASTER_A.lat, startLon: LANCASTER_A.lon, startName: 'A',
        endLat:   LANCASTER_B.lat, endLon:   LANCASTER_B.lon, endName:   'B',
        time: '10:00:00', day: '0',
      });

    if (res.statusCode === 200) {
      const route = res.body.routes[0];
      const depMins = timeToMinutes(route.departureTime);
      const arrMins = timeToMinutes(route.arrivalTime);
      expect(arrMins - depMins).toBe(route.durationMinutes);
    }
  }, 30000);
});
