import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

/**
 * ResetPassword component – allows users to set a new password using a reset token.
 *
 * Props:
 *   token            – the reset token from the URL
 *   onClose          – dismiss the overlay
 *   onSwitchToSignIn – navigate to sign-in after successful reset
 */
function ResetPassword({ token, onClose, onSwitchToSignIn }) {
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const passwordChecks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
  };

  const passwordStrong = Object.values(passwordChecks).every(Boolean);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors([]);

    if (!passwordStrong) {
      setError('Please ensure your password meets all requirements.');
      return;
    }
    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);

    try {
      await resetPassword(token, password);
      setSuccess(true);
    } catch (err) {
      if (err.data?.details) {
        setFieldErrors(err.data.details);
      } else {
        setError(err.message || 'Failed to reset password. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Reset Password">
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

        <h2 className="auth-title">Set New Password</h2>

        {success ? (
          <div className="auth-success-message">
            <div className="auth-success-icon">✅</div>
            <p>Your password has been reset successfully!</p>
            <button
              className="auth-submit-btn"
              onClick={onSwitchToSignIn}
              type="button"
            >
              Sign In
            </button>
          </div>
        ) : (
          <>
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
              <label className="auth-label" htmlFor="reset-password">New Password</label>
              <input
                id="reset-password"
                className="auth-input"
                type="password"
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={submitting}
              />

              {password.length > 0 && (
                <div className="password-requirements" aria-live="polite">
                  <div className={`pw-check ${passwordChecks.length ? 'pass' : 'fail'}`}>
                    {passwordChecks.length ? '✓' : '✗'} At least 8 characters
                  </div>
                  <div className={`pw-check ${passwordChecks.uppercase ? 'pass' : 'fail'}`}>
                    {passwordChecks.uppercase ? '✓' : '✗'} One uppercase letter
                  </div>
                  <div className={`pw-check ${passwordChecks.lowercase ? 'pass' : 'fail'}`}>
                    {passwordChecks.lowercase ? '✓' : '✗'} One lowercase letter
                  </div>
                  <div className={`pw-check ${passwordChecks.number ? 'pass' : 'fail'}`}>
                    {passwordChecks.number ? '✓' : '✗'} One number
                  </div>
                  <div className={`pw-check ${passwordChecks.special ? 'pass' : 'fail'}`}>
                    {passwordChecks.special ? '✓' : '✗'} One special character
                  </div>
                </div>
              )}

              <label className="auth-label" htmlFor="reset-confirm-password">Confirm Password</label>
              <input
                id="reset-confirm-password"
                className="auth-input"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={submitting}
              />

              {confirmPassword.length > 0 && (
                <div className={`pw-check ${passwordsMatch ? 'pass' : 'fail'}`}>
                  {passwordsMatch ? '✓ Passwords match' : '✗ Passwords do not match'}
                </div>
              )}

              <button
                type="submit"
                className="auth-submit-btn"
                disabled={submitting || !passwordStrong || !passwordsMatch}
              >
                {submitting ? '⏳ Resetting...' : 'Reset Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default ResetPassword;
