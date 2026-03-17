/**
 * Tests for SignIn component.
 */


import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SignIn from '../SignIn';

// Mock the AuthContext
const mockSignIn = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    signIn: mockSignIn
  })
}));

describe('SignIn Component', () => {
  const defaultProps = {
    onClose: jest.fn(),
    onSignIn: jest.fn(),
    onSwitchToSignUp: jest.fn(),
    onForgotPassword: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the sign in form', () => {
    render(<SignIn {...defaultProps} />);

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Sign In');
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('has forgot password link', () => {
    render(<SignIn {...defaultProps} />);

    const forgotBtn = screen.getByText('Forgot password?');
    fireEvent.click(forgotBtn);
    expect(defaultProps.onForgotPassword).toHaveBeenCalled();
  });

  it('has switch to sign up link', () => {
    render(<SignIn {...defaultProps} />);

    const signUpBtn = screen.getByText('Sign up');
    fireEvent.click(signUpBtn);
    expect(defaultProps.onSwitchToSignUp).toHaveBeenCalled();
  });

  it('closes when backdrop is clicked', () => {
    render(<SignIn {...defaultProps} />);

    const backdrop = document.querySelector('.auth-backdrop');
    fireEvent.click(backdrop);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('closes when close button is clicked', () => {
    render(<SignIn {...defaultProps} />);

    const closeBtn = screen.getByLabelText('Close sign in');
    fireEvent.click(closeBtn);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls signIn on form submission', async () => {
    mockSignIn.mockResolvedValueOnce({ user: { id: 1, firstName: 'John' } });

    render(<SignIn {...defaultProps} />);

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');

    await userEvent.type(emailInput, 'john@example.com');
    await userEvent.type(passwordInput, 'StrongPass1!');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({
        email: 'john@example.com',
        password: 'StrongPass1!'
      });
    });
  });

  it('displays error message on failed sign-in', async () => {
    const error = new Error('Invalid email or password.');
    error.data = {};
    mockSignIn.mockRejectedValueOnce(error);

    render(<SignIn {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('Email'), 'wrong@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'WrongPass1!');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Invalid email or password/i)).toBeInTheDocument();
    });
  });

  it('displays field-level validation errors', async () => {
    const error = new Error('Validation failed');
    error.data = {
      details: [
        { field: 'email', message: 'Please provide a valid email address' }
      ]
    };
    mockSignIn.mockRejectedValueOnce(error);

    render(<SignIn {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('Email'), 'bad');
    await userEvent.type(screen.getByLabelText('Password'), 'test');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    });
  });

  it('disables form while submitting', async () => {
    // Make signIn hang
    mockSignIn.mockImplementation(() => new Promise(() => {}));

    render(<SignIn {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('Email'), 'john@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'StrongPass1!');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toBeDisabled();
      expect(screen.getByLabelText('Password')).toBeDisabled();
      expect(screen.getByText(/Signing in/i)).toBeInTheDocument();
    });
  });
});
