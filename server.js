const express = require("express");
const path = require("path");
const app = express();
const db = require("./database.js"); // This imports and runs database.js
const s3 = require("./spaces.js"); // This imports and runs spaces.js - Our media storage
const multer = require("multer");
const upload = multer();
const sharp = require("sharp");
const { DateTime } = require("luxon"); // For timezone handling
require("dotenv").config();

const { readLogs, writeLogs } = require("./utils/timeLogHandler");

const getS3Params = (Key, Body, ContentType = "image/jpeg") => ({
  Bucket: "wholesalecars",
  Key,
  Body,
  ContentType,
  ACL: "public-read",
  CacheControl: "no-cache, no-store, must-revalidate",
  Expires: 0,
});

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

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send("User-agent: *\nDisallow: /admin\nAllow: /\nSitemap: https://wholesalecarsmn.com/sitemap.xml");
});

app.get("/sitemap.xml", (req, res) => {
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

function basicAuth(req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Access"');
    return res.sendStatus(401);
  }

  const credentials = Buffer.from(auth.split(" ")[1], "base64").toString();
  const [username, password] = credentials.split(":");

  if (username === "shoreline" && password === "BigAndBad") {
    next();
  } else {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin Access"');
    return res.sendStatus(401);
  }
}

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

app.get("/clock", basicAuth, async (req, res) => {
  let logs = await readLogs();
  const message = req.query.message ? { text: req.query.message, type: req.query.type || "info" } : null;
  const lastEmployeeName = req.query.employeeName || "";

  const processedLogs = logs
    .map((log) => {
      if (log.clockIn && log.clockOut) {
        const durationMs = new Date(log.clockOut) - new Date(log.clockIn);
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        let minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours === 0 && minutes === 0 && durationMs > 0) {
          minutes = 1;
        }
        log.duration = `${hours}h ${minutes}m`;
      } else {
        log.duration = null;
      }
      return log;
    })
    .sort((a, b) => new Date(b.clockIn) - new Date(a.clockIn));

  const currentlyClocked = processedLogs.filter((log) => log.status === "clocked_in" && !log.clockOut);

  res.render("clock", {
    message,
    lastEmployeeName,
    logs: processedLogs,
    currentlyClocked,
  });
});

app.post("/clock-action", async (req, res) => {
  const { employeeName, action } = req.body;
  const currentTime = new Date().toISOString();

  if (!employeeName || !action) {
    return res.redirect(`/clock?message=Missing+name+or+action&type=error`);
  }

  let logs = await readLogs();
  const employeeLowerCaseName = employeeName.toLowerCase().trim();

  const activeLogIndex = logs.findIndex(
    (log) => log.employeeName.toLowerCase().trim() === employeeLowerCaseName && log.status === "clocked_in" && !log.clockOut
  );

  let messageText = "";
  let messageType = "success";

  if (action === "clock-in") {
    if (activeLogIndex !== -1) {
      messageText = `${employeeName} is already clocked in!`;
      messageType = "error";
    } else {
      logs.push({
        id: Date.now().toString(),
        employeeName: employeeName.trim(),
        clockIn: currentTime,
        clockOut: null,
        status: "clocked_in",
        ip_address: req.ip,
        device_info: req.headers["user-agent"],
      });
      const clockInTimeMN = DateTime.now().setZone("America/Chicago").toLocaleString(DateTime.TIME_SIMPLE);
      messageText = `${employeeName} successfully clocked in at ${clockInTimeMN}!`;
    }
  } else if (action === "clock-out") {
    if (activeLogIndex !== -1) {
      logs[activeLogIndex].clockOut = currentTime;
      logs[activeLogIndex].status = "clocked_out";
      const clockOutTimeMN = DateTime.now().setZone("America/Chicago").toLocaleString(DateTime.TIME_SIMPLE);
      messageText = `${employeeName} successfully clocked out at ${clockOutTimeMN}!`;
    } else {
      messageText = `${employeeName} is not currently clocked in.`;
      messageType = "error";
    }
  } else {
    messageText = "Invalid action.";
    messageType = "error";
  }

  await writeLogs(logs);
  res.redirect(`/clock?employeeName=${encodeURIComponent(employeeName)}&message=${encodeURIComponent(messageText)}&type=${messageType}`);
});

app.get("/calculator", (req, res) => {
  res.render("calculator");
});

app.get("/inventory", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 12;
  const offset = (page - 1) * limit;

  const currentStatus = req.query.status || "available";
  const currentSort = req.query.sort || "newest";

  let whereClause = currentStatus === "all" ? "1=1" : "status = $1";
  let params = currentStatus === "all" ? [] : [currentStatus];

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
    const countResult = await db.query(`SELECT COUNT(*) as total FROM vehicles WHERE ${whereClause}`, params);
    const count = countResult.rows[0];

    const vehiclesResult = await db.query(
      `SELECT * FROM vehicles 
         WHERE ${whereClause}
         ORDER BY ${orderBy}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const vehiclesWithImages = await Promise.all(vehiclesResult.rows.map(getVehicleImages));
    const totalPages = Math.ceil(count.total / limit);

    res.render("inventory", {
      vehicles: vehiclesWithImages,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
