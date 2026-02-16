import React from 'react';
import './BottomControls.css';

function BottomControls() {
  return (
    <div className="bottom-controls">
      <button className="control-btn" title="Filter Options">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <line x1="4" y1="6" x2="20" y2="6" strokeWidth="2"/>
          <line x1="4" y1="12" x2="20" y2="12" strokeWidth="2"/>
          <line x1="4" y1="18" x2="20" y2="18" strokeWidth="2"/>
          <circle cx="7" cy="6" r="2" fill="white" strokeWidth="2"/>
          <circle cx="14" cy="12" r="2" fill="white" strokeWidth="2"/>
          <circle cx="17" cy="18" r="2" fill="white" strokeWidth="2"/>
        </svg>
        <span>Filter</span>
      </button>
      
      <button className="control-btn" title="Center on My Location">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="3" strokeWidth="2"/>
          <line x1="12" y1="2" x2="12" y2="6" strokeWidth="2"/>
          <line x1="12" y1="18" x2="12" y2="22" strokeWidth="2"/>
          <line x1="2" y1="12" x2="6" y2="12" strokeWidth="2"/>
          <line x1="18" y1="12" x2="22" y2="12" strokeWidth="2"/>
        </svg>
        <span>My Location</span>
      </button>
      
      <button className="control-btn" title="Account">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="8" r="4" strokeWidth="2"/>
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" strokeWidth="2"/>
        </svg>
        <span>Account</span>
      </button>
    </div>
  );
}

export default BottomControls;
