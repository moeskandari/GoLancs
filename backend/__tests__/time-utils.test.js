/**
 * Unit tests for time/scheduling utility functions.
 * Tests: timeToMinutes, minutesToTime, getDayIndex
 */

const app = require('../server');
const { timeToMinutes, minutesToTime, getDayIndex } = app._test;

describe('timeToMinutes', () => {
  it('should convert "00:00" to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('should convert "09:00" to 540', () => {
    expect(timeToMinutes('09:00')).toBe(540);
  });

  it('should convert "12:30" to 750', () => {
    expect(timeToMinutes('12:30')).toBe(750);
  });

  it('should convert "23:59" to 1439', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('should handle times past midnight like "24:15" (1455)', () => {
    expect(timeToMinutes('24:15')).toBe(1455);
  });

  it('should return null for null input', () => {
    expect(timeToMinutes(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(timeToMinutes(undefined)).toBeNull();
  });
});

describe('minutesToTime', () => {
  it('should convert 0 to "00:00"', () => {
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('should convert 540 to "09:00"', () => {
    expect(minutesToTime(540)).toBe('09:00');
  });

  it('should convert 750 to "12:30"', () => {
    expect(minutesToTime(750)).toBe('12:30');
  });

  it('should convert 1439 to "23:59"', () => {
    expect(minutesToTime(1439)).toBe('23:59');
  });

  it('should pad single-digit hours and minutes', () => {
    expect(minutesToTime(65)).toBe('01:05');
  });
});

describe('getDayIndex', () => {
  it('should return 0 for "monday"', () => {
    expect(getDayIndex('monday')).toBe(0);
  });

  it('should return 4 for "friday"', () => {
    expect(getDayIndex('friday')).toBe(4);
  });

  it('should return 6 for "sunday"', () => {
    expect(getDayIndex('sunday')).toBe(6);
  });

  it('should be case-insensitive', () => {
    expect(getDayIndex('Monday')).toBe(0);
    expect(getDayIndex('FRIDAY')).toBe(4);
  });

  it('should accept numeric index as string', () => {
    expect(getDayIndex('0')).toBe(0);
    expect(getDayIndex('3')).toBe(3);
  });

  it('should accept numeric index as number', () => {
    expect(getDayIndex(0)).toBe(0);
    expect(getDayIndex(5)).toBe(5);
  });

  it('should return current day index when no argument given', () => {
    const result = getDayIndex(undefined);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(6);
  });
});
