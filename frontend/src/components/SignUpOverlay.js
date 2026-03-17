import React from 'react';
import './Overlay.css';

function SignUpOverlay({ onClose, onSwitchToSignIn }) {
  const handleSubmit = (e) => {
    e.preventDefault();
    // Frontend-only: no backend action yet
    // Keep form submission inert for now
    alert('Create account submitted (frontend-only).');
  };

  return (
    <div className="overlay-backdrop">
      <div className="overlay-card">
        <button className="overlay-close" onClick={onClose}>×</button>
        <h2 className="overlay-title">Sign Up</h2>
        <form className="overlay-form" onSubmit={handleSubmit}>
          <label>
            First Name
            <input type="text" name="firstName" required />
          </label>
          <label>
            Last Name
            <input type="text" name="lastName" required />
          </label>
          <label>
            Email
            <input type="email" name="email" required />
          </label>
          <label>
            Password
            <input type="password" name="password" required />
          </label>
          <label>
            Retype Password
            <input type="password" name="password2" required />
          </label>
          <button type="submit" className="primary-btn">Create Your Account</button>
        </form>
        <div className="overlay-terms">
          <small>By Creating an Account, You Agree To <button className="link-btn">Terms</button></small>
        </div>
        <div className="overlay-footer">
          <span>Already Have an Account? </span>
          <button className="link-btn" onClick={() => onSwitchToSignIn && onSwitchToSignIn()}>Sign In</button>
        </div>
      </div>
    </div>
  );
}

export default SignUpOverlay;
