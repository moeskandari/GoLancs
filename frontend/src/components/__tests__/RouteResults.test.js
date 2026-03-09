/**
 * Frontend tests for the RouteResults component.
 *
 * RouteResults expects props:
 *   routes   – object with { totalRoutes, routes[], start, end, directDistance_km, usingTime }
 *   selectedRoute – index of currently selected route
 *   onSelectRoute – callback(index)
 *   sortBy – 'duration' | 'departure' | 'arrival'
 *   onSortChange – callback(value)
 */


import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import RouteResults from '../../components/RouteResults';

const buildMockRoutes = (routeList) => ({
  totalRoutes: routeList.length,
  routes: routeList,
  start: { name: 'InfoLab21' },
  end: { name: 'Preston' },
  directDistance_km: '30.2',
  usingTime: '09:00',
});

const sampleRoutes = [
  {
    id: 'r1',
    summary: 'Bus 100 → Train',
    durationMinutes: 47,
    departureTime: '09:00',
    arrivalTime: '09:47',
    legs: [
      {
        type: 'bus',
        boardName: 'InfoLab21',
        alightName: 'Lancaster Bus Station',
        boardTime: '09:00',
        alightTime: '09:15',
        routeNumber: '100',
        numStops: 5,
        direction: 'Lancaster',
      },
      {
        type: 'train',
        boardName: 'Lancaster',
        alightName: 'Preston',
        boardTime: '09:20',
        alightTime: '09:40',
        operator: 'AV',
        operatorName: 'Avanti West Coast',
        numStops: 0,
      },
    ],
  },
  {
    id: 'r2',
    summary: 'Walk → Train',
    durationMinutes: 55,
    departureTime: '08:45',
    arrivalTime: '09:40',
    legs: [
      {
        type: 'walk',
        fromName: 'InfoLab21',
        toName: 'Lancaster Station',
        duration: 25,
        distance_km: 2.1,
      },
      {
        type: 'train',
        boardName: 'Lancaster',
        alightName: 'Preston',
        boardTime: '09:20',
        alightTime: '09:40',
        operator: 'AV',
      },
    ],
  },
];

describe('RouteResults', () => {
  const defaultProps = {
    routes: buildMockRoutes(sampleRoutes),
    selectedRoute: null,
    onSelectRoute: jest.fn(),
    sortBy: 'duration',
    onSortChange: jest.fn(),
  };

  afterEach(() => jest.clearAllMocks());

  // ── Null / empty states ──────────────────────────────────

  it('renders nothing when routes is null', () => {
    const { container } = render(
      <RouteResults {...defaultProps} routes={null} />
    );
    expect(container.querySelector('.route-results')).toBeNull();
  });

  it('shows "No routes found" when totalRoutes is 0', () => {
    render(
      <RouteResults
        {...defaultProps}
        routes={buildMockRoutes([])}
      />
    );
    expect(screen.getByText(/no routes found/i)).toBeInTheDocument();
  });

  // ── Rendering route cards ────────────────────────────────

  it('renders correct number of route cards', () => {
    const { container } = render(<RouteResults {...defaultProps} />);
    const cards = container.querySelectorAll('.route-card');
    expect(cards.length).toBe(2);
  });

  it('displays route count in header', () => {
    render(<RouteResults {...defaultProps} />);
    expect(screen.getByText(/2 routes found/i)).toBeInTheDocument();
  });

  it('shows start and end names in the meta line', () => {
    render(<RouteResults {...defaultProps} />);
    expect(screen.getByText(/InfoLab21/)).toBeInTheDocument();
    expect(screen.getByText(/Preston/)).toBeInTheDocument();
  });

  it('shows departure and arrival times on route cards', () => {
    render(<RouteResults {...defaultProps} />);
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('09:47')).toBeInTheDocument();
  });

  it('shows duration formatted correctly (47 min)', () => {
    render(<RouteResults {...defaultProps} />);
    expect(screen.getByText('47 min')).toBeInTheDocument();
  });

  // ── Transport type icons / chips ─────────────────────────

  it('shows bus route number in mode chip', () => {
    render(<RouteResults {...defaultProps} />);
    // The ModesSummary renders chips like "🚌 100 15 min"
    const busChips = document.querySelectorAll('.bus-chip');
    expect(busChips.length).toBeGreaterThan(0);
  });

  it('shows walk chip for walk legs', () => {
    render(<RouteResults {...defaultProps} />);
    const walkChips = document.querySelectorAll('.walk-chip');
    expect(walkChips.length).toBeGreaterThan(0);
  });

  // ── Interaction ──────────────────────────────────────────

  it('calls onSelectRoute when a route card is clicked', () => {
    const onSelect = jest.fn();
    const { container } = render(
      <RouteResults {...defaultProps} onSelectRoute={onSelect} />
    );
    const cards = container.querySelectorAll('.route-card');
    fireEvent.click(cards[0]);
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('calls onSelectRoute with correct index for second card', () => {
    const onSelect = jest.fn();
    const { container } = render(
      <RouteResults {...defaultProps} onSelectRoute={onSelect} />
    );
    const cards = container.querySelectorAll('.route-card');
    fireEvent.click(cards[1]);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('expands selected route to show leg details', () => {
    const { container } = render(
      <RouteResults {...defaultProps} selectedRoute={0} />
    );
    const expanded = container.querySelector('.route-expanded');
    expect(expanded).toBeTruthy();
    // Should show the leg detail cards
    const legCards = expanded.querySelectorAll('.leg-detail-card');
    expect(legCards.length).toBe(2); // bus + train
  });

  it('shows bus leg details when expanded', () => {
    render(<RouteResults {...defaultProps} selectedRoute={0} />);
    // Bus badge should show route number
    const busBadge = document.querySelector('.bus-badge');
    expect(busBadge).toBeTruthy();
    expect(busBadge.textContent).toBe('100');
  });

  // ── Sort control ─────────────────────────────────────────

  it('renders sort select with correct default', () => {
    render(<RouteResults {...defaultProps} sortBy="changes" />);
    const select = screen.getByLabelText(/sort routes by/i);
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('changes');
  });

  it('calls onSortChange when sort selection changes', () => {
    const onSort = jest.fn();
    render(<RouteResults {...defaultProps} sortBy="changes" onSortChange={onSort} />);
    const select = screen.getByLabelText(/sort routes by/i);
    fireEvent.change(select, { target: { value: 'arrival' } });
    expect(onSort).toHaveBeenCalledWith('arrival');
  });

  // ── Accessibility ────────────────────────────────────────

  it('route cards have role=button and aria-label', () => {
    const { container } = render(<RouteResults {...defaultProps} />);
    const cards = container.querySelectorAll('.route-card');
    cards.forEach((card) => {
      expect(card.getAttribute('role')).toBe('button');
      expect(card.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('supports keyboard selection (Enter key)', () => {
    const onSelect = jest.fn();
    const { container } = render(
      <RouteResults {...defaultProps} onSelectRoute={onSelect} />
    );
    const card = container.querySelector('.route-card');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  // ── Single route grammar ─────────────────────────────────

  it('uses singular "route" when only one route', () => {
    render(
      <RouteResults
        {...defaultProps}
        routes={buildMockRoutes([sampleRoutes[0]])}
      />
    );
    expect(screen.getByText(/1 route found/i)).toBeInTheDocument();
  });
});
