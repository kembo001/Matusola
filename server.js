const express = require("express");
const path = require("path");
const app = express();
const db = require("./database.js"); // This imports and runs database.js

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
  res.render("inventory");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
