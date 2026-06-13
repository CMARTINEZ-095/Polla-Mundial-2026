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
  adminName: process.env.ADMIN_NAME || "Administrador",
  apiFootballKey: process.env.API_FOOTBALL_KEY || "",
  apiFootballHost: process.env.API_FOOTBALL_HOST || "v3.football.api-sports.io",
  apiFootballLeagueId: process.env.API_FOOTBALL_LEAGUE_ID || "1",
  apiFootballSeason: process.env.API_FOOTBALL_SEASON || "2026",
  resultsSyncEnabled: String(process.env.RESULTS_SYNC_ENABLED || "true").toLowerCase() !== "false",
  resultsSyncMinutes: Math.max(1, Number(process.env.RESULTS_SYNC_MINUTES || 5))
};

module.exports = config;
