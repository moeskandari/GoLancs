import React, { useState } from 'react';
import './Auth.css';

/**
 * SignUp component – renders as a centered overlay on top of the existing map.
 *
 * Props:
 *   onClose            – callback to dismiss the overlay and return to the map
 *   onCreateAccount    – callback fired when the user submits the form (placeholder for future backend)
 *   onSwitchToSignIn   – callback to navigate to the Sign In overlay
 */
function SignUp({ onClose, onCreateAccount, onSwitchToSignIn }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [retypePassword, setRetypePassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // Placeholder – will be connected to the backend later
    if (onCreateAccount) {
      onCreateAccount({ firstName, lastName, email, password, retypePassword });
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Sign Up">
      {/* Backdrop – clicking it closes the overlay */}
      <div className="auth-backdrop" onClick={onClose} />

      <div className="auth-card">
        {/* Close button */}
        <button
          className="auth-close-btn"
          onClick={onClose}
          aria-label="Close sign up"
          title="Close"
        >
          ✕
        </button>

        <h2 className="auth-title">Sign up</h2>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label" htmlFor="signup-firstname">First name</label>
          <input
            id="signup-firstname"
            className="auth-input"
            type="text"
            placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            required
          />

          <label className="auth-label" htmlFor="signup-lastname">Last name</label>
          <input
            id="signup-lastname"
            className="auth-input"
            type="text"
            placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            required
          />

          <label className="auth-label" htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />

          <label className="auth-label" htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />

          <label className="auth-label" htmlFor="signup-retype-password">Retype Password</label>
          <input
            id="signup-retype-password"
            className="auth-input"
            type="password"
            placeholder="Retype Password"
            value={retypePassword}
            onChange={(e) => setRetypePassword(e.target.value)}
            autoComplete="new-password"
            required
          />

          <button type="submit" className="auth-submit-btn">
            Create your account
          </button>
        </form>

        <p className="auth-terms-text">
          By creating an account, you agree to the{' '}
          <button
            className="auth-link-btn inline"
            onClick={() => {/* placeholder – will open Terms page later */}}
            type="button"
          >
            Terms
          </button>
        </p>

        <p className="auth-switch-text">
          Already have an account?{' '}
          <button
            className="auth-link-btn inline"
            onClick={onSwitchToSignIn}
            type="button"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}

export default SignUp;
