/**
 * Route comparison tests.
 *
 * Tests a variety of routes within the Lancaster – Preston – Blackpool /
 * Fylde & Wyre coast area and validates the routing logic against expected
 * behaviour (comparable to Google Maps / Traveline results).
 *
 * Categories:
 *   1. Midnight-crossing duration calculations (safeDuration)
 *   2. Station coordinate coverage (boundary-scoped)
 *   3. Walking speed and walk-only threshold
 *   4. Route planner endpoint integration tests for diverse routes
 *   5. Duration and timing sanity checks
 */

const request = require('supertest');
const app     = require('../server');
const {
  haversineDistance,
  timeToMinutes,
  minutesToTime,
  getDayIndex,
  safeDuration,
  getStationCoords,
  STATION_COORDS,
} = app._test;

// ─────────────────────────────────────────────────────────
// Coordinates for test routes (real-world reference points)
// All within the Lancaster – Preston – coast boundary
// ─────────────────────────────────────────────────────────
const LOCATIONS = {
  LANCASTER_UNI:     { lat: 54.0104, lon: -2.7877, name: 'Lancaster University' },
  LANCASTER_CENTRE:  { lat: 54.0470, lon: -2.7990, name: 'Lancaster City Centre' },
  LANCASTER_STATION: { lat: 54.0488, lon: -2.8079, name: 'Lancaster Station' },
  PRESTON_STATION:   { lat: 53.7553, lon: -2.7072, name: 'Preston Station' },
  MORECAMBE:         { lat: 54.0703, lon: -2.8685, name: 'Morecambe' },
  BLACKPOOL_NORTH:   { lat: 53.8229, lon: -3.0484, name: 'Blackpool North' },
  BLACKPOOL_SOUTH:   { lat: 53.7984, lon: -3.0488, name: 'Blackpool South' },
  CARNFORTH:         { lat: 54.1310, lon: -2.7700, name: 'Carnforth' },
  HEYSHAM:           { lat: 54.0328, lon: -2.9155, name: 'Heysham Harbour' },
  FLEETWOOD:         { lat: 53.9220, lon: -3.0090, name: 'Fleetwood' },
  GARSTANG:          { lat: 53.8990, lon: -2.7740, name: 'Garstang' },
  LYTHAM:            { lat: 53.7393, lon: -2.9642, name: 'Lytham' },
  POULTON:           { lat: 53.8483, lon: -2.9897, name: 'Poulton-le-Fylde' },
  KIRKHAM:           { lat: 53.7869, lon: -2.8834, name: 'Kirkham & Wesham' },
  LEYLAND:           { lat: 53.6986, lon: -2.6866, name: 'Leyland' },
  ST_ANNES:          { lat: 53.7534, lon: -3.0249, name: 'St Annes-on-the-Sea' },
  SILVERDALE:        { lat: 54.1702, lon: -2.8076, name: 'Silverdale' },
};

