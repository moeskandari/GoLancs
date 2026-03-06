/**
 * Tests for SignUp component.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SignUp from '../SignUp';

// Mock the AuthContext
const mockSignUp = jest.fn();
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    signUp: mockSignUp
  })
}));

describe('SignUp Component', () => {
  const defaultProps = {
    onClose: jest.fn(),
    onCreateAccount: jest.fn(),
    onSwitchToSignIn: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the sign up form', () => {
    render(<SignUp {...defaultProps} />);

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Sign Up');
    expect(screen.getByText('Sign up')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Last name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Retype Password')).toBeInTheDocument();
  });

  it('shows password requirements when typing', async () => {
    render(<SignUp {...defaultProps} />);

    const passwordInput = screen.getByLabelText('Password');
    await userEvent.type(passwordInput, 'a');

    expect(screen.getByText(/At least 8 characters/)).toBeInTheDocument();
    expect(screen.getByText(/One uppercase letter/)).toBeInTheDocument();
    expect(screen.getByText(/One lowercase letter/)).toBeInTheDocument();
    expect(screen.getByText(/One number/)).toBeInTheDocument();
    expect(screen.getByText(/One special character/)).toBeInTheDocument();
  });

  it('shows password match status', async () => {
    render(<SignUp {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('Password'), 'StrongPass1!');
    await userEvent.type(screen.getByLabelText('Retype Password'), 'StrongPass1!');

    expect(screen.getByText(/Passwords match/)).toBeInTheDocument();
  });

  it('shows password mismatch', async () => {
    render(<SignUp {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('Password'), 'StrongPass1!');
    await userEvent.type(screen.getByLabelText('Retype Password'), 'DifferentPass1!');

    expect(screen.getByText(/Passwords do not match/)).toBeInTheDocument();
  });

  it('disables submit button until password is strong and matches', async () => {
    render(<SignUp {...defaultProps} />);

    const submitBtn = screen.getByRole('button', { name: /create your account/i });
    expect(submitBtn).toBeDisabled();

    await userEvent.type(screen.getByLabelText('First name'), 'John');
    await userEvent.type(screen.getByLabelText('Last name'), 'Doe');
    await userEvent.type(screen.getByLabelText('Email'), 'john@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'StrongPass1!');
    await userEvent.type(screen.getByLabelText('Retype Password'), 'StrongPass1!');

    expect(submitBtn).not.toBeDisabled();
  });

  it('calls signUp on valid form submission', async () => {
    mockSignUp.mockResolvedValueOnce({ user: { id: 1, firstName: 'John' } });

    render(<SignUp {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('First name'), 'John');
    await userEvent.type(screen.getByLabelText('Last name'), 'Doe');
    await userEvent.type(screen.getByLabelText('Email'), 'john@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'StrongPass1!');
    await userEvent.type(screen.getByLabelText('Retype Password'), 'StrongPass1!');

    fireEvent.click(screen.getByRole('button', { name: /create your account/i }));

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalledWith({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass1!',
        retypePassword: 'StrongPass1!'
      });
    });
  });

  it('displays error when email is already registered', async () => {
    const error = new Error('An account with this email address already exists.');
    error.data = { redirect: 'signin' };
    mockSignUp.mockRejectedValueOnce(error);

    render(<SignUp {...defaultProps} />);

    await userEvent.type(screen.getByLabelText('First name'), 'John');
    await userEvent.type(screen.getByLabelText('Last name'), 'Doe');
    await userEvent.type(screen.getByLabelText('Email'), 'existing@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'StrongPass1!');
    await userEvent.type(screen.getByLabelText('Retype Password'), 'StrongPass1!');

    fireEvent.click(screen.getByRole('button', { name: /create your account/i }));

    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    });
  });

  it('has switch to sign in link', () => {
    render(<SignUp {...defaultProps} />);

    fireEvent.click(screen.getByText('Sign in'));
    expect(defaultProps.onSwitchToSignIn).toHaveBeenCalled();
  });

  it('closes when backdrop is clicked', () => {
    render(<SignUp {...defaultProps} />);

    fireEvent.click(document.querySelector('.auth-backdrop'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
