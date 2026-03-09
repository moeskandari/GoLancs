/**
 * Jest configuration for the backend test suite.
 *
 * Key CI settings:
 *  - testTimeout: 60 s default (external APIs + DB queries need headroom in CI)
 *  - forceExit: closes open handles (pg pool, https agents) after tests complete
 *  - detectOpenHandles: warns about any handles that prevent a clean exit
 *  - verbose: true — show per-test results in CI logs for easier failure triage
 *  - testEnvironment: node (explicit, avoids jsdom being chosen by mistake)
 */

module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  forceExit: true,
  detectOpenHandles: true,
  testMatch: ['**/__tests__/**/*.test.js'],
  verbose: true,
};
