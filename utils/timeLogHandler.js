const fs = require("fs").promises;
const path = require("path");

const LOG_FILE = path.join(__dirname, "../data/time_logs.json");
const ONE_MONTH_IN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

async function readLogs() {
  try {
    const data = await fs.readFile(LOG_FILE, "utf8");
    let logs = JSON.parse(data);
    // Filter out logs older than 1 month when reading
    const oneMonthAgo = new Date(Date.now() - ONE_MONTH_IN_MS);
    logs = logs.filter((log) => new Date(log.clockIn) >= oneMonthAgo);
    return logs;
  } catch (error) {
    if (error.code === "ENOENT") {
      // File not found, return empty array
      return [];
    }
    console.error("Error reading time logs:", error);
    return [];
  }
}

async function writeLogs(logs) {
  try {
    // Filter out logs older than 1 month before writing, to keep the file clean
    const oneMonthAgo = new Date(Date.now() - ONE_MONTH_IN_MS);
    const filteredLogs = logs.filter((log) => new Date(log.clockIn) >= oneMonthAgo);
    await fs.writeFile(LOG_FILE, JSON.stringify(filteredLogs, null, 2), "utf8");
  } catch (error) {
    console.error("Error writing time logs:", error);
    throw error;
  }
}

module.exports = {
  readLogs,
  writeLogs,
};
