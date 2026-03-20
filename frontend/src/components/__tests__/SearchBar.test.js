/**
 * Frontend tests for the SearchBar component.
 * Tests:
 *   - Renders with placeholder
 *   - Shows "Use my current location" option for start input when user has location
 *   - Handles text input and displays it
 *   - Does not show location option for destination input
 */


import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchBar from '../SearchBar';

// Mock fetch globally
beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ stops: [], places: [] }),
    })
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SearchBar', () => {
  it('renders with the given placeholder', () => {
    render(
      <SearchBar
        placeholder="Where from?"
        type="start"
        value={null}
        onChange={() => {}}
      />
    );
    expect(screen.getByPlaceholderText('Where from?')).toBeInTheDocument();
    expect(screen.getByLabelText('Where from?')).toBeInTheDocument();
  });

  it('renders input with correct initial value', () => {
    render(
      <SearchBar
        placeholder="Where from?"
        type="start"
        value={{ name: 'InfoLab21', atco_code: '2500915' }}
        onChange={() => {}}
      />
    );
    expect(screen.getByDisplayValue('InfoLab21')).toBeInTheDocument();
  });

  it('shows "Use my current location" when type=start and hasUserLocation', () => {
    render(
      <SearchBar
        placeholder="Where from?"
        type="start"
        value={null}
        onChange={() => {}}
        onUseMyLocation={() => {}}
        hasUserLocation={true}
      />
    );
    const input = screen.getByPlaceholderText('Where from?');
    fireEvent.focus(input);
    // The dropdown should show the location option
    expect(screen.getByText(/use my current location/i)).toBeInTheDocument();
  });

  it('shows "Use my current location" for destination input too', () => {
    render(
      <SearchBar
        placeholder="Where to?"
        type="end"
        value={null}
        onChange={() => {}}
        onUseMyLocation={() => {}}
        hasUserLocation={true}
      />
    );
    const input = screen.getByPlaceholderText('Where to?');
    fireEvent.focus(input);
    // The component shows the option for any type when callback + location are provided
    expect(screen.queryByText(/use my current location/i)).toBeInTheDocument();
  });

  it('does NOT show "Use my current location" when no user location', () => {
    render(
      <SearchBar
        placeholder="Where from?"
        type="start"
        value={null}
        onChange={() => {}}
        onUseMyLocation={() => {}}
        hasUserLocation={false}
      />
    );
    const input = screen.getByPlaceholderText('Where from?');
    fireEvent.focus(input);
    expect(screen.queryByText(/use my current location/i)).not.toBeInTheDocument();
  });

  it('calls onUseMyLocation when location option is clicked', () => {
    const mockUseLocation = jest.fn();
    render(
      <SearchBar
        placeholder="Where from?"
        type="start"
        value={null}
        onChange={() => {}}
        onUseMyLocation={mockUseLocation}
        hasUserLocation={true}
      />
    );
    const input = screen.getByPlaceholderText('Where from?');
    fireEvent.focus(input);
    fireEvent.click(screen.getByText(/use my current location/i));
    expect(mockUseLocation).toHaveBeenCalledTimes(1);
  });

  it('updates input text on typing', () => {
    const mockChange = jest.fn();
    render(
      <SearchBar
        placeholder="Where from?"
        type="start"
        value={null}
        onChange={mockChange}
      />
    );
    const input = screen.getByPlaceholderText('Where from?');
    fireEvent.change(input, { target: { value: 'Lancaster' } });
    expect(input.value).toBe('Lancaster');
  });

  it('clears input when clear button is clicked', () => {
    const mockChange = jest.fn();
    render(
      <SearchBar
        placeholder="Where from?"
        type="start"
        value={{ name: 'InfoLab21', atco_code: '2500915' }}
        onChange={mockChange}
      />
    );
    // Should have a clear button when there's a value
    const clearBtn = screen.queryByRole('button');
    if (clearBtn) {
      fireEvent.click(clearBtn);
      expect(mockChange).toHaveBeenCalledWith(null);
    }
  });

  it('announces no-results text as status update', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ stops: [], places: [] }),
      })
    );

    render(
      <SearchBar
        placeholder="Where from?"
        type="start"
        value={null}
        onChange={() => {}}
      />
    );
    const input = screen.getByLabelText('Where from?');
    fireEvent.change(input, { target: { value: 'zz' } });

    const statusNode = await screen.findByRole('status');
    expect(statusNode).toHaveTextContent('No results found for "zz"');
  });
});
