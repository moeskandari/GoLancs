import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

/**
 * Profile component – full-screen page shown after a successful sign-in.
 * Displays user information, points dashboard, rewards, and account management.
 *
 * Props:
 *   onBack   – callback to navigate back to the main map view
 *   onLogout – callback after user logs out
 */
function Profile({ onBack, onLogout }) {
  const {
    user, points, transactions, rewards, settings,
    signOut, updateProfile, deleteAccount,
    loadPoints, loadRewards, redeemReward, resendVerification,
    updateSettings, changePassword
  } = useAuth();

  const [activeTab, setActiveTab] = useState('profile'); // 'profile', 'points', 'rewards', 'settings'
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', email: '' });
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [redeemingId, setRedeemingId] = useState(null);
  const [rewardMessage, setRewardMessage] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');

  // Load points and rewards data when those tabs are shown
  useEffect(() => {
    if (activeTab === 'points') {
      loadPoints().catch(() => {});
    } else if (activeTab === 'rewards') {
      loadRewards().catch(() => {});
      loadPoints().catch(() => {});
    }
  }, [activeTab, loadPoints, loadRewards]);

  // Initialise edit form with current user data
  useEffect(() => {
    if (user && editing) {
      setEditForm({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || ''
      });
    }
  }, [user, editing]);

  const handleLogout = useCallback(async () => {
    await signOut();
    if (onLogout) onLogout();
  }, [signOut, onLogout]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setEditError('');
    setEditSuccess('');
    setSaving(true);

    try {
      const updates = {};
      if (editForm.firstName !== user.firstName) updates.firstName = editForm.firstName;
      if (editForm.lastName !== user.lastName) updates.lastName = editForm.lastName;
      if (editForm.email !== user.email) updates.email = editForm.email;

      if (Object.keys(updates).length === 0) {
        setEditing(false);
        setSaving(false);
        return;
      }

      await updateProfile(updates);
      setEditSuccess('Profile updated successfully!');
      setEditing(false);
    } catch (err) {
      setEditError(err.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      if (onLogout) onLogout();
    } catch (err) {
      setEditError(err.message || 'Failed to delete account.');
      setDeleting(false);
    }
  };

  const handleResendVerification = async () => {
    try {
      await resendVerification();
      setVerificationSent(true);
      setTimeout(() => setVerificationSent(false), 5000);
    } catch {
      // Silently handle
    }
  };

  const handleRedeemReward = async (rewardId) => {
    setRedeemingId(rewardId);
    setRewardMessage('');
    try {
      const data = await redeemReward(rewardId);
      setRewardMessage(data.message);
    } catch (err) {
      setRewardMessage(err.message || 'Failed to redeem reward.');
    } finally {
      setRedeemingId(null);
    }
  };

  // Settings handlers – apply immediately, no save button needed
  const handleThemeChange = (theme) => {
    updateSettings({ theme }).catch(() => {});
  };

  const handleFontSizeChange = (fontSize) => {
    updateSettings({ fontSize }).catch(() => {});
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordMessage('');

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    setPasswordSaving(true);
    try {
      const data = await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
        confirmPassword: passwordForm.confirmPassword
      });
      setPasswordMessage(data.message || 'Password changed successfully!');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setPasswordError(err.message || 'Failed to change password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  if (!user) return null;

  const memberSince = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric'
  }) : 'Unknown';

  // Deduplicate rewards by name (or id as fallback) so the user only sees
  // one instance of each reward on the Rewards tab.
  const uniqueRewards = (() => {
    if (!rewards || rewards.length === 0) return [];
    const seen = new Set();
    const out = [];
    for (const r of rewards) {
      const key = (r.name || r.id || JSON.stringify(r)).toString();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(r);
      }
    }
    return out;
  })();

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

      <button
        className="profile-logout-btn"
        onClick={handleLogout}
        aria-label="Log out"
        title="Log out"
      >
        Log out
      </button>

      <div className="profile-content">
        {/* Header */}
        <div className="profile-header">
          <div className="profile-avatar">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#2196F3">
              <circle cx="12" cy="8" r="4" strokeWidth="2" />
              <path d="M4 20c0-4 4-6 8-6s8 2 8 6" strokeWidth="2" />
            </svg>
          </div>
          <h2 className="profile-title">{user.firstName} {user.lastName}</h2>
          <p className="profile-email">{user.email}</p>
          {!user.emailVerified && (
            <div className="profile-verification-banner">
              <span>📧 Email not verified</span>
              <button
                className="auth-link-btn inline"
                onClick={handleResendVerification}
                disabled={verificationSent}
              >
                {verificationSent ? 'Sent!' : 'Resend verification'}
              </button>
            </div>
          )}
          <div className="profile-points-badge">
            <span className="points-icon">⭐</span>
            <span className="points-value">{points}</span>
            <span className="points-label">points</span>
          </div>
          <p className="profile-member-since">Member since {memberSince}</p>
        </div>

        {/* Tab navigation */}
        <div className="profile-tabs" role="tablist">
          <button
            className={`profile-tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
            role="tab"
            aria-selected={activeTab === 'profile'}
          >
            👤 Profile
          </button>
          <button
            className={`profile-tab ${activeTab === 'points' ? 'active' : ''}`}
            onClick={() => setActiveTab('points')}
            role="tab"
            aria-selected={activeTab === 'points'}
          >
            ⭐ Points
          </button>
          <button
            className={`profile-tab ${activeTab === 'rewards' ? 'active' : ''}`}
            onClick={() => setActiveTab('rewards')}
            role="tab"
            aria-selected={activeTab === 'rewards'}
          >
            🎁 Rewards
          </button>
          <button
            className={`profile-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            role="tab"
            aria-selected={activeTab === 'settings'}
          >
            ⚙️ Settings
          </button>
        </div>

        {/* Tab content */}
        <div className="profile-tab-content" role="tabpanel">

          {/* ─── Profile tab ─── */}
          {activeTab === 'profile' && (
            <div className="profile-section">
              {editSuccess && (
                <div className="auth-success-inline" role="status">{editSuccess}</div>
              )}
              {editError && (
                <div className="auth-error" role="alert">
                  <span className="auth-error-icon">⚠️</span> {editError}
                </div>
              )}

              {editing ? (
                <form className="auth-form profile-edit-form" onSubmit={handleSaveProfile}>
                  <label className="auth-label" htmlFor="edit-firstname">First name</label>
                  <input
                    id="edit-firstname"
                    className="auth-input"
                    type="text"
                    value={editForm.firstName}
                    onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                    required
                    disabled={saving}
                  />

                  <label className="auth-label" htmlFor="edit-lastname">Last name</label>
                  <input
                    id="edit-lastname"
                    className="auth-input"
                    type="text"
                    value={editForm.lastName}
                    onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                    required
                    disabled={saving}
                  />

                  <label className="auth-label" htmlFor="edit-email">Email</label>
                  <input
                    id="edit-email"
                    className="auth-input"
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    required
                    disabled={saving}
                  />

                  <div className="profile-edit-actions">
                    <button type="submit" className="auth-submit-btn" disabled={saving}>
                      {saving ? '⏳ Saving...' : 'Save Changes'}
                    </button>
                    <button
                      type="button"
                      className="auth-link-btn"
                      onClick={() => { setEditing(false); setEditError(''); }}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="profile-info-list">
                  <div className="profile-info-item">
                    <span className="profile-info-label">First name</span>
                    <span className="profile-info-value">{user.firstName}</span>
                  </div>
                  <div className="profile-info-item">
                    <span className="profile-info-label">Last name</span>
                    <span className="profile-info-value">{user.lastName}</span>
                  </div>
                  <div className="profile-info-item">
                    <span className="profile-info-label">Email</span>
                    <span className="profile-info-value">
                      {user.email}
                      {user.emailVerified
                        ? <span className="verified-badge" title="Verified"> ✅</span>
                        : <span className="unverified-badge" title="Not verified"> ⚠️</span>
                      }
                    </span>
                  </div>
                  <button
                    className="auth-submit-btn"
                    onClick={() => { setEditing(true); setEditSuccess(''); }}
                  >
                    Edit Profile
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ─── Points tab ─── */}
          {activeTab === 'points' && (
            <div className="profile-section">
              <div className="points-summary">
                <div className="points-total">
                  <span className="points-total-value">{points}</span>
                  <span className="points-total-label">Total Points</span>
                </div>
              </div>

              <h3 className="profile-section-title">Activity History</h3>
              {transactions.length === 0 ? (
                <p className="profile-placeholder-text">No activity yet. Start travelling to earn points!</p>
              ) : (
                <div className="transactions-list">
                  {transactions.map(tx => (
                    <div key={tx.id} className={`transaction-item ${tx.points > 0 ? 'earned' : 'spent'}`}>
                      <div className="transaction-info">
                        <span className="transaction-desc">{tx.description}</span>
                        <span className="transaction-date">
                          {new Date(tx.createdAt).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric'
                          })}
                        </span>
                      </div>
                      <span className={`transaction-points ${tx.points > 0 ? 'positive' : 'negative'}`}>
                        {tx.points > 0 ? '+' : ''}{tx.points}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── Rewards tab ─── */}
          {activeTab === 'rewards' && (
            <div className="profile-section">
              <div className="points-summary">
                <div className="points-total">
                  <span className="points-total-value">{points}</span>
                  <span className="points-total-label">Available Points</span>
                </div>
              </div>

              {rewardMessage && (
                <div className="auth-success-inline" role="status">{rewardMessage}</div>
              )}

              <h3 className="profile-section-title">Available Rewards</h3>
              {uniqueRewards.length === 0 ? (
                <p className="profile-placeholder-text">No rewards available at the moment.</p>
              ) : (
                <div className="rewards-list">
                  {uniqueRewards.map(reward => (
                    <div key={reward.id} className="reward-card">
                      <div className="reward-info">
                        <h4 className="reward-name">{reward.name}</h4>
                        <p className="reward-desc">{reward.description}</p>
                        <span className="reward-cost">{reward.points_cost} points</span>
                      </div>
                      <button
                        className="reward-redeem-btn"
                        onClick={() => handleRedeemReward(reward.id)}
                        disabled={points < reward.points_cost || redeemingId === reward.id}
                      >
                        {redeemingId === reward.id
                          ? '⏳'
                          : points < reward.points_cost
                            ? '🔒 Not enough'
                            : '🎁 Redeem'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── Settings tab ─── */}
          {activeTab === 'settings' && (
            <div className="profile-section">

              {/* Appearance */}
              <div className="settings-section">
                <h4 className="settings-section-title">🌗 Appearance</h4>
                <div className="settings-toggle-row">
                  <span className="settings-toggle-label">
                    {settings.theme === 'dark' ? '🌙 Dark mode' : '☀️ Light mode'}
                  </span>
                  <label className="toggle-switch" aria-label="Toggle dark mode">
                    <input
                      type="checkbox"
                      checked={settings.theme === 'dark'}
                      onChange={(e) => handleThemeChange(e.target.checked ? 'dark' : 'light')}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>

              {/* Text size */}
              <div className="settings-section">
                <h4 className="settings-section-title">🔤 Text Size</h4>
                <div className="settings-radio-group" role="radiogroup" aria-label="Font size">
                  {[['small', 'A', 'Small'], ['medium', 'Aa', 'Medium'], ['large', 'AA', 'Large']].map(
                    ([value, preview, label]) => (
                      <label key={value} className="settings-radio-option">
                        <input
                          type="radio"
                          name="fontSize"
                          value={value}
                          checked={settings.fontSize === value}
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

              {/* Change password */}
              <div className="settings-section">
                <h4 className="settings-section-title">🔑 Change Password</h4>
                {passwordMessage && (
                  <div className="auth-success-inline" role="status">{passwordMessage}</div>
                )}
                {passwordError && (
                  <div className="auth-error" role="alert">
                    <span className="auth-error-icon">⚠️</span> {passwordError}
                  </div>
                )}
                <form className="auth-form" onSubmit={handlePasswordChange}>
                  <label className="auth-label" htmlFor="current-password">Current password</label>
                  <input
                    id="current-password"
                    className="auth-input"
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                    required
                    disabled={passwordSaving}
                    autoComplete="current-password"
                  />

                  <label className="auth-label" htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    className="auth-input"
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    required
                    disabled={passwordSaving}
                    autoComplete="new-password"
                  />

                  <label className="auth-label" htmlFor="confirm-password">Confirm new password</label>
                  <input
                    id="confirm-password"
                    className="auth-input"
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                    required
                    disabled={passwordSaving}
                    autoComplete="new-password"
                  />

                  <button type="submit" className="auth-submit-btn" disabled={passwordSaving}>
                    {passwordSaving ? '⏳ Changing...' : 'Change Password'}
                  </button>
                </form>
              </div>

              {/* Danger zone */}
              <div className="settings-danger-zone">
                <h4 className="danger-title">⚠️ Danger Zone</h4>
                <p className="danger-desc">
                  Deleting your account is permanent. All your data, points, and activity history will be removed.
                </p>

                {deleteConfirm ? (
                  <div className="delete-confirm">
                    <p className="delete-confirm-text">
                      Are you sure? This action <strong>cannot be undone</strong>.
                    </p>
                    <div className="delete-confirm-actions">
                      <button
                        className="delete-confirm-btn"
                        onClick={handleDeleteAccount}
                        disabled={deleting}
                      >
                        {deleting ? '⏳ Deleting...' : 'Yes, delete my account'}
                      </button>
                      <button
                        className="auth-link-btn"
                        onClick={() => setDeleteConfirm(false)}
                        disabled={deleting}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="delete-account-btn"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    Delete Account
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Profile;
