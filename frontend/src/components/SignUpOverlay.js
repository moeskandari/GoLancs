import React, { useState } from 'react';
import './Overlay.css';

function SignUpOverlay({ onClose, onSwitchToSignIn }) {
  const [showPassword, setShowPassword] = useState(false);
  const [showRetypePassword, setShowRetypePassword] = useState(false);

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
            <div className="password-field-group">
              <input type={showPassword ? 'text' : 'password'} name="password" className="password-input" required />
              <button type="button" className="password-visibility-btn" onClick={() => setShowPassword(prev => !prev)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <label>
            Retype Password
            <div className="password-field-group">
              <input type={showRetypePassword ? 'text' : 'password'} name="password2" className="password-input" required />
              <button type="button" className="password-visibility-btn" onClick={() => setShowRetypePassword(prev => !prev)}>
                {showRetypePassword ? 'Hide' : 'Show'}
              </button>
            </div>
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
