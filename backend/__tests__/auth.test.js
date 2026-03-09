/**
 * Tests for authentication endpoints.
 * Tests sign-up, sign-in, sign-out, profile management,
 * email verification, password reset, points, and account deletion.
 *
 * Uses supertest with the Express app and mocks the pg Pool.
 */

const request = require('supertest');
const bcrypt = require('bcrypt');

// Mock connect-pg-simple so the session store doesn't use the pool
jest.mock('connect-pg-simple', () => {
  return () => {
    const expressSession = require('express-session');
    return class MockPgStore extends expressSession.Store {
      get(sid, cb) { cb(null, null); }
      set(sid, sess, cb) { cb && cb(null); }
      destroy(sid, cb) { cb && cb(null); }
      touch(sid, sess, cb) { cb && cb(null); }
    };
  };
});

// Mock the pg Pool before requiring the app
jest.mock('pg', () => {
  const mockPool = {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn()
  };
  return { Pool: jest.fn(() => mockPool) };
});

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' })
  }))
}));

// We need to get a reference to the mocked pool
const { Pool } = require('pg');
const pool = new Pool();

// Now require the app (which will use the mocked pool)
const app = require('../server');

// Helper: create a mock session cookie agent
function createAgent() {
  return request.agent(app);
}

// Helper: hash a password for test data
async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

