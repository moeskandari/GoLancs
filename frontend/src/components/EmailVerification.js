import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

/**
 * EmailVerification component – verifies the user's email when they click
 * the verification link. Shows progress and result.
 *
 * Props:
 *   token   – the verification token from the URL
 *   onClose – dismiss the overlay
 */
function EmailVerification({ token, onClose }) {
  const { verifyEmail } = useAuth();
  const [status, setStatus] = useState('verifying'); // 'verifying', 'success', 'error'
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      try {
        const data = await verifyEmail(token);
        if (!cancelled) {
          setStatus('success');
          setMessage(data.message);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setMessage(err.message || 'Verification failed.');
        }
      }
    };

    verify();
    return () => { cancelled = true; };
  }, [token, verifyEmail]);

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="Email Verification">
      <div className="auth-backdrop" onClick={onClose} />

      <div className="auth-card" style={{ textAlign: 'center' }}>
        <button
          className="auth-close-btn"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>

        <h2 className="auth-title">Email Verification</h2>

        {status === 'verifying' && (
          <div className="auth-success-message">
            <div className="auth-loading-spinner">⏳</div>
            <p>Verifying your email address...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="auth-success-message">
            <div className="auth-success-icon">✅</div>
            <p>{message}</p>
            <button className="auth-submit-btn" onClick={onClose} type="button">
              Continue
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="auth-success-message">
            <div className="auth-success-icon">❌</div>
            <p className="auth-error-text">{message}</p>
            <button className="auth-submit-btn" onClick={onClose} type="button">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default EmailVerification;
