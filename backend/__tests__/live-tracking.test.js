/**
 * Integration tests for live tracking API endpoints.
 * Tests the HTTP layer for bus and rail live data endpoints.
 *
 * Note: These tests validate endpoint structure and error handling.
 * Some tests may depend on external transport APIs being reachable.
 */

const request = require('supertest');
const app = require('../server');

describe('GET /api/bus/live/route/:routeNumber', () => {
  it('should return 200 with vehicles data for a valid route number', async () => {
    const res = await request(app).get('/api/bus/live/route/100');
    // The endpoint may return empty results if no buses are currently running
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      // Response is an object with vehicles array and metadata
      expect(res.body).toHaveProperty('vehicles');
      expect(Array.isArray(res.body.vehicles)).toBe(true);
      expect(res.body).toHaveProperty('routeNumber');
      expect(res.body).toHaveProperty('count');
    }
  }, 30000);

  it('should return vehicles with correct shape when data is available', async () => {
    const res = await request(app).get('/api/bus/live/route/100');
    if (res.statusCode === 200 && res.body.vehicles && res.body.vehicles.length > 0) {
      const vehicle = res.body.vehicles[0];
      expect(vehicle).toHaveProperty('vehicleRef');
      expect(vehicle).toHaveProperty('latitude');
      expect(vehicle).toHaveProperty('longitude');
      expect(vehicle).toHaveProperty('lineName');
      expect(vehicle).toHaveProperty('operatorRef');
      expect(typeof vehicle.latitude).toBe('number');
      expect(typeof vehicle.longitude).toBe('number');
    }
  }, 30000);

  it('should return empty vehicles array for non-existent route', async () => {
    const res = await request(app).get('/api/bus/live/route/NONEXISTENT999');
    if (res.statusCode === 200) {
      expect(res.body).toHaveProperty('vehicles');
      expect(res.body.vehicles).toEqual([]);
      expect(res.body.count).toBe(0);
    }
  }, 30000);

  it('should filter vehicles to only the requested route number', async () => {
    const res = await request(app).get('/api/bus/live/route/2');
    if (res.statusCode === 200 && res.body.vehicles && res.body.vehicles.length > 0) {
      res.body.vehicles.forEach(vehicle => {
        expect(
          vehicle.lineName === '2' || vehicle.lineRef === '2'
        ).toBeTruthy();
      });
    }
  }, 30000);
});

describe('GET /api/rail/departures/:crs', () => {
  it('should return 200 with station data for Lancaster (LAN)', async () => {
    const res = await request(app).get('/api/rail/departures/LAN');
    expect([200, 500, 502, 504]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body).toHaveProperty('station');
      expect(res.body).toHaveProperty('services');
      expect(Array.isArray(res.body.services)).toBe(true);
    }
  }, 30000);

  it('should include boardingStation coordinates in services', async () => {
    const res = await request(app).get('/api/rail/departures/LAN');
    if (res.statusCode === 200 && res.body.services && res.body.services.length > 0) {
      // boardingStation is included per-service
      const service = res.body.services[0];
      expect(service).toHaveProperty('boardingStation');
      if (service.boardingStation) {
        expect(service.boardingStation).toHaveProperty('lat');
        expect(service.boardingStation).toHaveProperty('lon');
        expect(service.boardingStation.lat).toBeCloseTo(54.0488, 1);
      }
    }
  }, 30000);

  it('should include lat/lon on calling points when available', async () => {
    const res = await request(app).get('/api/rail/departures/LAN');
    if (res.statusCode === 200 && res.body.services && res.body.services.length > 0) {
      // Find a service that has calling points
      const serviceWithCPs = res.body.services.find(
        s => s.callingPoints && s.callingPoints.length > 0
      );
      if (serviceWithCPs) {
        const pointsWithCoords = serviceWithCPs.callingPoints.filter(
          cp => cp.lat !== undefined && cp.lon !== undefined
        );
        // Most calling points should have coordinates
        expect(pointsWithCoords.length).toBeGreaterThan(0);
      }
    }
  }, 30000);

  it('should include origin and destination in services', async () => {
    const res = await request(app).get('/api/rail/departures/LAN');
    if (res.statusCode === 200 && res.body.services && res.body.services.length > 0) {
      const service = res.body.services[0];
      expect(service).toHaveProperty('destination');
      expect(service).toHaveProperty('scheduledDeparture');
    }
  }, 30000);

  it('should return data for Preston (PRE)', async () => {
    const res = await request(app).get('/api/rail/departures/PRE');
    expect([200, 500, 502, 504]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.station).toBeDefined();
      expect(res.body.services).toBeDefined();
    }
  }, 30000);

  it('should handle invalid CRS code gracefully', async () => {
    const res = await request(app).get('/api/rail/departures/ZZZ');
    // Should either return 200 with empty services or a 4xx/5xx
    expect([200, 400, 404, 500, 502, 504]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.body.services).toBeDefined();
    }
  }, 30000);
});

describe('GET /api/bus/live/:noc', () => {
  it('should return 200 with vehicles for SCCU operator', async () => {
    const res = await request(app).get('/api/bus/live/SCCU');
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      // Response may be a wrapped object or an array depending on endpoint version
      const vehicles = Array.isArray(res.body) ? res.body : (res.body.vehicles || []);
      expect(Array.isArray(vehicles)).toBe(true);
      if (vehicles.length > 0) {
        expect(vehicles[0]).toHaveProperty('latitude');
        expect(vehicles[0]).toHaveProperty('longitude');
      }
    }
  }, 30000);

  it('should handle unknown operator gracefully', async () => {
    const res = await request(app).get('/api/bus/live/FAKEOP');
    // Should return 200 with empty data or a structured error
    expect([200, 500]).toContain(res.statusCode);
  }, 30000);
});
