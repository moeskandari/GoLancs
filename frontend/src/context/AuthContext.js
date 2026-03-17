/**
 * AuthContext – provides authentication state and actions throughout the app.
 * Manages sign-in/sign-up/sign-out, session persistence, profile data,
 * and points/rewards.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

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

  // Check if user has an active session on mount
  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      try {
        const data = await authFetch(`${API_URL}/api/auth/me`);
        if (!cancelled) {
          setUser(data.user);
          setPoints(data.user.points || 0);
        }
      } catch {
        // No session – that's fine
        if (!cancelled) setUser(null);
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

  const value = {
    user,
    loading,
    isLoggedIn: !!user,
    points,
    transactions,
    rewards,
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
    earnPoints
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
