import React, { useState } from 'react';
import './Overlay.css';

function SignInOverlay({ onClose, onSwitchToSignUp, onSignIn }) {
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Frontend-only: do nothing here; call onSignIn to progress to profile placeholder
    onSignIn && onSignIn();
  };

  return (
    <div className="overlay-backdrop">
      <div className="overlay-card">
        <button className="overlay-close" onClick={onClose}>×</button>
        <h2 className="overlay-title">Sign In</h2>
        <form className="overlay-form" onSubmit={handleSubmit}>
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
          <button type="submit" className="primary-btn">Sign In</button>
          <button type="button" className="link-btn">Forgot Password?</button>
        </form>
        <div className="overlay-footer">
          <span>Don't Have an Account? </span>
          <button className="link-btn" onClick={() => onSwitchToSignUp && onSwitchToSignUp()}>Create Account</button>
        </div>
      </div>
    </div>
  );
}

export default SignInOverlay;
