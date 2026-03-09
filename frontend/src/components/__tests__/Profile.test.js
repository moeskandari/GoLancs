/**
 * Tests for Profile component.
 */


import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Profile from '../Profile';

// Mock the AuthContext
const mockSignOut = jest.fn().mockResolvedValue();
const mockUpdateProfile = jest.fn();
const mockDeleteAccount = jest.fn();
const mockLoadPoints = jest.fn().mockResolvedValue({ points: 100, transactions: [] });
const mockLoadRewards = jest.fn().mockResolvedValue({ rewards: [] });
const mockRedeemReward = jest.fn();
const mockResendVerification = jest.fn().mockResolvedValue();

const mockUser = {
  id: 1,
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  emailVerified: true,
  points: 150,
  createdAt: '2025-01-15T10:00:00Z'
};

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    points: 150,
    transactions: [
      { id: 1, points: 50, type: 'signup_bonus', description: 'Welcome bonus', createdAt: '2025-01-15T10:00:00Z' },
      { id: 2, points: 10, type: 'route_taken', description: 'Route Lancaster to Preston', createdAt: '2025-01-16T12:00:00Z' }
    ],
    rewards: [
      { id: 1, name: '10% Off', description: 'Discount on next ticket', points_cost: 100 },
      { id: 2, name: 'Free Pass', description: 'Free day pass', points_cost: 500 }
    ],
    signOut: mockSignOut,
    updateProfile: mockUpdateProfile,
    deleteAccount: mockDeleteAccount,
    loadPoints: mockLoadPoints,
    loadRewards: mockLoadRewards,
    redeemReward: mockRedeemReward,
    resendVerification: mockResendVerification
  })
}));

describe('Profile Component', () => {
  const defaultProps = {
    onBack: jest.fn(),
    onLogout: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadPoints.mockResolvedValue({ points: 100, transactions: [] });
    mockLoadRewards.mockResolvedValue({ rewards: [] });
  });

  it('renders user information', () => {
    render(<Profile {...defaultProps} />);

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getAllByText('john@example.com').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('150')).toBeInTheDocument(); // points
  });

  it('has back button that navigates to map', () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('← Back'));
    expect(defaultProps.onBack).toHaveBeenCalled();
  });

  it('has logout button', async () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('Log out'));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
      expect(defaultProps.onLogout).toHaveBeenCalled();
    });
  });

  it('shows profile tab by default', () => {
    render(<Profile {...defaultProps} />);

    expect(screen.getByText('First name')).toBeInTheDocument();
    expect(screen.getByText('Last name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('can switch to edit mode', () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('Edit Profile'));

    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('john@example.com')).toBeInTheDocument();
  });

  it('can switch to points tab', () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('⭐ Points'));

    expect(screen.getByText('Activity History')).toBeInTheDocument();
    expect(screen.getByText('Welcome bonus')).toBeInTheDocument();
  });

  it('can switch to rewards tab', () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('🎁 Rewards'));

    expect(screen.getByText('Available Rewards')).toBeInTheDocument();
    expect(screen.getByText('10% Off')).toBeInTheDocument();
    expect(screen.getByText('Free Pass')).toBeInTheDocument();
  });

  it('disables redeem button when not enough points', () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('🎁 Rewards'));

    // The "Free Pass" costs 500 but user has 150
    const buttons = screen.getAllByText(/Not enough/i);
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('can switch to settings tab', () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('⚙️ Settings'));

    expect(screen.getByText('Account Settings')).toBeInTheDocument();
    expect(screen.getByText('Delete Account')).toBeInTheDocument();
  });

  it('shows delete confirmation before deleting', () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('⚙️ Settings'));
    fireEvent.click(screen.getByText('Delete Account'));

    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText('Yes, delete my account')).toBeInTheDocument();
  });

  it('can cancel delete confirmation', () => {
    render(<Profile {...defaultProps} />);

    fireEvent.click(screen.getByText('⚙️ Settings'));
    fireEvent.click(screen.getByText('Delete Account'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
  });

  it('has tab navigation with proper aria attributes', () => {
    render(<Profile {...defaultProps} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(4);

    // Profile tab should be selected by default
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('shows member since date', () => {
    render(<Profile {...defaultProps} />);

    expect(screen.getByText(/Member since/i)).toBeInTheDocument();
  });
});
