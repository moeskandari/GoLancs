/**
 * AuthContext – provides authentication state and actions throughout the app.
 * Manages sign-in/sign-up/sign-out, session persistence, profile data,
 * and points/rewards.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

/** Default settings applied when no user is logged in. */
const DEFAULT_SETTINGS = { theme: 'light', fontSize: 'medium' };

/**
 * Writes theme and fontSize attributes to the <html> element so that
 * CSS selectors like html[data-theme="dark"] and html[data-font-size="large"]
 * take effect immediately across the whole app.
 */
function applySettingsToDocument(settings) {
  const s = settings || DEFAULT_SETTINGS;
  document.documentElement.setAttribute('data-theme', s.theme || 'light');
  document.documentElement.setAttribute('data-font-size', s.fontSize || 'medium');
}

/**
 * Helper for fetch calls with credentials (cookies).
 */
async function authFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  // Check if user has an active session on mount
  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      try {
        const data = await authFetch(`${API_URL}/api/auth/me`);
        if (!cancelled) {
          setUser(data.user);
          setPoints(data.user.points || 0);
          // Load and apply this user's saved settings
          try {
            const settingsData = await authFetch(`${API_URL}/api/auth/settings`);
            if (!cancelled) {
              setSettings(settingsData);
              applySettingsToDocument(settingsData);
            }
          } catch {
            if (!cancelled) applySettingsToDocument(DEFAULT_SETTINGS);
          }
        }
      } catch {
        // No session – that's fine
        if (!cancelled) {
          setUser(null);
          applySettingsToDocument(DEFAULT_SETTINGS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    checkSession();
    return () => { cancelled = true; };
  }, []);

  /**
   * Sign up a new user.
   */
  const signUp = useCallback(async ({ firstName, lastName, email, password, retypePassword }) => {
    const data = await authFetch(`${API_URL}/api/auth/signup`, {
      method: 'POST',
      body: JSON.stringify({ firstName, lastName, email, password, retypePassword })
    });
    setUser(data.user);
    setPoints(data.user.points || 0);
    // Load and apply default settings created during signup
    try {
      const settingsData = await authFetch(`${API_URL}/api/auth/settings`);
      setSettings(settingsData);
      applySettingsToDocument(settingsData);
    } catch {
      applySettingsToDocument(DEFAULT_SETTINGS);
    }
    return data;
  }, []);

  /**
   * Sign in an existing user.
   */
  const signIn = useCallback(async ({ email, password }) => {
    const data = await authFetch(`${API_URL}/api/auth/signin`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setUser(data.user);
    setPoints(data.user.points || 0);
    // Load and apply this user's saved settings
    try {
      const settingsData = await authFetch(`${API_URL}/api/auth/settings`);
      setSettings(settingsData);
      applySettingsToDocument(settingsData);
    } catch {
      applySettingsToDocument(DEFAULT_SETTINGS);
    }
    return data;
  }, []);

  /**
   * Sign out.
   */
  const signOut = useCallback(async () => {
    try {
      await authFetch(`${API_URL}/api/auth/logout`, { method: 'POST' });
    } catch {
      // Even if the request fails, clear local state
    }
    setUser(null);
    setPoints(0);
    setTransactions([]);
    setRewards([]);
    setSettings(DEFAULT_SETTINGS);
    applySettingsToDocument(DEFAULT_SETTINGS);
  }, []);

  /**
   * Update profile.
   */
  const updateProfile = useCallback(async (updates) => {
    const data = await authFetch(`${API_URL}/api/auth/profile`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    setUser(data.user);
    return data;
  }, []);

  /**
   * Delete account.
   */
  const deleteAccount = useCallback(async () => {
    const data = await authFetch(`${API_URL}/api/auth/account`, {
      method: 'DELETE'
    });
    setUser(null);
    setPoints(0);
    setTransactions([]);
    return data;
  }, []);

  /**
   * Verify email with token.
   */
  const verifyEmail = useCallback(async (token) => {
    const data = await authFetch(`${API_URL}/api/auth/verify-email`, {
      method: 'POST',
      body: JSON.stringify({ token })
    });
    // Refresh user data
    try {
      const me = await authFetch(`${API_URL}/api/auth/me`);
      setUser(me.user);
    } catch { /* ignore */ }
    return data;
  }, []);

  /**
   * Resend verification email.
   */
  const resendVerification = useCallback(async () => {
    return authFetch(`${API_URL}/api/auth/resend-verification`, {
      method: 'POST'
    });
  }, []);

  /**
   * Request password reset.
   */
  const forgotPassword = useCallback(async (email) => {
    return authFetch(`${API_URL}/api/auth/forgot-password`, {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  }, []);

  /**
   * Reset password with token.
   */
  const resetPassword = useCallback(async (token, password) => {
    return authFetch(`${API_URL}/api/auth/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ token, password })
    });
  }, []);

  /**
   * Load points and transaction history.
   */
  const loadPoints = useCallback(async () => {
    const data = await authFetch(`${API_URL}/api/auth/points`);
    setPoints(data.points);
    setTransactions(data.transactions);
    return data;
  }, []);

  /**
   * Load available rewards.
   */
  const loadRewards = useCallback(async () => {
    const data = await authFetch(`${API_URL}/api/auth/rewards`);
    setRewards(data.rewards);
    return data;
  }, []);

  /**
   * Redeem a reward.
   */
  const redeemReward = useCallback(async (rewardId) => {
    const data = await authFetch(`${API_URL}/api/auth/rewards/redeem`, {
      method: 'POST',
      body: JSON.stringify({ rewardId })
    });
    setPoints(data.totalPoints);
    // Refresh transactions
    loadPoints().catch(() => {});
    return data;
  }, [loadPoints]);

  /**
   * Earn points for an action.
   */
  const earnPoints = useCallback(async (type, description, pointsAmount) => {
    const data = await authFetch(`${API_URL}/api/auth/points/earn`, {
      method: 'POST',
      body: JSON.stringify({ type, description, points: pointsAmount })
    });
    setPoints(data.totalPoints);
    return data;
  }, []);

  /**
   * Fetch the current user's settings from the server and apply them.
   */
  const loadSettings = useCallback(async () => {
    const data = await authFetch(`${API_URL}/api/auth/settings`);
    setSettings(data);
    applySettingsToDocument(data);
    return data;
  }, []);

  /**
   * Update one or more settings fields.
   * Applies changes IMMEDIATELY to the document before the network request
   * so the UI reacts without any perceptible delay.
   */
  const updateSettings = useCallback(async (updates) => {
    // Apply to UI immediately (optimistic update)
    setSettings(prev => {
      const next = { ...prev, ...updates };
      applySettingsToDocument(next);
      return next;
    });
    // Persist to backend
    const data = await authFetch(`${API_URL}/api/auth/settings`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    // Sync with server's authoritative response
    setSettings(data);
    applySettingsToDocument(data);
    return data;
  }, []);

  /**
   * Change the user's password while logged in.
   */
  const changePassword = useCallback(async ({ currentPassword, newPassword, confirmPassword }) => {
    return authFetch(`${API_URL}/api/auth/change-password`, {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
    });
  }, []);

  const value = {
    user,
    loading,
    isLoggedIn: !!user,
    points,
    transactions,
    rewards,
    settings,
    signUp,
    signIn,
    signOut,
    updateProfile,
    deleteAccount,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    loadPoints,
    loadRewards,
    redeemReward,
    earnPoints,
    loadSettings,
    updateSettings,
    changePassword
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