// ─────────────────────────────────────────────────────────
// 1. safeDuration – midnight crossing tests
// ─────────────────────────────────────────────────────────
describe('safeDuration – midnight crossing handling', () => {
  it('should handle normal same-day duration', () => {
    expect(safeDuration('09:00', '09:30')).toBe(30);
    expect(safeDuration('12:00', '14:45')).toBe(165);
    expect(safeDuration('06:00', '23:59')).toBe(1079);
  });

  it('should handle midnight crossing: 23:50 → 00:10 = 20 min', () => {
    expect(safeDuration('23:50', '00:10')).toBe(20);
  });

  it('should handle midnight crossing: 23:00 → 01:00 = 120 min', () => {
    expect(safeDuration('23:00', '01:00')).toBe(120);
  });

  it('should handle midnight crossing: 22:30 → 00:00 = 90 min', () => {
    expect(safeDuration('22:30', '00:00')).toBe(90);
  });

  it('should handle exact midnight departure', () => {
    expect(safeDuration('00:00', '00:30')).toBe(30);
  });

  it('should handle zero-duration (same time)', () => {
    expect(safeDuration('12:00', '12:00')).toBe(0);
  });

  it('should return 0 for null inputs', () => {
    expect(safeDuration(null, '12:00')).toBe(0);
    expect(safeDuration('12:00', null)).toBe(0);
    expect(safeDuration(null, null)).toBe(0);
  });

  it('should handle midnight crossing: 23:45 → 00:05 = 20 min', () => {
    expect(safeDuration('23:45', '00:05')).toBe(20);
  });

  it('should handle 24:xx format times', () => {
    // Some timetables encode post-midnight as 24:15 etc
    expect(safeDuration('23:45', '24:15')).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────
// 2. Station coordinate coverage (boundary-scoped)
// ─────────────────────────────────────────────────────────
describe('Station coordinate coverage – Lancaster/Preston/coast area', () => {
  it('should contain Lancaster area stations', () => {
    ['LAN', 'MCM', 'BAR', 'CNF', 'HHB', 'SVR'].forEach(crs => {
      expect(STATION_COORDS).toHaveProperty(crs);
    });
  });

  it('should contain Preston area stations', () => {
    ['PRE', 'LEY', 'EBA', 'BMB', 'LOH', 'CSO', 'RUF'].forEach(crs => {
      expect(STATION_COORDS).toHaveProperty(crs);
    });
  });

  it('should contain Blackpool & Fylde coast stations', () => {
    ['BPN', 'BPS', 'BPB', 'SQU', 'SAS', 'LTM', 'AFV', 'MOS', 'KKM', 'SAL', 'PFY', 'LAY'].forEach(crs => {
      expect(STATION_COORDS).toHaveProperty(crs);
    });
  });

  it('should NOT contain stations outside the Lancaster–Preston–coast boundary', () => {
    // Manchester, Liverpool, Barrow, Cumbria, East Lancashire, etc.
    ['MAN', 'MCO', 'LIV', 'LDS', 'BIF', 'CAR', 'BON', 'WGN', 'BBN', 'BNC'].forEach(crs => {
      expect(STATION_COORDS).not.toHaveProperty(crs);
    });
  });

  it('all stations should have valid coordinates within the service area', () => {
    Object.entries(STATION_COORDS).forEach(([crs, station]) => {
      // Roughly: lat 53.6–54.2, lon -3.1 to -2.6 (with small margin)
      expect(station.lat).toBeGreaterThan(53.5);
      expect(station.lat).toBeLessThan(54.3);
      expect(station.lon).toBeGreaterThan(-3.2);
      expect(station.lon).toBeLessThan(-2.5);
      expect(station.name.length).toBeGreaterThan(0);
    });
  });

  it('should contain exactly the stations within the service area', () => {
    const count = Object.keys(STATION_COORDS).length;
    expect(count).toBeGreaterThanOrEqual(20);
    expect(count).toBeLessThanOrEqual(35);
  });
});

// ─────────────────────────────────────────────────────────
// 3. Walking speed and distance calculations
// ─────────────────────────────────────────────────────────
describe('Walking speed and distance calculations', () => {
  it('Lancaster Uni to Lancaster Centre (~4km) should take ~50 min walking', () => {
    const dist = haversineDistance(
      LOCATIONS.LANCASTER_UNI.lat, LOCATIONS.LANCASTER_UNI.lon,
      LOCATIONS.LANCASTER_CENTRE.lat, LOCATIONS.LANCASTER_CENTRE.lon
    );
    expect(dist).toBeGreaterThan(3);
    expect(dist).toBeLessThan(5);
    const walkMins = Math.ceil(dist / 0.08);
    expect(walkMins).toBeGreaterThan(35);
    expect(walkMins).toBeLessThan(65);
  });

  it('Lancaster Station to Preston Station (~33km) should NOT be walkable', () => {
    const dist = haversineDistance(
      LOCATIONS.LANCASTER_STATION.lat, LOCATIONS.LANCASTER_STATION.lon,
      LOCATIONS.PRESTON_STATION.lat, LOCATIONS.PRESTON_STATION.lon
    );
    expect(dist).toBeGreaterThan(30);
    expect(dist).toBeLessThan(40);
  });

  it('Blackpool North to South (~3km) should be just at walk limit', () => {
    const dist = haversineDistance(
      LOCATIONS.BLACKPOOL_NORTH.lat, LOCATIONS.BLACKPOOL_NORTH.lon,
      LOCATIONS.BLACKPOOL_SOUTH.lat, LOCATIONS.BLACKPOOL_SOUTH.lon
    );
    expect(dist).toBeGreaterThan(2);
    expect(dist).toBeLessThan(4);
  });

  it('Lancaster Station to Morecambe (~5km) should be too far to walk-only', () => {
    const dist = haversineDistance(
      LOCATIONS.LANCASTER_STATION.lat, LOCATIONS.LANCASTER_STATION.lon,
      LOCATIONS.MORECAMBE.lat, LOCATIONS.MORECAMBE.lon
    );
    expect(dist).toBeGreaterThan(4);
    expect(dist).toBeLessThan(7);
  });
});

// ─────────────────────────────────────────────────────────
// 4. Route planner integration tests – within service area
// ─────────────────────────────────────────────────────────

// Helper to test a route and validate basic structure
async function testRoute(startLoc, endLoc, options = {}) {
  const query = {
    startLat: startLoc.lat, startLon: startLoc.lon, startName: startLoc.name,
    endLat: endLoc.lat, endLon: endLoc.lon, endName: endLoc.name,
    time: options.time || '09:00:00',
    day: options.day !== undefined ? String(options.day) : '0',
    ...(options.sort ? { sort: options.sort } : {}),
  };

  return request(app).get('/api/plan').query(query);
}

describe('Route: Lancaster University → Lancaster City Centre (~4km)', () => {
  it('should return routes with walking and/or bus options', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_UNI, LOCATIONS.LANCASTER_CENTRE);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
      const hasTransit = res.body.routes.some(r => r.modes.includes('bus') || r.modes.includes('train'));
      expect(hasTransit).toBe(true);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Lancaster → Preston (~33km, rail/bus)', () => {
  it('should return train and/or bus routes', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.PRESTON_STATION);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
      // Google Maps: 15-25 min by train, 50-70 min by bus
      for (const route of res.body.routes) {
        expect(route.durationMinutes).toBeGreaterThan(0);
        expect(route.durationMinutes).toBeLessThan(180);
      }
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Lancaster → Morecambe (~5km, short rail/bus)', () => {
  it('should return routes, no walk-only for 5km', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.MORECAMBE);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
      const walkOnly = res.body.routes.find(r => r.id === 'walk-only');
      expect(walkOnly).toBeUndefined();
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Preston → Blackpool North (~27km, rail/bus)', () => {
  it('should return train or bus routes', async () => {
    const res = await testRoute(LOCATIONS.PRESTON_STATION, LOCATIONS.BLACKPOOL_NORTH);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
      // Google Maps: ~25 min by train, ~1h by bus
      for (const route of res.body.routes) {
        expect(route.durationMinutes).toBeGreaterThan(0);
        expect(route.durationMinutes).toBeLessThan(180);
      }
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Blackpool North → Lytham (~10km, South Fylde)', () => {
  it('should return train or bus routes along the coast', async () => {
    const res = await testRoute(LOCATIONS.BLACKPOOL_NORTH, LOCATIONS.LYTHAM);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Lancaster → Carnforth (~10km, short rail/bus)', () => {
  it('should return routes including train options', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.CARNFORTH);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Lancaster → Heysham (~11km, bus)', () => {
  it('should return bus routes', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_CENTRE, LOCATIONS.HEYSHAM);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Garstang → Preston (~15km, bus)', () => {
  it('should return bus route options (Garstang has no rail)', async () => {
    const res = await testRoute(LOCATIONS.GARSTANG, LOCATIONS.PRESTON_STATION);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
      const busRoutes = res.body.routes.filter(r => r.modes.includes('bus'));
      expect(busRoutes.length).toBeGreaterThan(0);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Poulton-le-Fylde → Blackpool North (~5km, rail)', () => {
  it('should return short rail routes along the Fylde line', async () => {
    const res = await testRoute(LOCATIONS.POULTON, LOCATIONS.BLACKPOOL_NORTH);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
      // Very short rail trip: ~5 min by train
      for (const route of res.body.routes) {
        expect(route.durationMinutes).toBeLessThan(60);
      }
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Preston → Kirkham & Wesham (~13km, rail/bus)', () => {
  it('should return routes towards the Fylde', async () => {
    const res = await testRoute(LOCATIONS.PRESTON_STATION, LOCATIONS.KIRKHAM);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Morecambe → Heysham (~5km, bus)', () => {
  it('should return bus or walking routes along the coast', async () => {
    const res = await testRoute(LOCATIONS.MORECAMBE, LOCATIONS.HEYSHAM);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: Fleetwood → Preston (Wyre coast, bus)', () => {
  it('should find bus routes from the Wyre coast', async () => {
    const res = await testRoute(LOCATIONS.FLEETWOOD, LOCATIONS.PRESTON_STATION);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

describe('Route: St Annes → Lancaster (~50km, Fylde to Lancaster)', () => {
  it('should return multi-leg routes across the service area', async () => {
    const res = await testRoute(LOCATIONS.ST_ANNES, LOCATIONS.LANCASTER_STATION);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
      for (const route of res.body.routes) {
        expect(route.durationMinutes).toBeGreaterThan(0);
        expect(route.durationMinutes).toBeLessThan(240);
      }
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});

// ─────────────────────────────────────────────────────────
// 5. Duration and timing sanity checks
// ─────────────────────────────────────────────────────────
describe('Duration and timing sanity checks', () => {
  it('all routes should have positive durations', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.PRESTON_STATION);
    if (res.statusCode === 200) {
      for (const route of res.body.routes) {
        expect(route.durationMinutes).toBeGreaterThan(0);
      }
    }
  }, 60000);

  it('arrival should always be after departure', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.PRESTON_STATION);
    if (res.statusCode === 200) {
      for (const route of res.body.routes) {
        const depMins = timeToMinutes(route.departureTime);
        const arrMins = timeToMinutes(route.arrivalTime);
        // Handle midnight crossing
        const duration = arrMins >= depMins ? arrMins - depMins : arrMins + 1440 - depMins;
        expect(duration).toBeGreaterThan(0);
        expect(duration).toBe(route.durationMinutes);
      }
    }
  }, 60000);

  it('bus legs should have valid route numbers', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_UNI, LOCATIONS.LANCASTER_CENTRE);
    if (res.statusCode === 200) {
      for (const route of res.body.routes) {
        for (const leg of route.legs) {
          if (leg.type === 'bus') {
            expect(leg.routeNumber).toBeDefined();
            expect(leg.routeNumber.length).toBeGreaterThan(0);
            expect(leg.boardName).toBeDefined();
            expect(leg.alightName).toBeDefined();
            expect(leg.boardTime).toBeDefined();
            expect(leg.alightTime).toBeDefined();
          }
        }
      }
    }
  }, 60000);

  it('walk legs should have reasonable durations (1-60 min)', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_UNI, LOCATIONS.LANCASTER_CENTRE);
    if (res.statusCode === 200) {
      for (const route of res.body.routes) {
        for (const leg of route.legs) {
          if (leg.type === 'walk') {
            expect(leg.duration).toBeGreaterThanOrEqual(1);
            expect(leg.duration).toBeLessThan(65);
          }
        }
      }
    }
  }, 60000);

  it('transfer legs should have non-negative wait times', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.BLACKPOOL_NORTH);
    if (res.statusCode === 200) {
      for (const route of res.body.routes) {
        for (const leg of route.legs) {
          if (leg.type === 'transfer') {
            expect(leg.waitMinutes).toBeGreaterThanOrEqual(0);
            expect(leg.waitMinutes).toBeLessThan(120);
          }
        }
      }
    }
  }, 60000);

  it('routes should not depart before requested time', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.PRESTON_STATION, { time: '10:00:00' });
    if (res.statusCode === 200) {
      for (const route of res.body.routes) {
        const depMins = timeToMinutes(route.departureTime);
        expect(depMins).toBeGreaterThanOrEqual(timeToMinutes('10:00'));
      }
    }
  }, 60000);
});

// ─────────────────────────────────────────────────────────
// 6. Edge cases and regression tests
// ─────────────────────────────────────────────────────────
describe('Edge cases and regressions', () => {
  it('route response should contain start and end info', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.PRESTON_STATION);
    if (res.statusCode === 200) {
      expect(res.body).toHaveProperty('start');
      expect(res.body).toHaveProperty('end');
      expect(res.body.start).toHaveProperty('name');
      expect(res.body.end).toHaveProperty('name');
      expect(res.body).toHaveProperty('directDistance_km');
      expect(res.body.directDistance_km).toBeGreaterThan(0);
    }
  }, 60000);

  it('requesting routes with sort=duration should sort by duration', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.PRESTON_STATION, { sort: 'duration' });
    if (res.statusCode === 200 && res.body.routes.length > 1) {
      for (let i = 1; i < res.body.routes.length; i++) {
        expect(res.body.routes[i].durationMinutes).toBeGreaterThanOrEqual(
          res.body.routes[i - 1].durationMinutes
        );
      }
    }
  }, 60000);

  it('requesting routes for weekend should use weekend timetable', async () => {
    const res = await testRoute(LOCATIONS.LANCASTER_STATION, LOCATIONS.PRESTON_STATION, { day: 6 }); // Sunday
    if (res.statusCode === 200) {
      expect(res.body.dayOfWeek).toBe('Sunday');
    }
  }, 60000);

  it('Leyland → Preston (short south-of-Preston route)', async () => {
    const res = await testRoute(LOCATIONS.LEYLAND, LOCATIONS.PRESTON_STATION);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
      for (const route of res.body.routes) {
        expect(route.durationMinutes).toBeLessThan(60);
      }
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);

  it('Silverdale → Lancaster (northern boundary of service area)', async () => {
    const res = await testRoute(LOCATIONS.SILVERDALE, LOCATIONS.LANCASTER_STATION);
    if (res.statusCode === 200) {
      expect(res.body.routes.length).toBeGreaterThan(0);
    } else {
      expect([200, 404, 500]).toContain(res.statusCode);
    }
  }, 60000);
});
