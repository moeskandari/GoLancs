import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

/**
 * ForgotPassword component – allows users to request a password reset email.
 *
 * Props:
 *   onClose          – dismiss the overlay
 *   onSwitchToSignIn – navigate back to sign-in
 */
function ForgotPassword({ onClose, onSwitchToSignIn }) {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Forgot Password">
      <div className="auth-backdrop" onClick={onClose} />

      <div className="auth-card">
        <button
          className="auth-close-btn"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>

        <h2 className="auth-title">Reset Password</h2>

        {sent ? (
          <div className="auth-success-message">
            <div className="auth-success-icon">✉️</div>
            <p>If an account exists with <strong>{email}</strong>, we've sent a password reset link.</p>
            <p className="auth-hint">Please check your inbox (and spam folder).</p>
            <button
              className="auth-submit-btn"
              onClick={onSwitchToSignIn}
              type="button"
            >
              Back to Sign In
            </button>
          </div>
        ) : (
          <>
            <p className="auth-description">
              Enter your email address and we'll send you a link to reset your password.
            </p>

            {error && (
              <div className="auth-error" role="alert">
                <span className="auth-error-icon">⚠️</span> {error}
              </div>
            )}

            <form className="auth-form" onSubmit={handleSubmit} noValidate>
              <label className="auth-label" htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                className="auth-input"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={submitting}
                autoFocus
              />

              <button type="submit" className="auth-submit-btn" disabled={submitting || !email}>
                {submitting ? '⏳ Sending...' : 'Send Reset Link'}
              </button>
            </form>

            <p className="auth-switch-text">
              Remember your password?{' '}
              <button
                className="auth-link-btn inline"
                onClick={onSwitchToSignIn}
                type="button"
              >
                Sign in
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default ForgotPassword;
