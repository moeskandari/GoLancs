const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

// Placeholder for route planning endpoint
app.post('/api/routes', (req, res) => {
  const { start, destination } = req.body;
  // TODO: Implement route planning logic
  res.json({
    message: 'Route planning endpoint - to be implemented',
    start,
    destination
  });
});

// Placeholder for transportation data endpoint
app.get('/api/transport', (req, res) => {
  // TODO: Fetch from database and real-time API
  res.json({
    message: 'Transportation data endpoint - to be implemented'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
