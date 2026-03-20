import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import FilterPage from '../FilterPage';

describe('FilterPage accessibility', () => {
  it('adds descriptive aria-labels for filter toggle buttons', () => {
    render(<FilterPage onBack={() => {}} onSubmit={() => {}} />);

    expect(screen.getByRole('button', { name: 'Toggle Show Bus Stops' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Show Train Stations' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle Show Traffic Conditions' })).toBeInTheDocument();
  });
});
