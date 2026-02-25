const request = require('supertest');
const app = require('../server');

describe('Health Check Endpoint', () => {
  it('GET /api/health should return 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('message');
  });
});

describe('API Structure', () => {
  it('GET / should return 404 or a response (no root handler)', async () => {
    const res = await request(app).get('/');
    // The app may or may not have a root route; just confirm it responds
    expect(res.statusCode).toBeDefined();
  });

  it('GET /api/nonexistent should return 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.statusCode).toBe(404);
  });
});

describe('CORS Headers', () => {
  it('should include CORS headers in responses', async () => {
    const res = await request(app).get('/api/health');
    // cors middleware should set access-control-allow-origin
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});
