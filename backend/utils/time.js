/**
 * Time and scheduling utility functions.
 *
 * Pure functions with no external dependencies — safe to use anywhere.
 *
 * Exports:
 *   timeToMinutes(t)    – "HH:MM" or "HH:MM:SS" → minutes since midnight
 *   minutesToTime(m)    – minutes since midnight → "HH:MM"
 *   getDayIndex(name)   – day name → 0-6 index (Mon=0, Sun=6)
 */

/**
 * Convert a time string ("HH:MM" or "HH:MM:SS") to minutes since midnight.
 * Handles times past midnight (e.g. "24:15" → 1455).
 * Returns null for null/undefined input.
 */
function timeToMinutes(t) {
  if (!t) return null;
  const parts = t.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * Convert minutes since midnight to a "HH:MM" string.
 * Wraps around 24 hours (e.g. 1500 → "01:00").
 */
function minutesToTime(m) {
  const wrapped = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const min = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Convert a day name or numeric index to a 0-based index.
 * Accepts: "monday", "tue", 0, "3", etc.
 * Monday = 0, Sunday = 6.  Defaults to the current day if input is unrecognised.
 */
function getDayIndex(day) {
  if (day !== undefined && day !== null) {
    const num = parseInt(day);
    if (!isNaN(num)) return num;
    const names = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
    const idx = names[String(day).toLowerCase()];
    if (idx !== undefined) return idx;
  }
  return (new Date().getDay() + 6) % 7;
}

module.exports = { timeToMinutes, minutesToTime, getDayIndex };
