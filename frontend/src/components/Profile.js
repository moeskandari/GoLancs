import React from 'react';
import './Auth.css';

/**
 * Profile component – basic placeholder page shown after a successful sign-in.
 *
 * Props:
 *   onBack – callback to navigate back to the main landing page (map view)
 */
function Profile({ onBack }) {
  return (
    <div className="profile-page" role="main" aria-label="Profile">
      <button
        className="profile-back-btn"
        onClick={onBack}
        aria-label="Back to map"
        title="Back"
      >
        ← Back
      </button>

      <div className="profile-content">
        <div className="profile-avatar">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#2196F3">
            <circle cx="12" cy="8" r="4" strokeWidth="2" />
            <path d="M4 20c0-4 4-6 8-6s8 2 8 6" strokeWidth="2" />
          </svg>
        </div>
        <h2 className="profile-title">My Profile</h2>
        <p className="profile-placeholder-text">
          Profile details will appear here once the backend is connected.
        </p>
      </div>
    </div>
  );
}

export default Profile;