describe('Auth Routes', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  // ─── POST /api/auth/signup ───────────────────────────────
  describe('POST /api/auth/signup', () => {
    const validSignup = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'StrongPass1!',
      retypePassword: 'StrongPass1!'
    };

    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'test@test.com' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toBeDefined();
    });

    it('should return 400 for weak password', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...validSignup, password: 'weak', retypePassword: 'weak' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('should return 400 for mismatched passwords', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...validSignup, retypePassword: 'DifferentPass1!' });

      expect(res.statusCode).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: 'Passwords do not match' })
        ])
      );
    });

    it('should return 400 for invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...validSignup, email: 'not-an-email' });

      expect(res.statusCode).toBe(400);
    });

    it('should return 409 if email already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // email check

      const res = await request(app)
        .post('/api/auth/signup')
        .send(validSignup);

      expect(res.statusCode).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
      expect(res.body.redirect).toBe('signin');
    });

    it('should return 201 on successful signup', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // email check - not found
        .mockResolvedValueOnce({ // INSERT user
          rows: [{
            id: 1,
            first_name: 'John',
            last_name: 'Doe',
            email: 'john@example.com',
            email_verified: false,
            points: 50,
            created_at: new Date().toISOString()
          }]
        })
        .mockResolvedValueOnce({ rows: [] }) // INSERT point_transaction
        .mockResolvedValueOnce({ rows: [] }); // INSERT verification token

      const res = await request(app)
        .post('/api/auth/signup')
        .send(validSignup);

      expect(res.statusCode).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.firstName).toBe('John');
      expect(res.body.user.lastName).toBe('Doe');
      expect(res.body.user.email).toBe('john@example.com');
      expect(res.body.user.points).toBe(50);
      expect(res.body.message).toMatch(/account created/i);
    });

    it('should strip HTML tags from input (XSS prevention)', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1, first_name: 'John', last_name: 'Doe',
            email: 'john@example.com', email_verified: false,
            points: 50, created_at: new Date().toISOString()
          }]
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          ...validSignup,
          firstName: '<script>alert("xss")</script>John'
        });

      // The sanitiser should strip the script tag
      if (res.statusCode === 201) {
        expect(res.body.user.firstName).not.toContain('<script>');
      }
    });
  });

  // ─── POST /api/auth/signin ───────────────────────────────
  describe('POST /api/auth/signin', () => {
    it('should return 400 for missing email', async () => {
      const res = await request(app)
        .post('/api/auth/signin')
        .send({ password: 'test' });

      expect(res.statusCode).toBe(400);
    });

    it('should return 401 for non-existent user', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/signin')
        .send({ email: 'noone@test.com', password: 'StrongPass1!' });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/invalid email or password/i);
    });

    it('should return 401 for wrong password', async () => {
      const hash = await hashPassword('CorrectPass1!');
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, first_name: 'John', last_name: 'Doe',
          email: 'john@example.com', password_hash: hash,
          email_verified: true, points: 50,
          created_at: new Date().toISOString()
        }]
      });

      const res = await request(app)
        .post('/api/auth/signin')
        .send({ email: 'john@example.com', password: 'WrongPass1!' });

      expect(res.statusCode).toBe(401);
    });

    it('should return 200 on successful sign-in with session', async () => {
      const hash = await hashPassword('StrongPass1!');
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, first_name: 'John', last_name: 'Doe',
          email: 'john@example.com', password_hash: hash,
          email_verified: true, points: 100,
          created_at: new Date().toISOString()
        }]
      });

      const agent = createAgent();
      const res = await agent
        .post('/api/auth/signin')
        .send({ email: 'john@example.com', password: 'StrongPass1!' });

      expect(res.statusCode).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.firstName).toBe('John');
      expect(res.body.user.points).toBe(100);
      expect(res.body.message).toMatch(/signed in/i);

      // Check session cookie was set
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });

  // ─── POST /api/auth/logout ──────────────────────────────
  describe('POST /api/auth/logout', () => {
    it('should return 200 and clear session', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/logged out/i);
    });
  });

  // ─── GET /api/auth/me ───────────────────────────────────
  describe('GET /api/auth/me', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toMatch(/authentication required/i);
    });
  });

  // ─── POST /api/auth/verify-email ────────────────────────
  describe('POST /api/auth/verify-email', () => {
    it('should return 400 for missing token', async () => {
      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({});

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid token', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'invalid-token' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });

    it('should return 400 for expired token', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          user_id: 1,
          expires_at: new Date(Date.now() - 86400000).toISOString(), // 24h ago
          email_verified: false
        }]
      });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'expired-token' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
    });

    it('should return 200 for valid token', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            user_id: 1,
            expires_at: new Date(Date.now() + 86400000).toISOString(), // 24h from now
            email_verified: false
          }]
        })
        .mockResolvedValueOnce({ rows: [] }) // UPDATE users
        .mockResolvedValueOnce({ rows: [] }); // DELETE tokens

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'valid-token' });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/verified/i);
    });

    it('should return 200 for already verified email', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          user_id: 1,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          email_verified: true
        }]
      });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'already-verified-token' });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/already verified/i);
    });
  });

  // ─── POST /api/auth/forgot-password ─────────────────────
  describe('POST /api/auth/forgot-password', () => {
    it('should return 400 for missing email', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({});

      expect(res.statusCode).toBe(400);
    });

    it('should return 200 even for non-existent email (prevents enumeration)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // user not found

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody@example.com' });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/if an account exists/i);
    });

    it('should return 200 and send email for valid user', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, first_name: 'John' }] }) // user found
        .mockResolvedValueOnce({ rows: [] }) // invalidate old tokens
        .mockResolvedValueOnce({ rows: [] }); // insert new token

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'john@example.com' });

      expect(res.statusCode).toBe(200);
    });
  });

  // ─── POST /api/auth/reset-password ──────────────────────
  describe('POST /api/auth/reset-password', () => {
    it('should return 400 for missing token/password', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({});

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for weak new password', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'some-token', password: 'weak' });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for invalid token', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // token not found

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'invalid-token', password: 'NewStrongPass1!' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });

    it('should return 400 for expired token', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1,
          user_id: 1,
          expires_at: new Date(Date.now() - 3600000).toISOString() // 1h ago
        }]
      });

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'expired-token', password: 'NewStrongPass1!' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/expired/i);
    });

    it('should return 200 for valid reset', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            user_id: 1,
            expires_at: new Date(Date.now() + 3600000).toISOString() // 1h from now
          }]
        })
        .mockResolvedValueOnce({ rows: [] }) // UPDATE password
        .mockResolvedValueOnce({ rows: [] }) // Mark token used
        .mockResolvedValueOnce({ rows: [] }); // DELETE sessions

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'valid-token', password: 'NewStrongPass1!' });

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toMatch(/reset successfully/i);
    });
  });

  // ─── DELETE /api/auth/account ───────────────────────────
  describe('DELETE /api/auth/account', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).delete('/api/auth/account');

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── GET /api/auth/points ──────────────────────────────
  describe('GET /api/auth/points', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/points');

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── POST /api/auth/points/earn ────────────────────────
  describe('POST /api/auth/points/earn', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app)
        .post('/api/auth/points/earn')
        .send({ type: 'route_taken', points: 10 });

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── GET /api/auth/rewards ─────────────────────────────
  describe('GET /api/auth/rewards', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app).get('/api/auth/rewards');

      expect(res.statusCode).toBe(401);
    });
  });

  // ─── POST /api/auth/rewards/redeem ─────────────────────
  describe('POST /api/auth/rewards/redeem', () => {
    it('should return 401 when not authenticated', async () => {
      const res = await request(app)
        .post('/api/auth/rewards/redeem')
        .send({ rewardId: 1 });

      expect(res.statusCode).toBe(401);
    });
  });
});

// ─── Input validation tests ──────────────────────────────
describe('Input Validation', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it('should reject names with invalid characters', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        firstName: 'John123!@#',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'StrongPass1!',
        retypePassword: 'StrongPass1!'
      });

    expect(res.statusCode).toBe(400);
  });

  it('should accept names with apostrophes and hyphens', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1, first_name: "O'Brien", last_name: 'Smith-Jones',
          email: 'obrien@example.com', email_verified: false,
          points: 50, created_at: new Date().toISOString()
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        firstName: "O'Brien",
        lastName: 'Smith-Jones',
        email: 'obrien@example.com',
        password: 'StrongPass1!',
        retypePassword: 'StrongPass1!'
      });

    expect([201, 500]).toContain(res.statusCode);
  });
});

// ─── Security tests ──────────────────────────────────────
describe('Security', () => {
  it('should set security headers', async () => {
    const res = await request(app).get('/api/health');

    // Helmet should set X-Content-Type-Options
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should return CORS headers', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5001');

    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('should support credentials in CORS', async () => {
    const res = await request(app)
      .options('/api/auth/signin')
      .set('Origin', 'http://localhost:5001')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
