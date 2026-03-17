/**
 * Tests for ForgotPassword component.
 */


import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import ForgotPassword from '../ForgotPassword';

// Mock the AuthContext
const mockForgotPassword = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    forgotPassword: mockForgotPassword
  })
}));

describe('ForgotPassword Component', () => {
  const defaultProps = {
    onClose: jest.fn(),
    onSwitchToSignIn: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the forgot password form', () => {
    render(<ForgotPassword {...defaultProps} />);

    expect(screen.getByText('Reset Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText('Send Reset Link')).toBeInTheDocument();
  });

  it('shows success message after sending', async () => {
    mockForgotPassword.mockResolvedValueOnce({ message: 'Email sent' });

    render(<ForgotPassword {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('Email'), 'john@example.com');
    fireEvent.click(screen.getByText('Send Reset Link'));

    await waitFor(() => {
      expect(screen.getByText(/password reset link/i)).toBeInTheDocument();
    });
  });

  it('shows error on failure', async () => {
    mockForgotPassword.mockRejectedValueOnce(new Error('Network error'));

    render(<ForgotPassword {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('Email'), 'john@example.com');
    fireEvent.click(screen.getByText('Send Reset Link'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('has back to sign in link', () => {
    render(<ForgotPassword {...defaultProps} />);

    fireEvent.click(screen.getByText('Sign in'));
    expect(defaultProps.onSwitchToSignIn).toHaveBeenCalled();
  });

  it('disables submit when email is empty', () => {
    render(<ForgotPassword {...defaultProps} />);

    const submitBtn = screen.getByText('Send Reset Link');
    expect(submitBtn).toBeDisabled();
  });
});
