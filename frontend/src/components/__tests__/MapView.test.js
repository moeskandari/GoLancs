import '@testing-library/jest-dom';
import { TRAFFIC_COLORS } from '../MapView';

jest.mock('react-leaflet', () => ({
  MapContainer: () => null,
  TileLayer: () => null,
  useMap: () => ({ getZoom: () => 12, on: () => {}, off: () => {} }),
  Marker: () => null,
  Polyline: () => null,
  Popup: () => null,
  CircleMarker: () => null,
}));

jest.mock('leaflet', () => ({
  __esModule: true,
  default: {
    divIcon: () => ({}),
    icon: () => ({}),
    latLngBounds: () => ({ pad: () => ({}) }),
  },
}));

describe('MapView traffic colours', () => {
  it('uses a darker red for heavy delays', () => {
    expect(TRAFFIC_COLORS[3]).toEqual(
      expect.objectContaining({
        color: '#b91c1c',
        label: 'Heavy delays',
      })
    );
  });
});
