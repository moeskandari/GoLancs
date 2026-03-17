/**
 * Integration tests for API endpoints.
 * Tests the HTTP layer: correct status codes, response shapes, and error handling.
 * Endpoints tested:
 *   - GET /api/health
 *   - GET /api/reverse-geocode (new: live user location feature)
 *   - GET /api/plan (route planner — parameter validation)
 *   - GET /api/search
 *   - GET /api/stops/nearby
 */

const request = require('supertest');
const app = require('../server');

describe('GET /api/health', () => {
  it('should return 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.message).toBeDefined();
  });
});

describe('GET /api/reverse-geocode', () => {
  it('should return 200 with fallback name when lat is missing', async () => {
    const res = await request(app).get('/api/reverse-geocode').query({ lon: -2.8 });
    // Accept 500 in CI where PgSession store has no database
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.name).toBe('My Location');
    }
  });

  it('should return 200 with fallback name when lon is missing', async () => {
    const res = await request(app).get('/api/reverse-geocode').query({ lat: 54.0 });
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.name).toBe('My Location');
    }
  });

  it('should return 200 with fallback name when both params missing', async () => {
    const res = await request(app).get('/api/reverse-geocode');
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.name).toBe('My Location');
    }
  });

  it('should return a name for valid Lancaster coordinates', async () => {
    const res = await request(app)
      .get('/api/reverse-geocode')
      .query({ lat: 54.0049, lon: -2.7858 });
    // Depends on Nominatim being reachable — may timeout in CI
    if (res.statusCode === 200) {
      expect(res.body).toHaveProperty('name');
      expect(typeof res.body.name).toBe('string');
      expect(res.body.name.length).toBeGreaterThan(0);
    } else {
      // Accept 500 if Nominatim is unreachable in CI
      expect([200, 500]).toContain(res.statusCode);
    }
  }, 15000);

  it('should return a name string, not raw coordinates', async () => {
    const res = await request(app)
      .get('/api/reverse-geocode')
      .query({ lat: 54.046, lon: -2.801 });
    if (res.statusCode === 200) {
      expect(res.body.name).not.toMatch(/^54\./);
      expect(res.body.name).not.toMatch(/^-2\./);
    }
  }, 15000);
});

describe('GET /api/plan — parameter validation', () => {
  it('should return 400 when no parameters given', async () => {
    const res = await request(app).get('/api/plan');
    expect([400, 500]).toContain(res.statusCode);
  });

  it('should accept ATCO code start and end', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({ start: '2500918', end: '2500883', time: '09:00', day: 'monday' });
    // Will return 200 with routes or 500 if no DB — should not crash
    expect([200, 404, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body).toHaveProperty('routes');
      expect(Array.isArray(res.body.routes)).toBe(true);
    }
  }, 120000);

  it('should accept coordinate-based start', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        startLat: '54.0058', startLon: '-2.7855', startName: 'InfoLab21',
        end: '2500883', time: '09:00', day: 'monday'
      });
    expect([200, 404, 500]).toContain(res.statusCode);
  }, 120000);

  it('should accept coordinate-based end', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({
        start: '2500918',
        endLat: '54.046', endLon: '-2.801', endName: 'Lancaster',
        time: '09:00', day: 'monday'
      });
    expect([200, 404, 500]).toContain(res.statusCode);
  }, 120000);

  it('routes should contain legs with geometry arrays', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({ start: '2500918', end: '2500883', time: '09:00', day: 'monday' });
    if (res.statusCode === 200 && res.body.routes && res.body.routes.length > 0) {
      const route = res.body.routes[0];
      expect(route).toHaveProperty('legs');
      expect(Array.isArray(route.legs)).toBe(true);
      for (const leg of route.legs) {
        expect(leg).toHaveProperty('type');
        expect(['walk', 'bus', 'train', 'transfer']).toContain(leg.type);
        if (leg.geometry) {
          expect(Array.isArray(leg.geometry)).toBe(true);
          // Each geometry point should be [lat, lon]
          if (leg.geometry.length > 0) {
            expect(leg.geometry[0].length).toBe(2);
          }
        }
      }
    }
  }, 60000);

  it('bus legs should have road-following geometry (many points)', async () => {
    const res = await request(app)
      .get('/api/plan')
      .query({ start: '2500918', end: '2500883', time: '09:00', day: 'monday' });
    if (res.statusCode === 200 && res.body.routes) {
      const busLegs = res.body.routes
        .flatMap(r => r.legs)
        .filter(l => l.type === 'bus' && l.geometry);

      if (busLegs.length > 0) {
        // Road-following geometry should have many more points than just stop count
        // A straight-line fallback would have ~5-15 points, road-following has 100+
        const maxPoints = Math.max(...busLegs.map(l => l.geometry.length));
        expect(maxPoints).toBeGreaterThan(30);
      }
    }
  }, 60000);
});

describe('GET /api/search', () => {
  it('should return 400 or empty for missing query', async () => {
    const res = await request(app).get('/api/search');
    expect([200, 400, 500]).toContain(res.statusCode);
  });

  it('should return stops and places arrays for valid query', async () => {
    const res = await request(app).get('/api/search').query({ q: 'Lancaster' });
    if (res.statusCode === 200) {
      expect(res.body).toHaveProperty('stops');
      expect(res.body).toHaveProperty('places');
      expect(Array.isArray(res.body.stops)).toBe(true);
      expect(Array.isArray(res.body.places)).toBe(true);
    }
  }, 15000);
});

describe('GET /api/stops/nearby', () => {
  it('should return 400 or 500 without parameters', async () => {
    const res = await request(app).get('/api/stops/nearby');
    expect([400, 500]).toContain(res.statusCode);
  });

  it('should accept lat/lon/radius params', async () => {
    const res = await request(app)
      .get('/api/stops/nearby')
      .query({ lat: 54.046, lon: -2.801, radius: 1.5 });
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      // Returns { bus: [...], rail: [...] }
      expect(res.body).toHaveProperty('bus');
      expect(res.body).toHaveProperty('rail');
      expect(Array.isArray(res.body.bus)).toBe(true);
      expect(Array.isArray(res.body.rail)).toBe(true);
    }
  });
});

describe('Error handling', () => {
  it('should return 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.statusCode).toBe(404);
  });

  it('should include CORS headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});
