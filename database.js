// database.js
const { Pool } = require('pg');
require("dotenv").config();

// Create a new connection pool
const pool = new Pool({
  connectionString: 'postgres://shoreline_cars_db_user:hVDUxeDR25cHo4NXab4G9NFJy5yukNrF@dpg-d1m92m63jp1c73eftq50-a/shoreline_cars_db',
  ssl: {
    rejectUnauthorized: false
  }
});

// Optional: Test connection once at startup
pool.connect()
  .then(client => {
    console.log('✅ Connected to PostgreSQL');
    client.release();
  })
  .catch(err => {
    console.error('❌ PostgreSQL connection error:', err.stack);
  });

// Export a simple query helper
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool // Export raw pool if needed elsewhere
};
