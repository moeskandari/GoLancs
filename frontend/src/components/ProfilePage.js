import React from 'react';
import './Overlay.css';

function ProfilePage({ onBack }) {
  return (
    <div className="overlay-backdrop">
      <div className="overlay-card profile-card">
        <button className="overlay-back" onClick={onBack}>← Back</button>
        <h2 className="overlay-title">Profile</h2>
        <div className="profile-content">
          <p>This is a placeholder profile page (frontend-only).</p>
          <p>Further profile features will be implemented later.</p>
        </div>
      </div>
    </div>
  );
}

export default ProfilePage;
