const express = require("express");
const path = require("path");
const app = express();
const db = require("./database.js"); // This imports and runs database.js
const s3 = require("./spaces.js"); // This imports and runs spaces.js - Our media storage
const multer = require("multer");
const upload = multer();
const sharp = require("sharp");

// Helper function to get common S3 upload parameters
const getS3Params = (Key, Body, ContentType = "image/jpeg") => ({
  Bucket: "wholesalecars",
  Key,
  Body,
  ContentType,
  ACL: "public-read",
  CacheControl: "no-cache, no-store, must-revalidate",
  Expires: 0,
});

// Helper function to get vehicle images from S3
async function getVehicleImages(vehicle) {
  try {
    const images = await s3
      .listObjectsV2({
        Bucket: "wholesalecars",
        Prefix: `${vehicle.images_folder}/`,
      })
      .promise();

    const sortedImages = images.Contents.map((obj) => ({
      number: parseInt(obj.Key.split("/").pop().split(".")[0]),
      url: `https://wholesalecars.sfo3.cdn.digitaloceanspaces.com/${obj.Key}`,
    })).sort((a, b) => a.number - b.number);

    return {
      ...vehicle,
      imageCount: images.Contents.length,
      images: sortedImages,
      image_url: sortedImages[0]?.url || "/images/no-image.jpg",
    };
  } catch (error) {
    console.error(`Error getting images for vehicle ${vehicle.id}:`, error);
    return {
      ...vehicle,
      imageCount: 0,
      images: [],
      image_url: "/images/no-image.jpg",
    };
  }
}

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

// Serve robots.txt - WEB Crawlers use this to know what they can index
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send("User-agent: *\nDisallow: /admin\nAllow: /\nSitemap: https://wholesalecarsmn.com/sitemap.xml");
});

// Serve sitemap.xml
app.get("/sitemap.xml", (req, res) => {
  // Cache for 24 hours (86400 seconds)
  res.set("Cache-Control", "public, max-age=86400");
  res.header("Content-Type", "application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.wholesalecarsmn.com/</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://www.wholesalecarsmn.com/inventory</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>https://www.wholesalecarsmn.com/calculator</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
</urlset>`);
});

// AUTH FUNCTION FOR ADMIN ROUTE
function basicAuth(req, res, next) {
  // Add no-cache headers
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

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
app.get("/admin", basicAuth, async (req, res) => {
  try {
    const vehicles = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM vehicles ORDER BY created_at DESC`, async (err, rows) => {
        if (err) reject(err);
        else {
          const vehiclesWithImages = await Promise.all(rows.map(getVehicleImages));
          resolve(vehiclesWithImages);
        }
      });
    });

    res.render("admin", {
      vehicles,
      success: req.query.success,
      error: req.query.error,
      deleted: req.query.deleted,
    });
  } catch (error) {
    console.error("Error fetching vehicles:", error);
    res.render("admin", {
      vehicles: [],
      error: "Failed to fetch vehicles",
    });
  }
});

// END OF AUTH FUNCTION AND ADMIN ROUTE

// Taxes and Fees Route
app.get("/calculator", (req, res) => {
  res.render("calculator");
});

