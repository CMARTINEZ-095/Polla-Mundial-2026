const path = require("path");
require("dotenv").config();

const config = {
  appName: process.env.APP_NAME || "Polla Mundial 2026",
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || "dev-cambia-este-secreto",
  timezone: process.env.TIMEZONE || "America/Bogota",
  databaseUrl: process.env.DATABASE_URL || "",
  databaseSsl: process.env.DATABASE_SSL,
  dataFile: process.env.DATA_FILE || path.join(__dirname, "..", "data", "db.json"),
  adminEmail: (process.env.ADMIN_EMAIL || "admin@demo.com").toLowerCase().trim(),
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  adminName: process.env.ADMIN_NAME || "Administrador"
};

module.exports = config;
