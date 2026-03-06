/**
 * Authentication middleware – verifies that the request has a valid session.
 * Attaches req.user with { id, email, firstName, lastName } when authenticated.
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }
  // Attach user info from session
  req.user = {
    id: req.session.userId,
    email: req.session.email,
    firstName: req.session.firstName,
    lastName: req.session.lastName
  };
  next();
}

/**
 * Optional auth – attaches user info if session exists, but doesn't block.
 */
function optionalAuth(req, res, next) {
  if (req.session && req.session.userId) {
    req.user = {
      id: req.session.userId,
      email: req.session.email,
      firstName: req.session.firstName,
      lastName: req.session.lastName
    };
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
