import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

/**
 * SignIn component – renders as a centered overlay on top of the existing map.
 *
 * Props:
 *   onClose            – callback to dismiss the overlay and return to the map
 *   onSignIn           – callback fired on successful sign-in (receives user data)
 *   onSwitchToSignUp   – callback to navigate to the Sign Up overlay
 *   onForgotPassword   – callback to navigate to the Forgot Password overlay
 */
function SignIn({ onClose, onSignIn, onSwitchToSignUp, onForgotPassword, onShowTerms }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors([]);
    setSubmitting(true);

    try {
      const data = await signIn({ email, password });
      if (onSignIn) onSignIn(data.user);
    } catch (err) {
      if (err.data?.details) {
        setFieldErrors(err.data.details);
      } else {
        setError(err.message || 'Sign-in failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Sign In">
      <div className="auth-backdrop" onClick={onClose} />

      <div className="auth-card">
        <button
          className="auth-close-btn"
          onClick={onClose}
          aria-label="Close sign in"
          title="Close"
        >
          ✕
        </button>

        <h2 className="auth-title">Sign in</h2>

        {error && (
          <div className="auth-error" role="alert">
            <span className="auth-error-icon">⚠️</span> {error}
          </div>
        )}

        {fieldErrors.length > 0 && (
          <div className="auth-error" role="alert">
            {fieldErrors.map((fe, i) => (
              <div key={i}><span className="auth-error-icon">⚠️</span> {fe.message}</div>
            ))}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
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
            disabled={submitting}
          />

          <label className="auth-label" htmlFor="signin-password">Password</label>
          <div className="password-field-group">
            <input
              id="signin-password"
              className="auth-input password-input"
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={submitting}
            />
            <button
              type="button"
              className="password-visibility-btn"
              onClick={() => setShowPassword(prev => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>

          <button type="submit" className="auth-submit-btn" disabled={submitting}>
            {submitting ? '⏳ Signing in...' : 'Sign in'}
          </button>
        </form>

        <button
          className="auth-link-btn"
          onClick={onForgotPassword}
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
        <p style={{marginTop: 8}}>
          <button className="auth-link-btn inline" onClick={() => onShowTerms?.()} type="button">Terms</button>
        </p>
      </div>
    </div>
  );
}

export default SignIn;
