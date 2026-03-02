/**
 * useLiveTracking — poll live bus GPS or rail departures for a selected leg.
 *
 * Returns {
 *   liveVehicles, trackedLeg, liveTrackingActive,
 *   railDepartures, trackedTrainService,
 *   startTracking, stopTracking, fetchRailDepartures
 * }
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { fetchLiveBusRoute, fetchRailDepartures as apiRailDeps } from '../services/api';

const LIVE_POLL_INTERVAL = 15000;
const TRAIN_POLL_INTERVAL = 30000;

export default function useLiveTracking(routes, selectedRoute) {
  const [liveVehicles, setLiveVehicles] = useState([]);
  const [trackedLeg, setTrackedLeg] = useState(null);
  const [liveTrackingActive, setLiveTrackingActive] = useState(false);
  const [railDepartures, setRailDepartures] = useState(null);
  const [trackedTrainService, setTrackedTrainService] = useState(null);
  const liveIntervalRef = useRef(null);

  // Live train data fetcher
  const fetchLiveTrainData = useCallback(async (leg) => {
    if (!leg || !leg.startCrs) return;
    try {
      const data = await apiRailDeps(leg.startCrs);
      setRailDepartures(data);
      const boardTimeShort = leg.boardTime ? leg.boardTime.substring(0, 5) : null;
      const match = (data.services || []).find(s =>
        s.scheduledDeparture === boardTimeShort && s.destination?.crs === leg.endCrs
      ) || (data.services || []).find(s =>
        s.scheduledDeparture === boardTimeShort
      );
      if (match) setTrackedTrainService(match);
    } catch (e) {
      console.warn('Failed to fetch live train data:', e.message);
    }
  }, []);

  // Live bus fetcher — picks single best match
  const fetchLiveVehicles = useCallback(async (leg) => {
    if (!leg || !leg.routeNumber) return;
    try {
      const data = await fetchLiveBusRoute(leg.routeNumber);
      const all = data.vehicles || [];
      if (all.length === 0) { setLiveVehicles([]); return; }

      const scored = all.map(v => {
        let score = 0;
        if (leg.operator && v.operatorRef && v.operatorRef.toUpperCase() === leg.operator.toUpperCase()) score += 10;
        if (leg.direction && v.directionRef && v.directionRef.toLowerCase() === leg.direction.toLowerCase()) score += 5;
        const oName = (v.originName || '').toLowerCase();
        const dName = (v.destinationName || '').toLowerCase();
        if (leg.boardName && oName.includes(leg.boardName.toLowerCase().slice(0, 8))) score += 3;
        if (leg.alightName && dName.includes(leg.alightName.toLowerCase().slice(0, 8))) score += 3;
        if (leg.boardAtco && v.originRef === leg.boardAtco) score += 8;
        if (leg.alightAtco && v.destinationRef === leg.alightAtco) score += 8;
        const age = v.recordedAt ? (Date.now() - new Date(v.recordedAt).getTime()) / 60000 : 999;
        if (age < 5) score += 2;
        return { vehicle: v, score, age };
      });
      scored.sort((a, b) => b.score - a.score || a.age - b.age);
      setLiveVehicles([scored[0].vehicle]);
    } catch (e) {
      console.warn('Failed to fetch live bus data:', e.message);
    }
  }, []);

  // Start tracking a leg
  const startTracking = useCallback((leg) => {
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current);
      liveIntervalRef.current = null;
    }
    setTrackedLeg(leg);
    setLiveTrackingActive(true);
    setLiveVehicles([]);
    setTrackedTrainService(null);

    if (leg.type === 'train') {
      fetchLiveTrainData(leg);
      liveIntervalRef.current = setInterval(() => fetchLiveTrainData(leg), TRAIN_POLL_INTERVAL);
    } else {
      fetchLiveVehicles(leg);
      liveIntervalRef.current = setInterval(() => fetchLiveVehicles(leg), LIVE_POLL_INTERVAL);
    }
  }, [fetchLiveVehicles, fetchLiveTrainData]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current);
      liveIntervalRef.current = null;
    }
    setTrackedLeg(null);
    setLiveTrackingActive(false);
    setLiveVehicles([]);
    setTrackedTrainService(null);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
    };
  }, []);

  // Fetch rail departures for station
  const fetchRailDeps = useCallback(async (crsCode) => {
    if (!crsCode) return;
    try {
      const data = await apiRailDeps(crsCode);
      setRailDepartures(data);
    } catch (e) {
      console.warn('Failed to fetch rail departures:', e.message);
    }
  }, []);

  // Auto-fetch rail departures when a train leg is selected
  useEffect(() => {
    if (!routes || selectedRoute === null) { setRailDepartures(null); return; }
    const route = routes.routes[selectedRoute];
    if (!route) return;
    const trainLeg = route.legs.find(l => l.type === 'train');
    if (trainLeg?.startCrs) {
      fetchRailDeps(trainLeg.startCrs);
    } else {
      setRailDepartures(null);
    }
  }, [routes, selectedRoute, fetchRailDeps]);

  return {
    liveVehicles, trackedLeg, liveTrackingActive,
    railDepartures, trackedTrainService,
    startTracking, stopTracking,
    fetchRailDepartures: fetchRailDeps,
  };
}
