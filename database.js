// database.js
const { Pool } = require('pg');
require("dotenv").config();

// Create a new connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render's managed Postgres
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
