/**
 * Journey search service.
 *
 * Finds direct bus, direct train, train-train connections, and bus-rail connections.
 *
 * Exports:
 *   findDirectBusJourneys(fromAtco, toAtco, departureTime, dayIndex, limit)
 *   findDirectTrainJourneys(startTiplocs, endTiplocs, departureTime, limit)
 *   findTrainTrainConnections(startTiplocs, endTiplocs, departureTime, limit)
 *   findBusRailConnections(startAtco, dayIndex, departureTime, limit)
 */

const pool = require('../db/pool');
const { expandStopCode } = require('../utils/stop-utils');
const { timeToMinutes } = require('../utils/time');
const { findNearbyBusStops } = require('./nearby');

/**
 * Find direct bus journeys from one stop to another.
 */
async function findDirectBusJourneys(fromAtco, toAtco, departureTime, dayIndex, limit = 5) {
  const startCodes = await expandStopCode(fromAtco);
  const endCodes = await expandStopCode(toAtco);
  const dayPos = dayIndex + 1;

  const sPlaceholders = startCodes.map((_, i) => `$${i + 1}`).join(',');
  const ePlaceholders = endCodes.map((_, i) => `$${startCodes.length + i + 1}`).join(',');

  const result = await pool.query(`
    SELECT bj.journey_id, bj.route_number, bj.operator_code, o.name as operator_name,
           bjs1.departure_time as board_time, s1.common_name as board_name, bjs1.atco_code as board_atco,
           bjs2.arrival_time as alight_time, s2.common_name as alight_name, bjs2.atco_code as alight_atco,
           (bjs2.stop_sequence - bjs1.stop_sequence) as num_stops
    FROM bus_journey_stops bjs1
    JOIN bus_journeys bj ON bjs1.journey_id = bj.journey_id
    JOIN bus_journey_stops bjs2 ON bj.journey_id = bjs2.journey_id AND bjs2.stop_sequence > bjs1.stop_sequence
    JOIN stops s1 ON bjs1.atco_code = s1.atco_code
    JOIN stops s2 ON bjs2.atco_code = s2.atco_code
    LEFT JOIN operators o ON bj.operator_code = o.operator_code
    WHERE bjs1.atco_code IN (${sPlaceholders})
      AND bjs2.atco_code IN (${ePlaceholders})
      AND SUBSTRING(bj.days_of_week FROM ${dayPos} FOR 1) = '1'
      AND bjs1.departure_time >= $${startCodes.length + endCodes.length + 1}::time
    ORDER BY bjs1.departure_time
    LIMIT $${startCodes.length + endCodes.length + 2}
  `, [...startCodes, ...endCodes, departureTime, limit]);

  return result.rows.map(r => ({
    type: 'bus',
    journeyId: r.journey_id,
    routeNumber: r.route_number,
    operator: r.operator_code,
    operatorName: r.operator_name,
    boardAtco: r.board_atco,
    boardName: r.board_name,
    boardTime: r.board_time,
    alightAtco: r.alight_atco,
    alightName: r.alight_name,
    alightTime: r.alight_time,
    numStops: r.num_stops,
    duration: timeToMinutes(r.alight_time) - timeToMinutes(r.board_time)
  }));
}

/**
 * Find direct train journeys between two sets of TIPLOC codes.
 */
async function findDirectTrainJourneys(startTiplocs, endTiplocs, departureTime, limit = 5) {
  if (startTiplocs.length === 0 || endTiplocs.length === 0) return [];

  const sPlaceholders = startTiplocs.map((_, i) => `$${i + 1}`).join(',');
  const ePlaceholders = endTiplocs.map((_, i) => `$${startTiplocs.length + i + 1}`).join(',');

  const result = await pool.query(`
    SELECT sp1.train_uid, sp1.tiploc_code as start_tiploc, sp2.tiploc_code as end_tiploc,
           sp1.departure as board_time, sp2.arrival as alight_time,
           s1.common_name as board_name, s2.common_name as alight_name,
           ts.atoc_code as operator
    FROM schedule_points sp1
    JOIN schedule_points sp2 ON sp1.train_uid = sp2.train_uid
      AND sp2.sequence_order > sp1.sequence_order
    JOIN national_rail nr1 ON sp1.tiploc_code = nr1.tiploc_code
    JOIN national_rail nr2 ON sp2.tiploc_code = nr2.tiploc_code
    JOIN stops s1 ON nr1.atco_code = s1.atco_code
    JOIN stops s2 ON nr2.atco_code = s2.atco_code
    LEFT JOIN train_schedules ts ON sp1.train_uid = ts.train_uid
    WHERE sp1.tiploc_code IN (${sPlaceholders})
      AND sp2.tiploc_code IN (${ePlaceholders})
      AND sp1.departure >= $${startTiplocs.length + endTiplocs.length + 1}::time
      AND sp1.departure IS NOT NULL
      AND sp2.arrival IS NOT NULL
    ORDER BY sp1.departure
    LIMIT $${startTiplocs.length + endTiplocs.length + 2}
  `, [...startTiplocs, ...endTiplocs, departureTime, limit]);

  return result.rows.map(r => ({
    type: 'train',
    trainUid: r.train_uid,
    startTiploc: r.start_tiploc,
    endTiploc: r.end_tiploc,
    boardName: r.board_name,
    alightName: r.alight_name,
    boardTime: r.board_time,
    alightTime: r.alight_time,
    operator: r.operator,
    duration: timeToMinutes(r.alight_time) - timeToMinutes(r.board_time)
  }));
}

