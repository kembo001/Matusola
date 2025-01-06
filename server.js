const express = require("express");
const path = require("path");
const app = express();
const db = require("./database.js"); // This imports and runs database.js
const s3 = require("./spaces.js"); // This imports and runs spaces.js - Our media storage
const multer = require("multer");
const upload = multer();
const sharp = require("sharp");

// Set up EJS
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Static files
app.use(express.static(path.join(__dirname, "public")));

// Add these middleware configurations
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.render("index");
});

// AUTH FUNCTION FOR ADMIN ROUTE
function basicAuth(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Access"');
    return res.sendStatus(401);
  }

  // Get credentials
  const credentials = Buffer.from(auth.split(" ")[1], "base64").toString();
  const [username, password] = credentials.split(":");

  // Check both username and password
  if (username === "wholesalecars" && password === "Blake777") {
    next();
  } else {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Access"');
    return res.sendStatus(401);
  }
}

// Use it on admin routes
app.get("/admin", basicAuth, (req, res) => {
  res.render("admin");
});

// END OF AUTH FUNCTION AND ADMIN ROUTE

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
          image_url: `https://wholesalecars.sfo3.cdn.digitaloceanspaces.com/${vehicle.images_folder}/1.jpg`,
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

app.post("/add-vehicle", upload.array("images"), async (req, res) => {
  try {
    // Log the form data to see what we're receiving
    console.log("Form data received:", req.body);
    console.log("Files received:", req.files);

    // Get form data with default values
    const { title, year, make, model, price, mileage, trim, vin, engine, transmission, status = "available" } = req.body;

    // Validate required fields
    if (!title || !year || !make || !model) {
      console.error("Missing required fields");
      return res.redirect("/admin?error=missing_fields");
    }

    // Generate unique folder name for images FIRST
    const timestamp = Date.now();
    const images_folder = `vehicle_${timestamp}`;

    // Validate file types
    for (const file of req.files) {
      if (!file.mimetype.startsWith("image/")) {
        return res.redirect("/admin?error=invalid_file_type");
      }
    }

    // Convert images to JPEG and process them
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];

      try {
        // Convert to JPEG and resize if needed
        const processedImage = await sharp(file.buffer)
          .jpeg({ quality: 80 }) // Convert to JPEG
          .resize(1200, null, {
            // Max width 1200px, maintain aspect ratio
            withoutEnlargement: true,
          })
          .toBuffer();

        // Upload processed image
        await s3
          .upload({
            Bucket: "wholesalecars",
            Key: `${images_folder}/${i + 1}.jpg`,
            Body: processedImage,
            ContentType: "image/jpeg",
            ACL: "public-read",
          })
          .promise();
      } catch (processError) {
        console.error("Error processing image:", processError);
        return res.redirect("/admin?error=image_processing_failed");
      }
    }

    // Insert into database
    const result = await db.run(
      `
      INSERT INTO vehicles (
        title, year, make, model, trim,
        price, mileage, vin, engine, transmission,
        status, images_folder
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [title, year, make, model, trim, price, mileage, vin, engine, transmission, status, images_folder]
    );

    console.log("Insert successful:", result);
    res.redirect("/admin?success=true");
  } catch (error) {
    console.error("Error adding vehicle:", error);
    res.redirect("/admin?error=true");
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
