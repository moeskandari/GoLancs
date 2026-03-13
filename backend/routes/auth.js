/**
 * Authentication routes – handles sign-up, sign-in, sign-out, email verification,
 * password reset, profile management, account deletion, and the points system.
 *
 * All routes are prefixed with /api/auth when mounted in server.js.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const {
  signUpValidation,
  signInValidation,
  profileUpdateValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  changePasswordValidation,
  settingsValidation
} = require('../middleware/validation');
const { sanitiseInput, createRateLimiter } = require('../middleware/security');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/email');

const SALT_ROUNDS = 12;
const SIGNUP_BONUS_POINTS = 50;

/**
 * Factory: creates all auth routes with the given pg Pool.
 */
function createAuthRoutes(pool) {
  // Rate limiters
  const authLimiter = createRateLimiter(15 * 60 * 1000, 20);   // 20 req / 15 min
  const resetLimiter = createRateLimiter(60 * 60 * 1000, 5);    // 5 req / 1 hour

  // ─── POST /api/auth/signup ─────────────────────────────────────
  router.post('/signup', authLimiter, sanitiseInput, signUpValidation, async (req, res) => {
    try {
      const { firstName, lastName, email, password } = req.body;

      // Check if email already registered
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: 'An account with this email address already exists. Please sign in instead.',
          redirect: 'signin'
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Create user
      const result = await pool.query(
        `INSERT INTO users (first_name, last_name, email, password_hash, points)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, first_name, last_name, email, email_verified, points, created_at`,
        [firstName, lastName, email, passwordHash, SIGNUP_BONUS_POINTS]
      );

      const user = result.rows[0];

      // Create sign-up bonus transaction
      await pool.query(
        `INSERT INTO point_transactions (user_id, points, type, description)
         VALUES ($1, $2, 'signup_bonus', 'Welcome bonus for creating an account')`,
        [user.id, SIGNUP_BONUS_POINTS]
      );

      // Create default user settings row
      await pool.query(
        `INSERT INTO user_settings (user_id, theme, font_size)
         VALUES ($1, 'light', 'medium')
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id]
      );

      // Generate email verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO email_verification_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [user.id, verificationToken]
      );

      // Send verification email (non-blocking)
      sendVerificationEmail(email, verificationToken, firstName).catch(err => {
        console.error('Failed to send verification email:', err);
      });

      // Create session (auto-login after sign-up)
      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.firstName = user.first_name;
      req.session.lastName = user.last_name;

      res.status(201).json({
        message: 'Account created successfully! Please check your email to verify your address.',
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          emailVerified: user.email_verified,
          points: user.points,
          createdAt: user.created_at
        }
      });
    } catch (err) {
      console.error('Sign-up error:', err);
      res.status(500).json({ error: 'An error occurred during sign-up. Please try again.' });
    }
  });

  // ─── POST /api/auth/signin ─────────────────────────────────────
  router.post('/signin', authLimiter, sanitiseInput, signInValidation, async (req, res) => {
    try {
      const { email, password } = req.body;

      // Find user
      const result = await pool.query(
        'SELECT id, first_name, last_name, email, password_hash, email_verified, points, created_at FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const user = result.rows[0];

      // Verify password
      const passwordValid = await bcrypt.compare(password, user.password_hash);
      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      // Create session
      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.firstName = user.first_name;
      req.session.lastName = user.last_name;

      res.json({
        message: 'Signed in successfully.',
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          emailVerified: user.email_verified,
          points: user.points,
          createdAt: user.created_at
        }
      });
    } catch (err) {
      console.error('Sign-in error:', err);
      res.status(500).json({ error: 'An error occurred during sign-in. Please try again.' });
    }
  });

  // ─── POST /api/auth/logout ─────────────────────────────────────
  router.post('/logout', (req, res) => {
    req.session.destroy(err => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Failed to log out.' });
      }
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out successfully.' });
    });
  });

  // ─── GET /api/auth/me ─────────────────────────────────────────
  router.get('/me', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, first_name, last_name, email, email_verified, points, created_at FROM users WHERE id = $1',
        [req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const user = result.rows[0];
      res.json({
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          emailVerified: user.email_verified,
          points: user.points,
          createdAt: user.created_at
        }
      });
    } catch (err) {
      console.error('Get profile error:', err);
      res.status(500).json({ error: 'Failed to load profile.' });
    }
  });

  // ─── PUT /api/auth/profile ────────────────────────────────────
  router.put('/profile', requireAuth, sanitiseInput, profileUpdateValidation, async (req, res) => {
    try {
      const { firstName, lastName, email } = req.body;
      const userId = req.user.id;

      // If email is changing, check it's not taken
      if (email && email !== req.user.email) {
        const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, userId]);
        if (existing.rows.length > 0) {
          return res.status(409).json({ error: 'This email address is already in use.' });
        }
      }

      // Build dynamic update query
      const updates = [];
      const values = [];
      let paramIdx = 1;

      if (firstName) {
        updates.push(`first_name = $${paramIdx++}`);
        values.push(firstName);
      }
      if (lastName) {
        updates.push(`last_name = $${paramIdx++}`);
        values.push(lastName);
      }
      if (email) {
        updates.push(`email = $${paramIdx++}`);
        values.push(email);
        // If email changes, require re-verification
        updates.push(`email_verified = FALSE`);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update.' });
      }

      updates.push(`updated_at = NOW()`);
      values.push(userId);

      const result = await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, first_name, last_name, email, email_verified, points, created_at`,
        values
      );

      const user = result.rows[0];

      // Update session
      req.session.firstName = user.first_name;
      req.session.lastName = user.last_name;
      req.session.email = user.email;

      // If email changed, send new verification email
      if (email && email !== req.user.email) {
        const verificationToken = crypto.randomBytes(32).toString('hex');
        await pool.query(
          `INSERT INTO email_verification_tokens (user_id, token, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
          [user.id, verificationToken]
        );
        sendVerificationEmail(email, verificationToken, user.first_name).catch(err => {
          console.error('Failed to send verification email:', err);
        });
      }

      res.json({
        message: 'Profile updated successfully.',
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          email: user.email,
          emailVerified: user.email_verified,
          points: user.points,
          createdAt: user.created_at
        }
      });
    } catch (err) {
      console.error('Profile update error:', err);
      res.status(500).json({ error: 'Failed to update profile.' });
    }
  });

  // ─── POST /api/auth/verify-email ──────────────────────────────
  router.post('/verify-email', async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'Verification token is required.' });
      }

      const result = await pool.query(
        `SELECT evt.user_id, evt.expires_at, u.email_verified
         FROM email_verification_tokens evt
         JOIN users u ON u.id = evt.user_id
         WHERE evt.token = $1`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired verification link.' });
      }

      const tokenData = result.rows[0];

      if (tokenData.email_verified) {
        return res.json({ message: 'Email already verified.' });
      }

      if (new Date(tokenData.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Verification link has expired. Please request a new one.' });
      }

      // Verify the email
      await pool.query('UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1', [tokenData.user_id]);

      // Delete used tokens
      await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [tokenData.user_id]);

      res.json({ message: 'Email verified successfully! You can now use all features.' });
    } catch (err) {
      console.error('Email verification error:', err);
      res.status(500).json({ error: 'Failed to verify email.' });
    }
  });

  // ─── POST /api/auth/resend-verification ───────────────────────
  router.post('/resend-verification', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;

      // Check if already verified
      const userResult = await pool.query('SELECT email, first_name, email_verified FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const user = userResult.rows[0];
      if (user.email_verified) {
        return res.json({ message: 'Email already verified.' });
      }

      // Delete old tokens
      await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);

      // Generate new token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      await pool.query(
        `INSERT INTO email_verification_tokens (user_id, token, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [userId, verificationToken]
      );

      await sendVerificationEmail(user.email, verificationToken, user.first_name);

      res.json({ message: 'Verification email sent. Please check your inbox.' });
    } catch (err) {
      console.error('Resend verification error:', err);
      res.status(500).json({ error: 'Failed to send verification email.' });
    }
  });

  // ─── POST /api/auth/forgot-password ───────────────────────────
  router.post('/forgot-password', resetLimiter, sanitiseInput, forgotPasswordValidation, async (req, res) => {
    try {
      const { email } = req.body;

      // Always respond with success to prevent email enumeration
      const result = await pool.query('SELECT id, first_name FROM users WHERE email = $1', [email]);

      if (result.rows.length > 0) {
        const user = result.rows[0];

        // Invalidate old reset tokens
        await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE', [user.id]);

        // Create new reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        await pool.query(
          `INSERT INTO password_reset_tokens (user_id, token, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
          [user.id, resetToken]
        );

        // Send reset email
        await sendPasswordResetEmail(email, resetToken, user.first_name);
      }

      // Always return same response (prevents email enumeration)
      res.json({ message: 'If an account exists with that email, a password reset link has been sent.' });
    } catch (err) {
      console.error('Forgot password error:', err);
      res.status(500).json({ error: 'Failed to process password reset request.' });
    }
  });

  // ─── POST /api/auth/reset-password ────────────────────────────
  router.post('/reset-password', resetLimiter, sanitiseInput, resetPasswordValidation, async (req, res) => {
    try {
      const { token, password } = req.body;

      // Find valid, unused, non-expired token
      const result = await pool.query(
        `SELECT prt.id, prt.user_id, prt.expires_at
         FROM password_reset_tokens prt
         WHERE prt.token = $1 AND prt.used = FALSE`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired reset link.' });
      }

      const tokenData = result.rows[0];

      if (new Date(tokenData.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Update password
      await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, tokenData.user_id]);

      // Mark token as used
      await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [tokenData.id]);

      // Invalidate all sessions for this user (force re-login)
      await pool.query('DELETE FROM user_sessions WHERE (sess->>\'userId\')::int = $1', [tokenData.user_id]);

      res.json({ message: 'Password reset successfully. Please sign in with your new password.' });
    } catch (err) {
      console.error('Reset password error:', err);
      res.status(500).json({ error: 'Failed to reset password.' });
    }
  });

  // ─── DELETE /api/auth/account ─────────────────────────────────
  router.delete('/account', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;

      // Delete user (cascades to tokens, transactions, etc.)
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);

      // Destroy session
      req.session.destroy(err => {
        if (err) console.error('Session destruction error:', err);
      });

      res.clearCookie('connect.sid');
      res.json({ message: 'Account deleted successfully. All your data has been removed.' });
    } catch (err) {
      console.error('Account deletion error:', err);
      res.status(500).json({ error: 'Failed to delete account.' });
    }
  });

  // ─── GET /api/auth/points ─────────────────────────────────────
  router.get('/points', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;

      // Get current points balance
      const userResult = await pool.query('SELECT points FROM users WHERE id = $1', [userId]);
      const points = userResult.rows[0]?.points || 0;

      // Get transaction history (last 50)
      const txResult = await pool.query(
        `SELECT id, points, type, description, created_at
         FROM point_transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId]
      );

      res.json({
        points,
        transactions: txResult.rows.map(tx => ({
          id: tx.id,
          points: tx.points,
          type: tx.type,
          description: tx.description,
          createdAt: tx.created_at
        }))
      });
    } catch (err) {
      console.error('Get points error:', err);
      res.status(500).json({ error: 'Failed to load points.' });
    }
  });

  // ─── POST /api/auth/points/earn ───────────────────────────────
  router.post('/points/earn', requireAuth, async (req, res) => {
    try {
      const { type, description, points } = req.body;
      const userId = req.user.id;

      if (!type || !points || points <= 0) {
        return res.status(400).json({ error: 'Invalid points data.' });
      }

      // Valid earn types
      const validTypes = ['route_taken', 'ticket_purchase'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: 'Invalid points type.' });
      }

      // Add transaction and update balance
      await pool.query(
        `INSERT INTO point_transactions (user_id, points, type, description)
         VALUES ($1, $2, $3, $4)`,
        [userId, points, type, description || `Earned ${points} points`]
      );

      await pool.query(
        'UPDATE users SET points = points + $1 WHERE id = $2',
        [points, userId]
      );

      const updatedUser = await pool.query('SELECT points FROM users WHERE id = $1', [userId]);

      res.json({
        message: `Earned ${points} points!`,
        totalPoints: updatedUser.rows[0].points
      });
    } catch (err) {
      console.error('Earn points error:', err);
      res.status(500).json({ error: 'Failed to add points.' });
    }
  });

  // ─── GET /api/auth/rewards ────────────────────────────────────
  router.get('/rewards', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, name, description, points_cost FROM rewards WHERE active = TRUE ORDER BY points_cost ASC'
      );

      res.json({ rewards: result.rows });
    } catch (err) {
      console.error('Get rewards error:', err);
      res.status(500).json({ error: 'Failed to load rewards.' });
    }
  });

  // ─── POST /api/auth/rewards/redeem ────────────────────────────
  router.post('/rewards/redeem', requireAuth, async (req, res) => {
    try {
      const { rewardId } = req.body;
      const userId = req.user.id;

      if (!rewardId) {
        return res.status(400).json({ error: 'Reward ID is required.' });
      }

      // Get reward details
      const rewardResult = await pool.query('SELECT * FROM rewards WHERE id = $1 AND active = TRUE', [rewardId]);
      if (rewardResult.rows.length === 0) {
        return res.status(404).json({ error: 'Reward not found.' });
      }

      const reward = rewardResult.rows[0];

      // Check user has enough points
      const userResult = await pool.query('SELECT points FROM users WHERE id = $1', [userId]);
      const currentPoints = userResult.rows[0].points;

      if (currentPoints < reward.points_cost) {
        return res.status(400).json({
          error: `Not enough points. You need ${reward.points_cost} but have ${currentPoints}.`
        });
      }

      // Deduct points and record transaction
      await pool.query('UPDATE users SET points = points - $1 WHERE id = $2', [reward.points_cost, userId]);

      await pool.query(
        `INSERT INTO point_transactions (user_id, points, type, description)
         VALUES ($1, $2, 'reward_redeemed', $3)`,
        [userId, -reward.points_cost, `Redeemed: ${reward.name}`]
      );

      await pool.query(
        'INSERT INTO redeemed_rewards (user_id, reward_id) VALUES ($1, $2)',
        [userId, rewardId]
      );

      const updatedUser = await pool.query('SELECT points FROM users WHERE id = $1', [userId]);

      res.json({
        message: `Successfully redeemed "${reward.name}"!`,
        totalPoints: updatedUser.rows[0].points
      });
    } catch (err) {
      console.error('Redeem reward error:', err);
      res.status(500).json({ error: 'Failed to redeem reward.' });
    }
  });

  // ─── GET /api/auth/settings ──────────────────────────────────
  /**
   * Returns the current user's settings.
   * Creates a default settings row if one does not exist yet.
   */
  router.get('/settings', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      // Upsert ensures a row always exists even for legacy accounts
      const result = await pool.query(
        `INSERT INTO user_settings (user_id, theme, font_size)
         VALUES ($1, 'light', 'medium')
         ON CONFLICT (user_id) DO UPDATE SET updated_at = user_settings.updated_at
         RETURNING theme, font_size`,
        [userId]
      );
      const row = result.rows[0];
      res.json({ theme: row.theme, fontSize: row.font_size });
    } catch (err) {
      console.error('Get settings error:', err);
      res.status(500).json({ error: 'Failed to load settings.' });
    }
  });

  // ─── PUT /api/auth/settings ──────────────────────────────────
  /**
   * Updates one or more settings fields for the current user.
   * Called on every individual setting change so the UI can apply immediately.
   */
  router.put('/settings', requireAuth, sanitiseInput, settingsValidation, async (req, res) => {
    try {
      const userId = req.user.id;
      const { theme, fontSize } = req.body;

      // Ensure a row exists
      await pool.query(
        `INSERT INTO user_settings (user_id, theme, font_size)
         VALUES ($1, 'light', 'medium')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );

      // Build dynamic update
      const updates = [];
      const values = [];
      let paramIdx = 1;

      if (theme !== undefined) {
        updates.push(`theme = $${paramIdx++}`);
        values.push(theme);
      }
      if (fontSize !== undefined) {
        updates.push(`font_size = $${paramIdx++}`);
        values.push(fontSize);
      }

      if (updates.length === 0) {
        // Nothing to update – return current row
        const current = await pool.query(
          'SELECT theme, font_size FROM user_settings WHERE user_id = $1',
          [userId]
        );
        const row = current.rows[0];
        return res.json({ theme: row.theme, fontSize: row.font_size });
      }

      updates.push(`updated_at = NOW()`);
      values.push(userId);

      const result = await pool.query(
        `UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = $${paramIdx} RETURNING theme, font_size`,
        values
      );

      const row = result.rows[0];
      res.json({ theme: row.theme, fontSize: row.font_size });
    } catch (err) {
      console.error('Update settings error:', err);
      res.status(500).json({ error: 'Failed to update settings.' });
    }
  });

  // ─── POST /api/auth/change-password ──────────────────────────
  /**
   * Changes the user's password while they are logged in.
   * Verifies the current password, hashes the new one, and invalidates
   * all other sessions (but keeps the current session active).
   */
  router.post('/change-password', requireAuth, sanitiseInput, changePasswordValidation, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;

      // Fetch stored hash
      const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const { password_hash } = result.rows[0];

      // Validate current password
      const isValid = await bcrypt.compare(currentPassword, password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }

      // Hash and store new password
      const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, userId]);

      // Invalidate all other sessions for this user (keep current session)
      await pool.query(
        `DELETE FROM user_sessions WHERE (sess->>'userId')::int = $1 AND sid != $2`,
        [userId, req.session.id]
      );

      res.json({ message: 'Password changed successfully.' });
    } catch (err) {
      console.error('Change password error:', err);
      res.status(500).json({ error: 'Failed to change password.' });
    }
  });

  return router;
}

module.exports = createAuthRoutes;
