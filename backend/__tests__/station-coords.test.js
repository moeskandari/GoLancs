/**
 * Tests for STATION_COORDS lookup and getStationCoords function.
 * Validates station coordinate coverage, data integrity, and lookup behaviour.
 */

const app = require('../server');
const { getStationCoords, STATION_COORDS } = app._test;

describe('STATION_COORDS', () => {
  it('should contain all core Lancashire stations', () => {
    const coreCRS = ['LAN', 'PRE', 'MCM', 'BPN', 'BPS', 'CNF', 'OXN'];
    coreCRS.forEach(crs => {
      expect(STATION_COORDS).toHaveProperty(crs);
    });
  });

  it('should contain Greater Manchester interchange stations', () => {
    const manchesterCRS = ['MAN', 'MCO', 'MIA', 'BON', 'WGN'];
    manchesterCRS.forEach(crs => {
      expect(STATION_COORDS).toHaveProperty(crs);
    });
  });

  it('should contain Blackpool & Fylde line stations', () => {
    const fyldeCRS = ['BPN', 'BPS', 'BPB', 'SQU', 'SAS', 'LTM', 'PFY', 'LAY', 'KKM'];
    fyldeCRS.forEach(crs => {
      expect(STATION_COORDS).toHaveProperty(crs);
    });
  });

  it('should contain East Lancashire line stations', () => {
    const eastLancsCRS = ['BBN', 'ACR', 'BYM', 'BNC', 'CNE', 'NEL', 'BRF', 'RSG'];
    eastLancsCRS.forEach(crs => {
      expect(STATION_COORDS).toHaveProperty(crs);
    });
  });

  it('should contain Bolton/Chorley corridor stations', () => {
    const chorleyLineCRS = ['CRL', 'ADL', 'BSV', 'BLK', 'HWI', 'LOT', 'BON'];
    chorleyLineCRS.forEach(crs => {
      expect(STATION_COORDS).toHaveProperty(crs);
    });
  });

  it('should have at least 80 stations', () => {
    expect(Object.keys(STATION_COORDS).length).toBeGreaterThanOrEqual(80);
  });

  it('every station should have lat, lon, and name', () => {
    Object.entries(STATION_COORDS).forEach(([crs, station]) => {
      expect(station).toHaveProperty('lat');
      expect(station).toHaveProperty('lon');
      expect(station).toHaveProperty('name');
      expect(typeof station.lat).toBe('number');
      expect(typeof station.lon).toBe('number');
      expect(typeof station.name).toBe('string');
      expect(station.name.length).toBeGreaterThan(0);
    });
  });

  it('all coordinates should be within UK bounds', () => {
    Object.entries(STATION_COORDS).forEach(([crs, station]) => {
      expect(station.lat).toBeGreaterThan(50.0);
      expect(station.lat).toBeLessThan(56.0);
      expect(station.lon).toBeGreaterThan(-6.0);
      expect(station.lon).toBeLessThan(2.0);
    });
  });

  it('Lancaster station should have correct coordinates', () => {
    const lan = STATION_COORDS.LAN;
    expect(lan.name).toBe('Lancaster');
    expect(lan.lat).toBeCloseTo(54.0488, 2);
    expect(lan.lon).toBeCloseTo(-2.8079, 2);
  });

  it('Preston station should have correct coordinates', () => {
    const pre = STATION_COORDS.PRE;
    expect(pre.name).toBe('Preston');
    expect(pre.lat).toBeCloseTo(53.7553, 2);
    expect(pre.lon).toBeCloseTo(-2.7072, 2);
  });
});

describe('getStationCoords', () => {
  it('should return coordinates for a valid CRS code', () => {
    const result = getStationCoords('LAN');
    expect(result).toEqual({ lat: 54.0488, lon: -2.8079 });
  });

  it('should return coordinates for lowercase CRS code', () => {
    const result = getStationCoords('lan');
    expect(result).toEqual({ lat: 54.0488, lon: -2.8079 });
  });

  it('should return coordinates for mixed-case CRS code', () => {
    const result = getStationCoords('Lan');
    expect(result).toEqual({ lat: 54.0488, lon: -2.8079 });
  });

  it('should return null for an unknown CRS code', () => {
    expect(getStationCoords('ZZZ')).toBeNull();
  });

  it('should return null for null input', () => {
    expect(getStationCoords(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(getStationCoords(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(getStationCoords('')).toBeNull();
  });

  it('should not include the name property in the result', () => {
    const result = getStationCoords('LAN');
    expect(result).not.toHaveProperty('name');
    expect(Object.keys(result)).toEqual(['lat', 'lon']);
  });

  it('should return different coordinates for different stations', () => {
    const lan = getStationCoords('LAN');
    const pre = getStationCoords('PRE');
    expect(lan).not.toEqual(pre);
  });

  it('should work for all Blackpool stations', () => {
    ['BPN', 'BPS', 'BPB'].forEach(crs => {
      const result = getStationCoords(crs);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('lat');
      expect(result).toHaveProperty('lon');
    });
  });
});
