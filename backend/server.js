const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5050),
  database: process.env.DB_NAME || 'group1db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'group1'
});

// Haversine distance calculation in kilometers
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend server is running' });
});

// Fetch nearest bus stops by user location
app.get('/api/stops', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    
    // Fetch all stops from database
    const result = await pool.query(
      'SELECT atco_code, common_name, coordinates FROM stops WHERE coordinates IS NOT NULL'
    );
    
    let stops = result.rows;
    
    // If user location provided, calculate distances and sort
    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      
      stops = stops.map(stop => {
        const coords = stop.coordinates;
        let stopLat, stopLng;
        
        if (typeof coords === 'object' && coords.x !== undefined) {
          stopLat = coords.y;
          stopLng = coords.x;
        } else if (typeof coords === 'string') {
          // Parse string format "(-2.7,53.5)"
          const match = coords.match(/\(([^,]+),([^)]+)\)/);
          if (!match) return null;
          stopLat = parseFloat(match[2]);
          stopLng = parseFloat(match[1]);
        } else {
          return null;
        }
        
        const distance = haversineDistance(userLat, userLng, stopLat, stopLng);
        return { ...stop, distance };
      }).filter(s => s !== null)
       .sort((a, b) => a.distance - b.distance)
       .slice(0, 5);
    } else {
      stops = stops.slice(0, 5);
    }
    
    res.json(stops);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stops' });
  }
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
