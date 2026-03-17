/**
 * Manual Jest mock for connect-pg-simple.
 *
 * Jest automatically uses files in __mocks__/ for node_modules.
 * This prevents the PgSession store from trying to connect to
 * PostgreSQL during tests — in CI there is no database at
 * localhost:5050, so the real store would fire ECONNREFUSED errors
 * that break the session middleware.
 *
 * The mock provides a no-op session store that satisfies the
 * express-session Store interface.
 */

const expressSession = require('express-session');

class MockPgStore extends expressSession.Store {
  get(sid, cb)          { cb(null, null); }
  set(sid, sess, cb)    { cb && cb(null); }
  destroy(sid, cb)      { cb && cb(null); }
  touch(sid, sess, cb)  { cb && cb(null); }
}

// connect-pg-simple exports a function that takes the session module
// and returns the store class.
module.exports = function () {
  return MockPgStore;
};
