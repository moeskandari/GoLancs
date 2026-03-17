import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

/**
 * SignUp component – renders as a centered overlay on top of the existing map.
 *
 * Props:
 *   onClose            – callback to dismiss the overlay and return to the map
 *   onCreateAccount    – callback fired on successful sign-up (receives user data)
 *   onSwitchToSignIn   – callback to navigate to the Sign In overlay
 */
function SignUp({ onClose, onCreateAccount, onSwitchToSignIn }) {
  const { signUp } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [retypePassword, setRetypePassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // Client-side password strength indicators
  const passwordChecks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password)
  };

  const passwordStrong = Object.values(passwordChecks).every(Boolean);
  const passwordsMatch = password === retypePassword && retypePassword.length > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors([]);

    // Client-side validation
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
      const data = await signUp({ firstName, lastName, email, password, retypePassword });
      if (onCreateAccount) onCreateAccount(data.user);
    } catch (err) {
      if (err.data?.redirect === 'signin') {
        setError(err.message);
        // Auto-redirect to sign-in after 3 seconds
        setTimeout(() => {
          if (onSwitchToSignIn) onSwitchToSignIn();
        }, 3000);
      } else if (err.data?.details) {
        setFieldErrors(err.data.details);
      } else {
        setError(err.message || 'Sign-up failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Sign Up">
      <div className="auth-backdrop" onClick={onClose} />

      <div className="auth-card">
        <button
          className="auth-close-btn"
          onClick={onClose}
          aria-label="Close sign up"
          title="Close"
        >
          ✕
        </button>

        <h2 className="auth-title">Sign up</h2>

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
            disabled={submitting}
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
            disabled={submitting}
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
            disabled={submitting}
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
            disabled={submitting}
          />

          {/* Password strength indicator */}
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
            disabled={submitting}
          />

          {retypePassword.length > 0 && (
            <div className={`pw-check ${passwordsMatch ? 'pass' : 'fail'}`}>
              {passwordsMatch ? '✓ Passwords match' : '✗ Passwords do not match'}
            </div>
          )}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={submitting || !passwordStrong || !passwordsMatch}
          >
            {submitting ? '⏳ Creating account...' : 'Create your account'}
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
