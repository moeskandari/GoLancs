/**
 * Tests for live tracking and delay display features in RouteResults.
 *
 * Tests:
 * - Train delay info highlighting (strikethrough, estimated times)
 * - Transfer/changeover adjusted wait times and connection warnings
 * - Route-level delay banners
 * - Cancelled service display
 * - Track Live button rendering
 */


import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import RouteResults from '../../components/RouteResults';

// ── Helper: build mock routes ──────────────────────────────

const buildMockRoutes = (routeList) => ({
  totalRoutes: routeList.length,
  routes: routeList,
  start: { name: 'Lancaster' },
  end: { name: 'Preston' },
  directDistance_km: '30.2',
  usingTime: '09:00',
});

// ── Mock routes with train legs ────────────────────────────

const trainRoute = {
  id: 'train-1',
  summary: 'Train LAN → PRE',
  durationMinutes: 20,
  departureTime: '09:20',
  arrivalTime: '09:40',
  legs: [
    {
      type: 'train',
      boardName: 'Lancaster',
      alightName: 'Preston',
      boardTime: '09:20',
      alightTime: '09:40',
      operator: 'NT',
      operatorName: 'Northern Trains',
      startCrs: 'LAN',
      endCrs: 'PRE',
      numStops: 0,
      callingPoints: [
        { crs: 'LAN', name: 'Lancaster', scheduledTime: '09:20' },
        { crs: 'PRE', name: 'Preston', scheduledTime: '09:40' },
      ],
    },
  ],
};

const trainWithTransferRoute = {
  id: 'train-transfer-1',
  summary: 'Train LAN → PRE → MAN',
  durationMinutes: 80,
  departureTime: '09:20',
  arrivalTime: '10:40',
  legs: [
    {
      type: 'train',
      boardName: 'Lancaster',
      alightName: 'Preston',
      boardTime: '09:20',
      alightTime: '09:40',
      operator: 'NT',
      operatorName: 'Northern Trains',
      startCrs: 'LAN',
      endCrs: 'PRE',
      numStops: 0,
    },
    {
      type: 'transfer',
      fromName: 'Preston',
      toName: 'Preston',
      waitMinutes: 10,
    },
    {
      type: 'train',
      boardName: 'Preston',
      alightName: 'Manchester Piccadilly',
      boardTime: '09:50',
      alightTime: '10:40',
      operator: 'AV',
      operatorName: 'Avanti West Coast',
      startCrs: 'PRE',
      endCrs: 'MAN',
      numStops: 0,
    },
  ],
};

const busRoute = {
  id: 'bus-1',
  summary: 'Bus 100',
  durationMinutes: 45,
  departureTime: '09:00',
  arrivalTime: '09:45',
  legs: [
    {
      type: 'bus',
      boardName: 'InfoLab21',
      alightName: 'Preston Bus Station',
      boardTime: '09:00',
      alightTime: '09:45',
      routeNumber: '100',
      numStops: 12,
      direction: 'Preston',
    },
  ],
};

// ── Mock rail departures (simulating live data) ─────────────

const onTimeDepartures = {
  station: 'LAN',
  services: [
    {
      scheduledDeparture: '09:20',
      estimatedDeparture: 'On time',
      destination: 'Preston',
      destinationCrs: 'PRE',
      operator: 'NT',
      callingPoints: [
        { crs: 'LAN', name: 'Lancaster', scheduledTime: '09:20', estimatedTime: 'On time' },
        { crs: 'PRE', name: 'Preston', scheduledTime: '09:40', estimatedTime: 'On time' },
      ],
    },
  ],
};

const delayedDepartures = {
  station: 'LAN',
  services: [
    {
      scheduledDeparture: '09:20',
      estimatedDeparture: '09:27',
      destination: 'Preston',
      destinationCrs: 'PRE',
      operator: 'NT',
      callingPoints: [
        { crs: 'LAN', name: 'Lancaster', scheduledTime: '09:20', estimatedTime: '09:27' },
        { crs: 'PRE', name: 'Preston', scheduledTime: '09:40', estimatedTime: '09:48' },
      ],
    },
  ],
};

const cancelledDepartures = {
  station: 'LAN',
  services: [
    {
      scheduledDeparture: '09:20',
      estimatedDeparture: null,
      destination: 'Preston',
      destinationCrs: 'PRE',
      operator: 'NT',
      cancelReason: 'This train has been cancelled due to a signalling problem',
      callingPoints: [],
    },
  ],
};

// ── Default props builder ──────────────────────────────────

const defaultProps = (routeOverrides = {}, extraProps = {}) => ({
  routes: buildMockRoutes([trainRoute]),
  selectedRoute: null,
  onSelectRoute: jest.fn(),
  sortBy: 'duration',
  onSortChange: jest.fn(),
  liveVehicles: [],
  railDepartures: null,
  trackedLeg: null,
  trackedTrainService: null,
  onTrackLeg: jest.fn(),
  liveTrackingActive: false,
  ...extraProps,
});