/**
 * Find train-to-train connections (one change) between two sets of TIPLOCs.
 */
async function findTrainTrainConnections(startTiplocs, endTiplocs, departureTime, limit = 5) {
  if (startTiplocs.length === 0 || endTiplocs.length === 0) return [];

  const sPlaceholders = startTiplocs.map((_, i) => `$${i + 1}`).join(',');
  const ePlaceholders = endTiplocs.map((_, i) => `$${startTiplocs.length + i + 1}`).join(',');

  const result = await pool.query(`
    SELECT
      sp1.train_uid as train1_uid, sp1.tiploc_code as start_tiploc,
      sp2.tiploc_code as change_tiploc,
      sp2.arrival as train1_arrive, sp3.departure as train2_depart,
      sp3.train_uid as train2_uid, sp4.tiploc_code as end_tiploc,
      sp4.arrival as train2_arrive,
      sp1.departure as train1_depart,
      s1.common_name as start_name, s2.common_name as change_name,
      s4.common_name as end_name,
      ts1.atoc_code as operator1, ts2.atoc_code as operator2
    FROM schedule_points sp1
    JOIN schedule_points sp2 ON sp1.train_uid = sp2.train_uid
      AND sp2.sequence_order > sp1.sequence_order
    JOIN schedule_points sp3 ON sp3.tiploc_code = sp2.tiploc_code
      AND sp3.train_uid != sp1.train_uid
      AND sp3.departure >= sp2.arrival + INTERVAL '3 minutes'
      AND sp3.departure <= sp2.arrival + INTERVAL '60 minutes'
    JOIN schedule_points sp4 ON sp3.train_uid = sp4.train_uid
      AND sp4.sequence_order > sp3.sequence_order
    JOIN national_rail nr1 ON sp1.tiploc_code = nr1.tiploc_code
    JOIN national_rail nr2 ON sp2.tiploc_code = nr2.tiploc_code
    JOIN national_rail nr4 ON sp4.tiploc_code = nr4.tiploc_code
    JOIN stops s1 ON nr1.atco_code = s1.atco_code
    JOIN stops s2 ON nr2.atco_code = s2.atco_code
    JOIN stops s4 ON nr4.atco_code = s4.atco_code
    LEFT JOIN train_schedules ts1 ON sp1.train_uid = ts1.train_uid
    LEFT JOIN train_schedules ts2 ON sp3.train_uid = ts2.train_uid
    WHERE sp1.tiploc_code IN (${sPlaceholders})
      AND sp4.tiploc_code IN (${ePlaceholders})
      AND sp1.departure >= $${startTiplocs.length + endTiplocs.length + 1}::time
      AND sp1.departure IS NOT NULL AND sp2.arrival IS NOT NULL
      AND sp3.departure IS NOT NULL AND sp4.arrival IS NOT NULL
    ORDER BY sp1.departure
    LIMIT $${startTiplocs.length + endTiplocs.length + 2}
  `, [...startTiplocs, ...endTiplocs, departureTime, limit]);

  return result.rows.map(r => ({
    legs: [
      {
        type: 'train',
        trainUid: r.train1_uid,
        startTiploc: r.start_tiploc,
        endTiploc: r.change_tiploc,
        boardName: r.start_name,
        alightName: r.change_name,
        boardTime: r.train1_depart,
        alightTime: r.train1_arrive,
        operator: r.operator1,
        duration: timeToMinutes(r.train1_arrive) - timeToMinutes(r.train1_depart)
      },
      {
        type: 'transfer',
        station: r.change_name,
        tiploc: r.change_tiploc,
        waitMinutes: timeToMinutes(r.train2_depart) - timeToMinutes(r.train1_arrive)
      },
      {
        type: 'train',
        trainUid: r.train2_uid,
        startTiploc: r.change_tiploc,
        endTiploc: r.end_tiploc,
        boardName: r.change_name,
        alightName: r.end_name,
        boardTime: r.train2_depart,
        alightTime: r.train2_arrive,
        operator: r.operator2,
        duration: timeToMinutes(r.train2_arrive) - timeToMinutes(r.train2_depart)
      }
    ]
  }));
}

/**
 * Find bus routes that connect to rail stations from a given bus stop.
 */
async function findBusRailConnections(startAtco, dayIndex, departureTime, limit = 5) {
  const nearbyStops = await findNearbyBusStops(startAtco, 1.0);
  const busJourneys = [];

  for (const stop of nearbyStops.slice(0, 3)) {
    const expanded = await expandStopCode(stop.atco_code);
    for (const code of expanded) {
      const journeys = await findDirectBusJourneys(code, startAtco, departureTime, dayIndex, 2);
      busJourneys.push(...journeys);
    }
  }

  return busJourneys.slice(0, limit);
}

module.exports = {
  findDirectBusJourneys,
  findDirectTrainJourneys,
  findTrainTrainConnections,
  findBusRailConnections,
};
