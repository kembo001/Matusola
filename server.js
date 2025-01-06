const express = require("express");
const path = require("path");
const app = express();
const db = require("./database.js"); // This imports and runs database.js
const s3 = require("./spaces.js"); // This imports and runs spaces.js - Our media storage

// Set up EJS
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.get("/", (req, res) => {
  res.render("index");
});

app.get("/inventory", (req, res) => {
  const page = parseInt(req.query.page) || 1; // Get page from query or default to 1
  const limit = 3; // X vehicles per page
  const offset = (page - 1) * limit;

  // First get total count of available vehicles
  db.get(`SELECT COUNT(*) as total FROM vehicles WHERE status = ?`, ["available"], (err, count) => {
    if (err) {
      console.error("Error counting vehicles:", err);
      return res.status(500).send("Database error");
    }

    // Then get paginated vehicles
    db.all(
      `SELECT * FROM vehicles 
         WHERE status = ?
         LIMIT ? OFFSET ?`,
      ["available", limit, offset],
      (err, vehicles) => {
        if (err) {
          console.error("Error fetching vehicles:", err);
          return res.status(500).send("Database error");
        }

        // Add image URLs
        vehicles = vehicles.map((vehicle) => ({
          ...vehicle,
          image_url: `https://wholesalecars.sfo3.cdn.digitaloceanspaces.com/${vehicle.images_folder}/main.jpg`,
        }));

        const totalPages = Math.ceil(count.total / limit);

        res.render("inventory", {
          vehicles,
          currentPage: page,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        });
      }
    );
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
