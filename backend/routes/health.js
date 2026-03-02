/**
 * Health check route.
 *
 *   GET /api/health → { status: 'ok', message, timestamp }
 */

const { Router } = require('express');
const router = Router();

router.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Lancaster Travel Routes API is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