// Inventory Route
app.get("/inventory", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 12;
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

  try {
    // Get filtered count
    const count = await new Promise((resolve, reject) => {
      db.get(`SELECT COUNT(*) as total FROM vehicles WHERE ${whereClause}`, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Get filtered and sorted vehicles
    const vehicles = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM vehicles 
           WHERE ${whereClause}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`,
        [...params, limit, offset],
        async (err, rows) => {
          if (err) reject(err);
          else {
            const vehiclesWithImages = await Promise.all(rows.map(getVehicleImages));
            resolve(vehiclesWithImages);
          }
        }
      );
    });

    const totalPages = Math.ceil(count.total / limit);

    res.render("inventory", {
      vehicles,
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      currentStatus,
      currentSort,
    });
  } catch (error) {
    console.error("Error fetching vehicles:", error);
    res.status(500).send("Database error");
  }
});

app.post("/add-vehicle", upload.array("images"), async (req, res) => {
  try {
    // Log the form data to see what we're receiving
    console.log("Form data received:", req.body);
    console.log("Files received:", req.files);

    // Get form data with default values
    const { title, year, make, model, price, mileage, trim, vin, engine, transmission, drivetrain, title_status, status = "available" } = req.body;

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
        await s3.upload(getS3Params(`${images_folder}/${i + 1}.jpg`, processedImage)).promise();
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
        drivetrain, title_status, status, images_folder
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [title, year, make, model, trim, price, mileage, vin, engine, transmission, drivetrain, title_status, status, images_folder]
    );

    console.log("Insert successful:", result);
    res.redirect("/admin?success=true");
  } catch (error) {
    console.error("Error adding vehicle:", error);
    res.redirect("/admin?error=true");
  }
});

// Add delete route
app.post("/delete-vehicle/:id", async (req, res) => {
  try {
    // 1. Get vehicle info for DO Spaces folder name
    const vehicle = await new Promise((resolve, reject) => {
      db.get("SELECT images_folder FROM vehicles WHERE id = ?", [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vehicle) {
      console.log("Vehicle not found in database");
      throw new Error("Vehicle not found");
    }

    // 2. Delete images from DO Spaces
    const listParams = {
      Bucket: "wholesalecars",
      Prefix: vehicle.images_folder + "/",
    };

    // List and delete objects
    const listedObjects = await s3.listObjectsV2(listParams).promise();

    if (listedObjects.Contents.length > 0) {
      console.log(`Deleting ${listedObjects.Contents.length} files from ${vehicle.images_folder}`);

      await s3
        .deleteObjects({
          Bucket: "wholesalecars",
          Delete: {
            Objects: listedObjects.Contents.map(({ Key }) => ({ Key })),
          },
        })
        .promise();
    }

    // 3. Delete from database
    await new Promise((resolve, reject) => {
      db.run("DELETE FROM vehicles WHERE id = ?", [req.params.id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`Vehicle ${vehicle.images_folder} deleted successfully`);
    res.redirect("/admin?deleted=true");
  } catch (error) {
    console.error("Delete error:", error);
    res.redirect("/admin?error=delete_failed");
  }
});

// Add get vehicle data route
app.get("/get-vehicle/:id", basicAuth, async (req, res) => {
  try {
    const vehicle = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM vehicles WHERE id = ?", [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vehicle) {
      return res.status(404).json({ error: "Vehicle not found" });
    }

    res.json(vehicle);
  } catch (error) {
    console.error("Error fetching vehicle:", error);
    res.status(500).json({ error: "Database error" });
  }
});

// Add update vehicle route
app.post("/update-vehicle/:id", basicAuth, async (req, res) => {
  try {
    const { title, year, make, model, trim, price, mileage, vin, engine, transmission, drivetrain, title_status, status } = req.body;

    // Validate required fields
    if (!title || !year || !make || !model || !price || !mileage) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Update vehicle in database
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE vehicles SET 
          title = ?, year = ?, make = ?, model = ?, trim = ?,
          price = ?, mileage = ?, vin = ?, engine = ?, transmission = ?,
          drivetrain = ?, title_status = ?, status = ?
          WHERE id = ?`,
        [title, year, make, model, trim, price, mileage, vin, engine, transmission, drivetrain, title_status, status, req.params.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error updating vehicle:", error);
    res.status(500).json({ error: "Database error" });
  }
});

// Add image management route
app.post("/manage-images/:vehicleId", basicAuth, upload.array("newImages"), async (req, res) => {
  try {
    console.log("Received image management request for vehicle:", req.params.vehicleId);
    console.log("Request body:", req.body);
    console.log("Files received:", req.files?.length || 0);

    const { vehicleId } = req.params;
    // Fix deletion array handling
    const deletedImages = Array.isArray(req.body.deletedImages)
      ? req.body.deletedImages
      : req.body["deletedImages[]"]
      ? Array.isArray(req.body["deletedImages[]"])
        ? req.body["deletedImages[]"]
        : [req.body["deletedImages[]"]]
      : [];

    const imageOrder = req.body.imageOrder ? JSON.parse(req.body.imageOrder) : null;

    console.log("Parsed data:");
    console.log("- Deleted images:", deletedImages);
    console.log("- Image order:", imageOrder);

    // Get vehicle folder name
    const vehicle = await new Promise((resolve, reject) => {
      db.get("SELECT images_folder FROM vehicles WHERE id = ?", [vehicleId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vehicle) {
      console.error("Vehicle not found:", vehicleId);
      return res.status(404).json({ error: "Vehicle not found" });
    }
    console.log("Vehicle folder:", vehicle.images_folder);

    // 1. Handle deletions
    if (deletedImages.length > 0) {
      console.log("Processing deletions...");
      const deletePromises = (Array.isArray(deletedImages) ? deletedImages : [deletedImages]).map(async (imageNum) => {
        try {
          console.log(`Starting deletion of image ${imageNum} from ${vehicle.images_folder}`);
          const deleteResult = await s3
            .deleteObject({
              Bucket: "wholesalecars",
              Key: `${vehicle.images_folder}/${imageNum}.jpg`,
            })
            .promise();
          console.log(`Successfully deleted image ${imageNum}, result:`, deleteResult);
          return deleteResult;
        } catch (err) {
          console.error(`Failed to delete image ${imageNum}:`, err);
          throw new Error(`Failed to delete image ${imageNum}: ${err.message}`);
        }
      });
      const deletionResults = await Promise.all(deletePromises);
      console.log("All deletions processed with results:", deletionResults);
    }

    // 2. Handle reordering
    if (imageOrder && imageOrder.length > 0) {
      console.log("Processing image reordering...");
      try {
        // First, filter out deleted images from the order
        const finalOrder = imageOrder.filter((num) => !deletedImages.includes(num));
        console.log("Final order after removing deleted images:", finalOrder);

        // Skip reordering if we have no images to reorder
        if (finalOrder.length === 0) {
          console.log("No images to reorder after filtering");
          return;
        }

        // Get all current images
        const currentImages = await s3
          .listObjectsV2({
            Bucket: "wholesalecars",
            Prefix: `${vehicle.images_folder}/`,
          })
          .promise();

        if (!currentImages.Contents || currentImages.Contents.length === 0) {
          throw new Error("No images found to reorder");
        }

        console.log(
          "Current images:",
          currentImages.Contents.map((obj) => obj.Key)
        );

        // Create a map of temporary names to avoid conflicts
        const tempNames = new Map();
        for (let i = 0; i < finalOrder.length; i++) {
          tempNames.set(finalOrder[i], `temp_${i}`);
        }
        console.log("Temporary names mapping:", Object.fromEntries(tempNames));

        // First rename all to temporary names
        for (const [oldNum, tempNum] of tempNames.entries()) {
          try {
            console.log(`Renaming ${oldNum}.jpg to ${tempNum}.jpg (temp)`);
            await s3
              .copyObject({
                Bucket: "wholesalecars",
                CopySource: `wholesalecars/${vehicle.images_folder}/${oldNum}.jpg`,
                Key: `${vehicle.images_folder}/${tempNum}.jpg`,
                ACL: "public-read",
                CacheControl: "no-cache, no-store, must-revalidate",
                Expires: 0,
                MetadataDirective: "REPLACE",
              })
              .promise();

            await s3
              .deleteObject({
                Bucket: "wholesalecars",
                Key: `${vehicle.images_folder}/${oldNum}.jpg`,
              })
              .promise();
          } catch (err) {
            console.error(`Failed to rename image ${oldNum} to temp:`, err);
            throw new Error(`Failed to rename image ${oldNum} to temp: ${err.message}`);
          }
        }

        // Then rename to final positions
        for (let i = 0; i < finalOrder.length; i++) {
          try {
            const tempNum = tempNames.get(finalOrder[i]);
            console.log(`Renaming ${tempNum}.jpg to ${i + 1}.jpg (final)`);
            await s3
              .copyObject({
                Bucket: "wholesalecars",
                CopySource: `wholesalecars/${vehicle.images_folder}/${tempNum}.jpg`,
                Key: `${vehicle.images_folder}/${i + 1}.jpg`,
                ContentType: "image/jpeg",
                ACL: "public-read",
                CacheControl: "no-cache, no-store, must-revalidate",
                Expires: 0,
                MetadataDirective: "REPLACE",
              })
              .promise();

            await s3
              .deleteObject({
                Bucket: "wholesalecars",
                Key: `${vehicle.images_folder}/${tempNum}.jpg`,
              })
              .promise();
          } catch (err) {
            console.error(`Failed to rename temp image to final position:`, err);
            throw new Error(`Failed to rename temp image to final position: ${err.message}`);
          }
        }
        console.log("Reordering complete");
      } catch (err) {
        console.error("Failed to reorder images:", err);
        throw new Error(`Failed to reorder images: ${err.message}`);
      }
    }

    // 3. Handle new images
    if (req.files && req.files.length > 0) {
      console.log("Processing new images...");
      // Get list of existing images
      const existingImages = await s3
        .listObjectsV2({
          Bucket: "wholesalecars",
          Prefix: `${vehicle.images_folder}/`,
        })
        .promise();

      // Find next available image number
      let nextImageNum = 1;
      if (existingImages.Contents.length > 0) {
        const existingNums = existingImages.Contents.map((obj) => parseInt(obj.Key.split("/").pop().split(".")[0])).filter((num) => !isNaN(num));
        nextImageNum = Math.max(...existingNums) + 1;
      }
      console.log("Next image number:", nextImageNum);

      // Upload new images
      for (const file of req.files) {
        try {
          console.log(`Processing new image ${file.originalname}`);
          const processedImage = await sharp(file.buffer)
            .jpeg({ quality: 80 })
            .resize(1200, null, {
              withoutEnlargement: true,
              fit: "inside",
            })
            .toBuffer();

          await s3.upload(getS3Params(`${vehicle.images_folder}/${nextImageNum}.jpg`, processedImage)).promise();
          console.log(`Successfully uploaded new image as ${nextImageNum}.jpg`);

          nextImageNum++;
        } catch (err) {
          console.error(`Failed to process/upload new image:`, err);
          throw new Error(`Failed to upload new image: ${err.message}`);
        }
      }
      console.log("All new images processed");
    }

    console.log("All operations completed successfully");
    res.json({
      success: true,
      message: "Images updated successfully",
    });
  } catch (error) {
    console.error("Error managing images:", error);
    res.status(500).json({
      error: "Image management failed",
      details: error.message,
    });
  }
});

// Add get vehicle images route
app.get("/get-vehicle-images/:vehicleId", basicAuth, async (req, res) => {
  try {
    const vehicle = await new Promise((resolve, reject) => {
      db.get("SELECT images_folder FROM vehicles WHERE id = ?", [req.params.vehicleId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vehicle) {
      return res.status(404).json({ error: "Vehicle not found" });
    }

    const vehicleWithImages = await getVehicleImages(vehicle);
    res.json({ images: vehicleWithImages.images });
  } catch (error) {
    console.error("Error fetching vehicle images:", error);
    res.status(500).json({ error: "Failed to fetch images" });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