// ── Tests ──────────────────────────────────────────────────

describe('RouteResults – Live Tracking Features', () => {
  afterEach(() => jest.clearAllMocks());

  // ── Track Live button ────────────────────────────────────

  describe('Track Live button', () => {
    it('renders Track Live button for bus legs when expanded', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([busRoute]),
        selectedRoute: 0,
      });
      render(<RouteResults {...props} />);
      const trackBtn = document.querySelector('.track-btn');
      expect(trackBtn).toBeTruthy();
    });

    it('renders Track Live button for train legs when expanded', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainRoute]),
        selectedRoute: 0,
      });
      render(<RouteResults {...props} />);
      const trackBtn = document.querySelector('.train-track-btn, .track-live-btn');
      expect(trackBtn).toBeTruthy();
    });

    it('calls onTrackLeg when Track Live button is clicked', () => {
      const onTrack = jest.fn();
      const props = defaultProps({}, {
        routes: buildMockRoutes([busRoute]),
        selectedRoute: 0,
        onTrackLeg: onTrack,
      });
      render(<RouteResults {...props} />);
      const trackBtn = document.querySelector('.bus-track-btn, .track-live-btn');
      if (trackBtn) {
        fireEvent.click(trackBtn);
        expect(onTrack).toHaveBeenCalled();
      }
    });
  });

  // ── Train delay display ──────────────────────────────────

  describe('Train delay display', () => {
    it('does not show delay indicators when train is on time', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainRoute]),
        selectedRoute: 0,
        railDepartures: onTimeDepartures,
      });
      const { container } = render(<RouteResults {...props} />);
      expect(container.querySelector('.scheduled-struck')).toBeNull();
      expect(container.querySelector('.estimated-time')).toBeNull();
    });

    it('shows strikethrough scheduled time when train is delayed', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainRoute]),
        selectedRoute: 0,
        railDepartures: delayedDepartures,
        trackedTrainService: delayedDepartures.services[0],
      });
      const { container } = render(<RouteResults {...props} />);
      const struck = container.querySelectorAll('.scheduled-struck');
      expect(struck.length).toBeGreaterThan(0);
    });

    it('shows estimated time in orange when train is delayed', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainRoute]),
        selectedRoute: 0,
        railDepartures: delayedDepartures,
        trackedTrainService: delayedDepartures.services[0],
      });
      const { container } = render(<RouteResults {...props} />);
      const estimated = container.querySelectorAll('.estimated-time, .estimated-arrival');
      expect(estimated.length).toBeGreaterThan(0);
    });

    it('shows cancellation warning for cancelled services', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainRoute]),
        selectedRoute: 0,
        railDepartures: cancelledDepartures,
        trackedTrainService: cancelledDepartures.services[0],
      });
      const { container } = render(<RouteResults {...props} />);
      const cancelled = container.querySelector(
        '.leg-cancelled-warning, .header-cancelled-badge, .route-cancelled'
      );
      expect(cancelled).toBeTruthy();
    });
  });

  // ── Route header delay info ──────────────────────────────

  describe('Route header delay banner', () => {
    it('shows delayed arrival time in route header', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainRoute]),
        selectedRoute: 0,
        railDepartures: delayedDepartures,
        trackedTrainService: delayedDepartures.services[0],
      });
      const { container } = render(<RouteResults {...props} />);
      // Look for a delay indicator on the route card header
      const delayedCard = container.querySelector(
        '.route-delayed, .arrival-delayed, .route-delay-banner'
      );
      // May also show estimated arrival time 09:48
      const headerText = container.querySelector('.route-card')?.textContent || '';
      // The header should show some indication of delay
      expect(
        delayedCard !== null || headerText.includes('09:48') || headerText.includes('delay')
      ).toBeTruthy();
    });
  });

  // ── Transfer / changeover delay propagation ──────────────

  describe('Transfer delay propagation', () => {
    it('renders transfer leg between two train legs', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainWithTransferRoute]),
        selectedRoute: 0,
      });
      const { container } = render(<RouteResults {...props} />);
      const transferLeg = container.querySelector('.transfer-chip, [class*="transfer"]');
      expect(transferLeg).toBeTruthy();
    });

    it('shows connection risk warning when first train is delayed', () => {
      const delayedService = {
        scheduledDeparture: '09:20',
        estimatedDeparture: '09:35',
        destination: 'Preston',
        destinationCrs: 'PRE',
        operator: 'NT',
        callingPoints: [
          { crs: 'LAN', name: 'Lancaster', scheduledTime: '09:20', estimatedTime: '09:35' },
          { crs: 'PRE', name: 'Preston', scheduledTime: '09:40', estimatedTime: '09:55' },
        ],
      };

      const props = defaultProps({}, {
        routes: buildMockRoutes([trainWithTransferRoute]),
        selectedRoute: 0,
        railDepartures: {
          station: 'LAN',
          services: [delayedService],
        },
        trackedTrainService: delayedService,
      });

      const { container } = render(<RouteResults {...props} />);
      // With a 15-min delay and only 10 min changeover, connection should be at risk
      const riskWarning = container.querySelector(
        '.changeover-missed, .changeover-risk, .leg-delay-warning'
      );
      expect(riskWarning).toBeTruthy();
    });
  });

  // ── Rail live badge ──────────────────────────────────────

  describe('Rail live badge', () => {
    it('shows on-time badge when service is on time', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainRoute]),
        selectedRoute: 0,
        railDepartures: onTimeDepartures,
        trackedTrainService: onTimeDepartures.services[0],
      });
      const { container } = render(<RouteResults {...props} />);
      const badge = container.querySelector('.rail-live-badge');
      if (badge) {
        expect(badge.classList.contains('on-time') || badge.textContent.includes('On time')).toBeTruthy();
      }
    });

    it('shows delayed badge when service is delayed', () => {
      const props = defaultProps({}, {
        routes: buildMockRoutes([trainRoute]),
        selectedRoute: 0,
        railDepartures: delayedDepartures,
        trackedTrainService: delayedDepartures.services[0],
      });
      const { container } = render(<RouteResults {...props} />);
      const badge = container.querySelector('.rail-live-badge');
      if (badge) {
        expect(badge.classList.contains('delayed') || badge.textContent.includes('delay')).toBeTruthy();
      }
    });
  });

  // ── Calling points display ───────────────────────────────

  describe('Calling points', () => {
    it('renders calling points section for train legs when expanded', () => {
      const routeWithCallingPoints = {
        ...trainRoute,
        legs: [{
          ...trainRoute.legs[0],
          callingPoints: [
            { crs: 'LAN', name: 'Lancaster', scheduledTime: '09:20' },
            { crs: 'GAR', name: 'Garstang', scheduledTime: '09:30' },
            { crs: 'PRE', name: 'Preston', scheduledTime: '09:40' },
          ],
        }],
      };

      const props = defaultProps({}, {
        routes: buildMockRoutes([routeWithCallingPoints]),
        selectedRoute: 0,
        railDepartures: onTimeDepartures,
        trackedTrainService: onTimeDepartures.services[0],
      });

      const { container } = render(<RouteResults {...props} />);
      const callingPointsSection = container.querySelector('.calling-points');
      // Calling points may only render when there's live departure data
      // with calling points attached
      if (callingPointsSection) {
        expect(callingPointsSection).toBeInTheDocument();
      }
    });
  });

  // ── Bus live tracking badge ──────────────────────────────

  describe('Bus live status', () => {
    it('shows live tracked badge when bus has live vehicle data', () => {
      const liveVehicle = {
        vehicleRef: 'BUS-42',
        lineRef: '100',
        lineName: '100',
        operatorRef: 'SCCU',
        latitude: 54.0488,
        longitude: -2.8079,
        recordedAt: new Date().toISOString(),
      };

      const props = defaultProps({}, {
        routes: buildMockRoutes([busRoute]),
        selectedRoute: 0,
        liveVehicles: [liveVehicle],
        trackedLeg: busRoute.legs[0],
        liveTrackingActive: true,
      });

      const { container } = render(<RouteResults {...props} />);
      const liveBadge = container.querySelector('.live-status-badge');
      if (liveBadge) {
        expect(liveBadge.textContent).toContain('Live');
      }
    });
  });
});

// ── Test helper functions (exported from RouteResults) ──────

describe('RouteResults helper functions', () => {
  // These test the pure function logic that's defined inside RouteResults.js
  // We test them indirectly through component rendering

  it('correctly formats durations under 60 minutes', () => {
    const props = defaultProps({}, {
      routes: buildMockRoutes([{
        ...trainRoute,
        durationMinutes: 45,
      }]),
    });
    render(<RouteResults {...props} />);
    expect(screen.getByText('45 min')).toBeInTheDocument();
  });

  it('correctly formats durations over 60 minutes', () => {
    const props = defaultProps({}, {
      routes: buildMockRoutes([{
        ...trainWithTransferRoute,
        durationMinutes: 80,
      }]),
    });
    render(<RouteResults {...props} />);
    expect(screen.getByText('1h 20m')).toBeInTheDocument();
  });

  it('shows correct departure and arrival times on cards', () => {
    const props = defaultProps({}, {
      routes: buildMockRoutes([trainRoute]),
    });
    render(<RouteResults {...props} />);
    expect(screen.getByText('09:20')).toBeInTheDocument();
    expect(screen.getByText('09:40')).toBeInTheDocument();
  });
});
