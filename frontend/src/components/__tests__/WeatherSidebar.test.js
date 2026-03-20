import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeatherSidebar from '../WeatherSidebar';

describe('WeatherSidebar accessibility behavior', () => {
  it('closes on Escape key when sidebar is open', () => {
    const onClose = jest.fn();
    render(
      <WeatherSidebar
        isOpen={true}
        onClose={onClose}
        currentWeather={null}
        destWeather={null}
        loadingCurrent={false}
        loadingDest={false}
        hasDestination={false}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
