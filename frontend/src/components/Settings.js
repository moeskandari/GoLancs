import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Overlay.css';
import './Auth.css';

/**
 * Settings component – accessible from the main page without login.
 * Allows users to change theme (dark/light mode) and text size.
 * These settings are applied immediately to the UI.
 *
 * Props:
 *   onBack – callback to close the settings overlay
 */
function Settings({ onBack }) {
  const { settings, updateSettings } = useAuth();
  const [error, setError] = useState('');

  const handleThemeChange = async (theme) => {
    setError('');
    try {
      await updateSettings({ theme });
    } catch (err) {
      setError(err.message || 'Failed to update theme');
    }
  };

  const handleFontSizeChange = async (fontSize) => {
    setError('');
    try {
      await updateSettings({ fontSize });
    } catch (err) {
      setError(err.message || 'Failed to update font size');
    }
  };

  return (
    <div className="overlay-backdrop">
      <div className="overlay-card settings-card">
        <button className="overlay-back" onClick={onBack} aria-label="Back">
          ← Back
        </button>

        <h2 className="overlay-title">⚙️ Settings</h2>

        <div className="settings-content">
          {error && (
            <div className="auth-error" role="alert">
              <span className="auth-error-icon">⚠️</span> {error}
            </div>
          )}

          {/* Appearance section */}
          <div className="settings-section">
            <h3 className="settings-section-title">🌗 Appearance</h3>
            <div className="settings-toggle-row">
              <span className="settings-toggle-label">
                {settings?.theme === 'dark' ? '🌙 Dark mode' : '☀️ Light mode'}
              </span>
              <label className="toggle-switch" aria-label="Toggle dark mode">
                <input
                  type="checkbox"
                  checked={settings?.theme === 'dark'}
                  onChange={(e) => handleThemeChange(e.target.checked ? 'dark' : 'light')}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          {/* Text Size section */}
          <div className="settings-section">
            <h3 className="settings-section-title">🔤 Text Size</h3>
            <div className="settings-radio-group" role="radiogroup" aria-label="Font size">
              {[['small', 'A', 'Small'], ['medium', 'Aa', 'Medium'], ['large', 'AA', 'Large']].map(
                ([value, preview, label]) => (
                  <label key={value} className="settings-radio-option">
                    <input
                      type="radio"
                      name="fontSize"
                      value={value}
                      checked={settings?.fontSize === value}
                      onChange={() => handleFontSizeChange(value)}
                    />
                    <span className="settings-radio-label">
                      <span className={`font-preview font-preview-${value}`}>{preview}</span>
                      <span className="font-label">{label}</span>
                    </span>
                  </label>
                )
              )}
            </div>
          </div>

          {/* Info */}
          <div className="settings-info">
            <p>
              Settings persist locally and sync across devices if you create an account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
