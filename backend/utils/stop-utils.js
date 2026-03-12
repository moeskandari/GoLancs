/**
 * Stop code expansion utility.
 *
 * Bus stops often have multiple bays/stands at the same location,
 * grouped by a shared locality_centre ATCO prefix.  This function
 * expands a single ATCO code into all sibling stops so timetable
 * queries can match any bay.
 *
 * Exports:
 *   expandStopCode(atcoCode) → Promise<string[]>
 */

const pool = require('../db/pool');

/**
 * Expand a stop code to include all related stops at the same station/stand.
 * For rail stops (9100*), returns the code as-is.
 * For bus stops, finds all stops sharing the same locality_centre prefix.
 */
async function expandStopCode(atcoCode) {
  if (atcoCode.startsWith('9100')) return [atcoCode];

  try {
    // Find all stops that share the same locality_centre (same bus station/area)
    const result = await pool.query(`
      SELECT DISTINCT s2.atco_code
      FROM stops s1
      JOIN stops s2 ON SUBSTRING(s1.atco_code FROM 1 FOR 7) = SUBSTRING(s2.atco_code FROM 1 FOR 7)
      WHERE s1.atco_code = $1
    `, [atcoCode]);

    return result.rows.length > 0
      ? result.rows.map(r => r.atco_code)
      : [atcoCode];
  } catch (err) {
    console.warn(`[STOP-UTILS] Stop code expansion failed for ${atcoCode}:`, err.message);
    return [atcoCode];
  }
}

module.exports = { expandStopCode };
