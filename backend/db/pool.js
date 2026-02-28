/**
 * PostgreSQL connection pool configuration.
 * Centralises database access for all backend modules.
 *
 * Environment variables:
 *   DB_HOST     – database hostname (default: localhost)
 *   DB_PORT     – database port     (default: 5432)
 *   DB_NAME     – database name     (default: group1db)
 *   DB_USER     – database user     (default: group1user)
 *   DB_PASSWORD – database password (default: group1pass)
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'group1db',
  user: process.env.DB_USER || 'group1user',
  password: process.env.DB_PASSWORD || 'group1pass',
});

module.exports = pool;
