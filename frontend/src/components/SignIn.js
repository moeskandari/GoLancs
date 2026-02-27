import React, { useState } from 'react';
import './Auth.css';

/**
 * SignIn component – renders as a centered overlay on top of the existing map.
 *
 * Props:
 *   onClose       – callback to dismiss the overlay and return to the map
 *   onSignIn      – callback fired when the user submits the form (placeholder for future backend)
 *   onSwitchToSignUp – callback to navigate to the Sign Up overlay
 */
function SignIn({ onClose, onSignIn, onSwitchToSignUp }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // Placeholder – will be connected to the backend later
    if (onSignIn) {
      onSignIn({ email, password });
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Sign In">
      {/* Backdrop – clicking it closes the overlay */}
      <div className="auth-backdrop" onClick={onClose} />

      <div className="auth-card">
        {/* Close button */}
        <button
          className="auth-close-btn"
          onClick={onClose}
          aria-label="Close sign in"
          title="Close"
        >
          ✕
        </button>

        <h2 className="auth-title">Sign in</h2>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <label className="auth-label" htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <button type="submit" className="auth-submit-btn">
            Sign in
          </button>
        </form>

        {/* Forgot password – currently does nothing */}
        <button
          className="auth-link-btn"
          onClick={() => {/* placeholder – will navigate to password reset later */}}
          type="button"
        >
          Forgot password?
        </button>

        <p className="auth-switch-text">
          Don't have an account?{' '}
          <button
            className="auth-link-btn inline"
            onClick={onSwitchToSignUp}
            type="button"
          >
            Sign up
          </button>
        </p>
      </div>
    </div>
  );
}

export default SignIn;
