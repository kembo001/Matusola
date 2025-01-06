const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// Create/connect to database
const db = new sqlite3.Database(path.join(__dirname, "database.db"), (err) => {
  if (err) {
    console.error("Error connecting to database:", err);
  } else {
    console.log("Connected to SQLite database");
    createTables();
  }
});

// Create table if they don't exist
function createTables() {
  db.run(`
        CREATE TABLE IF NOT EXISTS vehicles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            year INTEGER NOT NULL,
            make TEXT NOT NULL,
            model TEXT NOT NULL,
            trim TEXT,
            price INTEGER,
            mileage INTEGER,
            vin TEXT,
            engine TEXT,
            transmission TEXT,
            status TEXT DEFAULT 'available',
            images_folder TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

module.exports = db;
