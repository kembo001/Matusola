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
  const page = parseInt(req.query.page) || 1;
  const limit = 3;
  const offset = (page - 1) * limit;

  // Set default values for filters
  const currentStatus = req.query.status || "available";
  const currentSort = req.query.sort || "newest";

  // Build WHERE clause
  let whereClause = currentStatus === "all" ? "1=1" : "status = ?";
  let params = currentStatus === "all" ? [] : [currentStatus];

  // Build ORDER BY clause based on sort parameter
  let orderBy;
  switch (currentSort) {
    case "newest":
      orderBy = "year DESC";
      break;
    case "price-high":
      orderBy = "price DESC";
      break;
    case "price-low":
      orderBy = "price ASC";
      break;
    case "mileage-low":
      orderBy = "mileage ASC";
      break;
    case "mileage-high":
      orderBy = "mileage DESC";
      break;
    default:
      orderBy = "year DESC";
  }

  // Get filtered count
  db.get(`SELECT COUNT(*) as total FROM vehicles WHERE ${whereClause}`, params, (err, count) => {
    if (err) {
      console.error("Error counting vehicles:", err);
      return res.status(500).send("Database error");
    }

    // Get filtered and sorted vehicles
    db.all(
      `SELECT * FROM vehicles 
         WHERE ${whereClause}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      [...params, limit, offset],
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
          currentStatus, // Pass the status to the view
          currentSort, // Pass the sort to the view
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
