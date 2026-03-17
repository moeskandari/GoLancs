/**
 * Security middleware – sets security headers and provides input sanitisation.
 */

const helmet = require('helmet');

/**
 * Configure Helmet security headers.
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: false,  // Let the frontend handle CSP
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  });
}

/**
 * Simple XSS sanitisation – strips HTML tags from string values in req.body.
 */
function sanitiseInput(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        // Strip HTML tags to prevent XSS
        req.body[key] = req.body[key].replace(/<[^>]*>/g, '');
      }
    }
  }
  next();
}

/**
 * Rate limiter for auth endpoints – prevents brute force attacks.
 * Simple in-memory implementation suitable for single-server deployment.
 */
function createRateLimiter(windowMs = 15 * 60 * 1000, maxRequests = 20) {
  const requests = new Map();

  // Skip rate limiting in test environment
  if (process.env.NODE_ENV === 'test') {
    return (req, res, next) => next();
  }

  // Clean up old entries every minute
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of requests) {
      if (now - data.windowStart > windowMs) {
        requests.delete(key);
      }
    }
  }, 60 * 1000);
  cleanupInterval.unref(); // Don't prevent process exit

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!requests.has(key)) {
      requests.set(key, { count: 1, windowStart: now });
      return next();
    }

    const data = requests.get(key);

    if (now - data.windowStart > windowMs) {
      // Window expired, reset
      requests.set(key, { count: 1, windowStart: now });
      return next();
    }

    data.count++;

    if (data.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.'
      });
    }

    next();
  };
}

module.exports = { securityHeaders, sanitiseInput, createRateLimiter };
