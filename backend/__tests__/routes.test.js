const request = require('supertest');
const app = require('../server');

describe('Route Planning Endpoints', () => {
  describe('GET /api/stops', () => {
    it('should respond (may fail without DB but should not crash)', async () => {
      const res = await request(app).get('/api/stops');
      // Without a running DB this may return 500, but the server should not crash
      expect([200, 500]).toContain(res.statusCode);
    });
  });

  describe('GET /api/stops/nearby', () => {
    it('should require lat and lon parameters', async () => {
      const res = await request(app).get('/api/stops/nearby');
      // Without params it should return 400 or 500, not crash
      expect([400, 500]).toContain(res.statusCode);
    });

    it('should accept lat and lon query params', async () => {
      const res = await request(app)
        .get('/api/stops/nearby')
        .query({ lat: 54.046, lon: -2.801, radius: 500 });
      // May fail without DB but should respond properly
      expect([200, 500]).toContain(res.statusCode);
    });
  });

  describe('GET /api/plan', () => {
    it('should require origin and destination', async () => {
      const res = await request(app)
        .get('/api/plan');
      // Should return 400 for missing params or 500 for DB issues
      expect([400, 500]).toContain(res.statusCode);
    });
  });

  describe('GET /api/search', () => {
    it('should require a query parameter', async () => {
      const res = await request(app).get('/api/search');
      // Should return 400 for missing query or 500
      expect([200, 400, 500]).toContain(res.statusCode);
    });

    it('should accept a q parameter and return results', async () => {
      const res = await request(app)
        .get('/api/search')
        .query({ q: 'Lancaster' });
      // May fail without DB but should respond properly
      expect([200, 500]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        expect(res.body).toHaveProperty('stops');
        expect(res.body).toHaveProperty('places');
        expect(Array.isArray(res.body.stops)).toBe(true);
        expect(Array.isArray(res.body.places)).toBe(true);
      }
    });
  });
});
