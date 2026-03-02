/**
 * useRoutePlanner — manage route planning state and actions.
 *
 * Returns {
 *   startStop, setStartStop, endStop, setEndStop,
 *   routes, routeLoading, routeError,
 *   selectedRoute, setSelectedRoute,
 *   sortBy, setSortBy, departureTime, setDepartureTime,
 *   findRoutes, swapStops, useMyLocation, handlePinDrop, handleSortChange
 * }
 */

import { useEffect, useState, useCallback } from 'react';
import { geocodeText, reverseGeocode, reverseGeocodeFull, planRoute } from '../services/api';

const MAX_ROUTES = 3;

export default function useRoutePlanner(userLocation) {
  const [startStop, setStartStop] = useState(null);
  const [endStop, setEndStop] = useState(null);
  const [routes, setRoutes] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [sortBy, setSortBy] = useState('duration');
  const [departureTime, setDepartureTime] = useState('');

  // Use GPS as start location
  const useMyLocation = useCallback(async () => {
    if (!userLocation) return;
    const loc = {
      type: 'place',
      name: 'My Location',
      common_name: 'My Location',
      lat: userLocation.lat,
      lon: userLocation.lon,
      isUserLocation: true
    };
    setStartStop(loc);
    try {
      const data = await reverseGeocode(userLocation.lat, userLocation.lon);
      if (data.name && data.name !== 'My Location') {
        setStartStop(prev => prev?.isUserLocation
          ? { ...prev, name: `📍 ${data.name}`, common_name: `📍 ${data.name}` }
          : prev
        );
      }
    } catch { /* keep 'My Location' */ }
  }, [userLocation]);

  // Swap start ⇄ end
  const swap = () => {
    const temp = startStop;
    setStartStop(endStop);
    setEndStop(temp);
    setRoutes(null);
    setSelectedRoute(null);
  };

  // Find routes between start and end
  const findRoutes = useCallback(async () => {
    let resolvedStart = startStop;
    let resolvedEnd = endStop;

    setRouteLoading(true);
    setRouteError(null);

    if (resolvedStart?.type === 'text') {
      resolvedStart = await geocodeText(resolvedStart.text);
      if (resolvedStart) setStartStop(resolvedStart);
    }
    if (resolvedEnd?.type === 'text') {
      resolvedEnd = await geocodeText(resolvedEnd.text);
      if (resolvedEnd) setEndStop(resolvedEnd);
    }

    if (!resolvedStart || !resolvedEnd) {
      setRouteError('Could not find one or both locations. Try a more specific name or pick from the suggestions.');
      setRouteLoading(false);
      return;
    }

    if (resolvedStart.atco_code && resolvedEnd.atco_code && resolvedStart.atco_code === resolvedEnd.atco_code) {
      setRouteError('Start and end locations must be different');
      setRouteLoading(false);
      return;
    }
    if (resolvedStart.lat === resolvedEnd.lat && resolvedStart.lon === resolvedEnd.lon) {
      setRouteError('Start and end locations must be different');
      setRouteLoading(false);
      return;
    }

    setRoutes(null);
    setSelectedRoute(null);

    try {
      const now = new Date();
      const time = departureTime || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const day = (now.getDay() + 6) % 7;

      const params = {};
      params.time = time;
      params.day = day;
      params.sort = sortBy;

      if (resolvedStart.type === 'stop' && resolvedStart.atco_code) {
        params.start = resolvedStart.atco_code;
      } else {
        params.startLat = resolvedStart.lat;
        params.startLon = resolvedStart.lon;
        params.startName = resolvedStart.name || resolvedStart.common_name || 'Start';
      }

      if (resolvedEnd.type === 'stop' && resolvedEnd.atco_code) {
        params.end = resolvedEnd.atco_code;
      } else {
        params.endLat = resolvedEnd.lat;
        params.endLon = resolvedEnd.lon;
        params.endName = resolvedEnd.name || resolvedEnd.common_name || 'Destination';
      }

      const data = await planRoute(params);

      if (data.error) {
        setRouteError(data.error);
      } else {
        const limited = {
          ...data,
          routes: data.routes.slice(0, MAX_ROUTES),
          totalRoutes: Math.min(data.totalRoutes, MAX_ROUTES),
          usingTime: departureTime ? time : `Now (${time.substring(0, 5)})`,
          nextAvailable: data.nextAvailable || null
        };
        setRoutes(limited);
        if (limited.routes.length > 0) setSelectedRoute(0);
      }
    } catch (err) {
      setRouteError('Failed to connect to server. Please try again.');
      console.error('Route planning error:', err);
    } finally {
      setRouteLoading(false);
    }
  }, [startStop, endStop, sortBy, departureTime]);

  const handleSortChange = (newSort) => setSortBy(newSort);

  // Handle pin-drop from map
  const handlePinDrop = useCallback(async (latlng) => {
    if (!latlng) return;
    try {
      const data = await reverseGeocodeFull(latlng.lat, latlng.lng);
      const name = (data && data.name) ? data.name : 'Pinned location';
      setEndStop({
        type: 'place', name, common_name: name,
        lat: latlng.lat, lon: latlng.lng,
        fullName: data?.display_name
      });
    } catch {
      setEndStop({
        type: 'place', name: 'Pinned location', common_name: 'Pinned location',
        lat: latlng.lat, lon: latlng.lng
      });
    }
    setRoutes(null);
    setSelectedRoute(null);
  }, []);

  // Re-fetch when sort changes
  useEffect(() => {
    if (routes && startStop && endStop) {
      findRoutes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  return {
    startStop, setStartStop, endStop, setEndStop,
    routes, routeLoading, routeError,
    selectedRoute, setSelectedRoute,
    sortBy, departureTime, setDepartureTime,
    findRoutes, swapStops: swap, useMyLocation, handlePinDrop, handleSortChange,
  };
}
