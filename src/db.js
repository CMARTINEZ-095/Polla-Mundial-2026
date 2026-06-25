const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const config = require("./config");
const { GROUP_STAGE_FIXTURES } = require("./fixtures");
const { normalizeEmail, pointsForPrediction } = require("./utils");

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    password_hash: row.password_hash,
    role: row.role,
    created_at: toIso(row.created_at)
  };
}

function normalizeMatch(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    group_name: row.group_name || "",
    home_team: row.home_team,
    away_team: row.away_team,
    kickoff_at: toIso(row.kickoff_at),
    venue: row.venue || "",
    status: row.status || "scheduled",
    home_score: row.home_score === null || row.home_score === undefined ? null : Number(row.home_score),
    away_score: row.away_score === null || row.away_score === undefined ? null : Number(row.away_score),
    external_fixture_id: row.external_fixture_id || null,
    match_key: row.match_key || null,
    auto_update: row.auto_update === undefined ? true : Boolean(row.auto_update),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

function normalizePrediction(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    match_id: Number(row.match_id),
    home_score: Number(row.home_score),
    away_score: Number(row.away_score),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

function leaderboardSort(a, b) {
  return b.points - a.points || b.exacts - a.exacts || (b.outcomes || 0) - (a.outcomes || 0) || b.predictions_checked - a.predictions_checked || a.name.localeCompare(b.name, "es");
}

class JsonDatabase {
  constructor(appConfig) {
    this.filePath = appConfig.dataFile;
    this.appConfig = appConfig;
    this.data = null;
  }

  async init() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (fs.existsSync(this.filePath)) {
      this.data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } else {
      this.data = this.blankData();
      this.save();
    }

    this.data.meta = this.data.meta || { nextIds: {} };
    this.data.users = this.data.users || [];
    this.data.matches = this.data.matches || [];
    this.data.predictions = this.data.predictions || [];
    this.ensureNextIds();

    await this.seedAdmin();
    await this.seedMatches();
    this.save();
  }

  blankData() {
    return {
      meta: {
        nextIds: { users: 1, matches: 1, predictions: 1 }
      },
      users: [],
      matches: [],
      predictions: []
    };
  }

  ensureNextIds() {
    const nextIds = this.data.meta.nextIds || {};
    for (const key of ["users", "matches", "predictions"]) {
      const maxId = this.data[key].reduce((max, row) => Math.max(max, Number(row.id || 0)), 0);
      nextIds[key] = Math.max(Number(nextIds[key] || 1), maxId + 1);
    }
    this.data.meta.nextIds = nextIds;
  }

  save() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  nextId(collection) {
    const id = this.data.meta.nextIds[collection] || 1;
    this.data.meta.nextIds[collection] = id + 1;
    return id;
  }

  async seedAdmin() {
    const email = normalizeEmail(this.appConfig.adminEmail);
    const existing = await this.getUserByEmail(email);
    if (existing) {
      if (existing.role !== "admin") {
        const index = this.data.users.findIndex((user) => user.id === existing.id);
        this.data.users[index].role = "admin";
      }
      return existing;
    }

    const passwordHash = await bcrypt.hash(this.appConfig.adminPassword, 10);
    return this.createUser({
      name: this.appConfig.adminName,
      email,
      passwordHash,
      role: "admin"
    });
  }

  async seedMatches() {
    const allowedKeys = new Set(GROUP_STAGE_FIXTURES.map((fixture) => fixture.matchKey));
    this.data.matches = this.data.matches.filter((match) => !match.match_key || allowedKeys.has(match.match_key));
    const now = new Date().toISOString();

    for (const fixture of GROUP_STAGE_FIXTURES) {
      const existing = this.data.matches.find((match) => match.match_key === fixture.matchKey);
      if (existing) {
        Object.assign(existing, {
          group_name: fixture.groupName,
          home_team: fixture.homeTeam,
          away_team: fixture.awayTeam,
          kickoff_at: new Date(fixture.kickoffAt).toISOString(),
          venue: fixture.venue || existing.venue || "",
          auto_update: true,
          updated_at: now
        });
      } else {
        this.data.matches.push({
          id: this.nextId("matches"),
          group_name: fixture.groupName,
          home_team: fixture.homeTeam,
          away_team: fixture.awayTeam,
          kickoff_at: new Date(fixture.kickoffAt).toISOString(),
          venue: fixture.venue || "",
          status: "scheduled",
          home_score: null,
          away_score: null,
          external_fixture_id: null,
          match_key: fixture.matchKey,
          auto_update: true,
          created_at: now,
          updated_at: now
        });
      }
    }

    const matchIds = new Set(this.data.matches.map((match) => Number(match.id)));
    this.data.predictions = this.data.predictions.filter((prediction) => matchIds.has(Number(prediction.match_id)));
  }

  async getUserByEmail(email) {
    const normalized = normalizeEmail(email);
    return normalizeUser(this.data.users.find((user) => user.email === normalized));
  }

  async getUserById(id) {
    return normalizeUser(this.data.users.find((user) => Number(user.id) === Number(id)));
  }

  async listUsers() {
    return this.data.users
      .map(normalizeUser)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  async createUser({ name, email, passwordHash, role = "user" }) {
    const normalized = normalizeEmail(email);
    if (await this.getUserByEmail(normalized)) {
      throw new Error("Ya existe un usuario con ese correo.");
    }
    const now = new Date().toISOString();
    const user = {
      id: this.nextId("users"),
      name,
      email: normalized,
      password_hash: passwordHash,
      role,
      created_at: now
    };
    this.data.users.push(user);
    this.save();
    return normalizeUser(user);
  }

  async updateUserPassword(userId, passwordHash) {
    const user = this.data.users.find((item) => Number(item.id) === Number(userId));
    if (!user) throw new Error("Usuario no encontrado.");
    user.password_hash = passwordHash;
    this.save();
    return normalizeUser(user);
  }

  async listMatches() {
    return this.data.matches
      .map(normalizeMatch)
      .sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at) || a.id - b.id);
  }

  async getMatch(id) {
    return normalizeMatch(this.data.matches.find((match) => Number(match.id) === Number(id)));
  }

  async createMatch(data) {
    const now = new Date().toISOString();
    const match = {
      id: this.nextId("matches"),
      group_name: data.group_name || "",
      home_team: data.home_team,
      away_team: data.away_team,
      kickoff_at: new Date(data.kickoff_at).toISOString(),
      venue: data.venue || "",
      status: data.status || "scheduled",
      home_score: data.home_score === undefined ? null : data.home_score,
      away_score: data.away_score === undefined ? null : data.away_score,
      external_fixture_id: data.external_fixture_id || null,
      match_key: data.match_key || null,
      auto_update: data.auto_update === undefined ? false : Boolean(data.auto_update),
      created_at: now,
      updated_at: now
    };
    this.data.matches.push(match);
    this.save();
    return normalizeMatch(match);
  }

  async updateMatch(id, data) {
    const match = this.data.matches.find((item) => Number(item.id) === Number(id));
    if (!match) throw new Error("Partido no encontrado.");

    Object.assign(match, {
      group_name: data.group_name ?? match.group_name,
      home_team: data.home_team ?? match.home_team,
      away_team: data.away_team ?? match.away_team,
      kickoff_at: data.kickoff_at ? new Date(data.kickoff_at).toISOString() : match.kickoff_at,
      venue: data.venue ?? match.venue,
      status: data.status ?? match.status,
      home_score: data.home_score === undefined ? match.home_score : data.home_score,
      away_score: data.away_score === undefined ? match.away_score : data.away_score,
      external_fixture_id: data.external_fixture_id === undefined ? match.external_fixture_id : data.external_fixture_id,
      match_key: data.match_key === undefined ? match.match_key : data.match_key,
      auto_update: data.auto_update === undefined ? match.auto_update : Boolean(data.auto_update),
      updated_at: new Date().toISOString()
    });

    if (match.home_score !== null && match.away_score !== null && data.status === undefined) {
      match.status = "finished";
    }

    this.save();
    return normalizeMatch(match);
  }

  async deleteMatch(id) {
    const before = this.data.matches.length;
    this.data.matches = this.data.matches.filter((match) => Number(match.id) !== Number(id));
    this.data.predictions = this.data.predictions.filter((prediction) => Number(prediction.match_id) !== Number(id));
    this.save();
    return before !== this.data.matches.length;
  }

  async listPredictionsByUser(userId) {
    return this.data.predictions
      .filter((prediction) => Number(prediction.user_id) === Number(userId))
      .map(normalizePrediction);
  }

  async getPrediction(userId, matchId) {
    return normalizePrediction(this.data.predictions.find((prediction) => Number(prediction.user_id) === Number(userId) && Number(prediction.match_id) === Number(matchId)));
  }

  async upsertPrediction(userId, matchId, homeScore, awayScore) {
    const now = new Date().toISOString();
    let prediction = this.data.predictions.find((item) => Number(item.user_id) === Number(userId) && Number(item.match_id) === Number(matchId));
    if (prediction) {
      prediction.home_score = homeScore;
      prediction.away_score = awayScore;
      prediction.updated_at = now;
    } else {
      prediction = {
        id: this.nextId("predictions"),
        user_id: Number(userId),
        match_id: Number(matchId),
        home_score: homeScore,
        away_score: awayScore,
        created_at: now,
        updated_at: now
      };
      this.data.predictions.push(prediction);
    }
    this.save();
    return normalizePrediction(prediction);
  }

  async getLeaderboard() {
    const nonAdminUsers = this.data.users.filter((user) => user.role !== "admin");
    const matchesById = new Map(this.data.matches.map((match) => [Number(match.id), match]));

    return nonAdminUsers.map((user) => {
      const userPredictions = this.data.predictions.filter((prediction) => Number(prediction.user_id) === Number(user.id));
      let points = 0;
      let exacts = 0;
      let outcomes = 0;
      let predictionsChecked = 0;

      for (const prediction of userPredictions) {
        const match = matchesById.get(Number(prediction.match_id));
        if (!match || match.home_score === null || match.away_score === null) continue;
        predictionsChecked += 1;
        const earned = pointsForPrediction(prediction, match);
        points += earned;
        if (earned === 3) {
          exacts += 1;
        } else if (earned === 1) {
          outcomes += 1;
        }
      }

      return {
        id: Number(user.id),
        name: user.name,
        email: user.email,
        points,
        exacts,
        outcomes,
        predictions_checked: predictionsChecked,
        total_predictions: userPredictions.length
      };
    }).sort(leaderboardSort);
  }

  async listAllPredictionsDetailed() {
  return this.data.predictions.map((prediction) => {
    const user = this.data.users.find((u) => Number(u.id) === Number(prediction.user_id));
    const match = this.data.matches.find((m) => Number(m.id) === Number(prediction.match_id));
    return {
      user_name: user?.name || "",
      user_email: user?.email || "",
      match_id: match ? Number(match.id) : null,
      group_name: match?.group_name || "",
      home_team: match?.home_team || "",
      away_team: match?.away_team || "",
      kickoff_at: match?.kickoff_at || "",
      prediction_home_score: prediction.home_score,
      prediction_away_score: prediction.away_score,
      real_home_score: match?.home_score ?? null,
      real_away_score: match?.away_score ?? null,
      points: match ? pointsForPrediction(prediction, match) : null
    };
  }).sort((a, b) => new Date(a.kickoff_at) - new Date(b.kickoff_at) || a.user_name.localeCompare(b.user_name, "es"));

  
}
  async getStatsSummary() {
    const players = this.data.users.filter((user) => user.role !== "admin").length;
    const totalMatches = this.data.matches.length;
    const completedMatches = this.data.matches.filter((match) => match.home_score !== null && match.away_score !== null).length;
    return {
      players,
      total_matches: totalMatches,
      completed_matches: completedMatches,
      total_predictions: this.data.predictions.length
    };
  }
}

class PgDatabase {
  constructor(appConfig) {
    this.appConfig = appConfig;
    const isLocal = /localhost|127\.0\.0\.1/.test(appConfig.databaseUrl);
    const explicitSsl = appConfig.databaseSsl;
    let ssl = undefined;
    if (explicitSsl === "true") {
      ssl = { rejectUnauthorized: false };
    } else if (explicitSsl === "false") {
      ssl = false;
    } else if (!isLocal && process.env.NODE_ENV === "production") {
      ssl = { rejectUnauthorized: false };
    }

    this.pool = new Pool({
      connectionString: appConfig.databaseUrl,
      ssl
    });
  }

  async init() {
    await this.migrate();
    await this.seedAdmin();
    await this.seedMatches();
  }

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        group_name TEXT DEFAULT '',
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        kickoff_at TIMESTAMPTZ NOT NULL,
        venue TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'scheduled',
        home_score INTEGER,
        away_score INTEGER,
        external_fixture_id TEXT,
        match_key TEXT UNIQUE,
        auto_update BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS predictions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        home_score INTEGER NOT NULL CHECK (home_score >= 0 AND home_score <= 30),
        away_score INTEGER NOT NULL CHECK (away_score >= 0 AND away_score <= 30),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, match_id)
      );

      ALTER TABLE matches ADD COLUMN IF NOT EXISTS external_fixture_id TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_key TEXT;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS auto_update BOOLEAN NOT NULL DEFAULT TRUE;
      DROP INDEX IF EXISTS idx_matches_match_key;
      CREATE UNIQUE INDEX idx_matches_match_key ON matches(match_key);
      CREATE INDEX IF NOT EXISTS idx_matches_kickoff_at ON matches(kickoff_at);
      CREATE INDEX IF NOT EXISTS idx_predictions_user_id ON predictions(user_id);
      CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id);
    `);
  }

  async seedAdmin() {
    const email = normalizeEmail(this.appConfig.adminEmail);
    const existing = await this.getUserByEmail(email);
    if (existing) {
      if (existing.role !== "admin") {
        await this.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [existing.id]);
      }
      return existing;
    }

    const passwordHash = await bcrypt.hash(this.appConfig.adminPassword, 10);
    return this.createUser({
      name: this.appConfig.adminName,
      email,
      passwordHash,
      role: "admin"
    });
  }

  async seedMatches() {
    const keys = GROUP_STAGE_FIXTURES.map((fixture) => fixture.matchKey);
    await this.pool.query(
      "DELETE FROM matches WHERE match_key IS NOT NULL AND NOT (match_key = ANY($1::text[]))",
      [keys]
    );

    for (const fixture of GROUP_STAGE_FIXTURES) {
      await this.pool.query(
        `INSERT INTO matches (group_name, home_team, away_team, kickoff_at, venue, status, home_score, away_score, match_key, auto_update)
         VALUES ($1, $2, $3, $4, $5, 'scheduled', NULL, NULL, $6, TRUE)
         ON CONFLICT (match_key)
         DO UPDATE SET group_name = EXCLUDED.group_name,
                       home_team = EXCLUDED.home_team,
                       away_team = EXCLUDED.away_team,
                       kickoff_at = EXCLUDED.kickoff_at,
                       venue = EXCLUDED.venue,
                       auto_update = TRUE,
                       updated_at = NOW()`,
        [fixture.groupName, fixture.homeTeam, fixture.awayTeam, new Date(fixture.kickoffAt).toISOString(), fixture.venue || "", fixture.matchKey]
      );
    }
  }

  async getUserByEmail(email) {
    const result = await this.pool.query("SELECT * FROM users WHERE email = $1", [normalizeEmail(email)]);
    return normalizeUser(result.rows[0]);
  }

  async getUserById(id) {
    const result = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return normalizeUser(result.rows[0]);
  }

  async listUsers() {
    const result = await this.pool.query("SELECT * FROM users ORDER BY name ASC");
    return result.rows.map(normalizeUser);
  }

  async createUser({ name, email, passwordHash, role = "user" }) {
    const result = await this.pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *",
      [name, normalizeEmail(email), passwordHash, role]
    );
    return normalizeUser(result.rows[0]);
  }

  async updateUserPassword(userId, passwordHash) {
    const result = await this.pool.query("UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *", [passwordHash, userId]);
    if (!result.rows[0]) throw new Error("Usuario no encontrado.");
    return normalizeUser(result.rows[0]);
  }

  async listMatches() {
    const result = await this.pool.query("SELECT * FROM matches ORDER BY kickoff_at ASC, id ASC");
    return result.rows.map(normalizeMatch);
  }

  async getMatch(id) {
    const result = await this.pool.query("SELECT * FROM matches WHERE id = $1", [id]);
    return normalizeMatch(result.rows[0]);
  }

  async createMatch(data) {
    const result = await this.pool.query(
      `INSERT INTO matches (group_name, home_team, away_team, kickoff_at, venue, status, home_score, away_score, external_fixture_id, match_key, auto_update)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.group_name || "",
        data.home_team,
        data.away_team,
        data.kickoff_at,
        data.venue || "",
        data.status || "scheduled",
        data.home_score ?? null,
        data.away_score ?? null,
        data.external_fixture_id || null,
        data.match_key || null,
        data.auto_update === undefined ? false : Boolean(data.auto_update)
      ]
    );
    return normalizeMatch(result.rows[0]);
  }

  async updateMatch(id, data) {
    const existing = await this.getMatch(id);
    if (!existing) throw new Error("Partido no encontrado.");

    const next = {
      group_name: data.group_name ?? existing.group_name,
      home_team: data.home_team ?? existing.home_team,
      away_team: data.away_team ?? existing.away_team,
      kickoff_at: data.kickoff_at ?? existing.kickoff_at,
      venue: data.venue ?? existing.venue,
      status: data.status ?? existing.status,
      home_score: data.home_score === undefined ? existing.home_score : data.home_score,
      away_score: data.away_score === undefined ? existing.away_score : data.away_score,
      external_fixture_id: data.external_fixture_id === undefined ? existing.external_fixture_id : data.external_fixture_id,
      match_key: data.match_key === undefined ? existing.match_key : data.match_key,
      auto_update: data.auto_update === undefined ? existing.auto_update : Boolean(data.auto_update)
    };

    if (next.home_score !== null && next.away_score !== null && data.status === undefined) {
      next.status = "finished";
    }

    const result = await this.pool.query(
      `UPDATE matches
       SET group_name = $1,
           home_team = $2,
           away_team = $3,
           kickoff_at = $4,
           venue = $5,
           status = $6,
           home_score = $7,
           away_score = $8,
           external_fixture_id = $9,
           match_key = $10,
           auto_update = $11,
           updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [next.group_name, next.home_team, next.away_team, next.kickoff_at, next.venue, next.status, next.home_score, next.away_score, next.external_fixture_id, next.match_key, next.auto_update, id]
    );
    return normalizeMatch(result.rows[0]);
  }

  async deleteMatch(id) {
    const result = await this.pool.query("DELETE FROM matches WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async listPredictionsByUser(userId) {
    const result = await this.pool.query("SELECT * FROM predictions WHERE user_id = $1", [userId]);
    return result.rows.map(normalizePrediction);
  }

  async getPrediction(userId, matchId) {
    const result = await this.pool.query("SELECT * FROM predictions WHERE user_id = $1 AND match_id = $2", [userId, matchId]);
    return normalizePrediction(result.rows[0]);
  }

  async upsertPrediction(userId, matchId, homeScore, awayScore) {
    const result = await this.pool.query(
      `INSERT INTO predictions (user_id, match_id, home_score, away_score)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, match_id)
       DO UPDATE SET home_score = EXCLUDED.home_score,
                     away_score = EXCLUDED.away_score,
                     updated_at = NOW()
       RETURNING *`,
      [userId, matchId, homeScore, awayScore]
    );
    return normalizePrediction(result.rows[0]);
  }

  async getLeaderboard() {
    const result = await this.pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        COALESCE(SUM(CASE
          WHEN p.id IS NOT NULL
           AND m.home_score IS NOT NULL
           AND m.away_score IS NOT NULL
           AND p.home_score = m.home_score
           AND p.away_score = m.away_score
          THEN 3
          WHEN p.id IS NOT NULL
           AND m.home_score IS NOT NULL
           AND m.away_score IS NOT NULL
           AND (CASE WHEN p.home_score > p.away_score THEN 'H' WHEN p.home_score < p.away_score THEN 'A' ELSE 'D' END) =
               (CASE WHEN m.home_score > m.away_score THEN 'H' WHEN m.home_score < m.away_score THEN 'A' ELSE 'D' END)
          THEN 1
          ELSE 0 END), 0)::int AS points,
        COALESCE(SUM(CASE
          WHEN p.id IS NOT NULL
           AND m.home_score IS NOT NULL
           AND m.away_score IS NOT NULL
           AND p.home_score = m.home_score
           AND p.away_score = m.away_score
          THEN 1 ELSE 0 END), 0)::int AS exacts,
        COALESCE(SUM(CASE
          WHEN p.id IS NOT NULL
           AND m.home_score IS NOT NULL
           AND m.away_score IS NOT NULL
           AND NOT (p.home_score = m.home_score AND p.away_score = m.away_score)
           AND (CASE WHEN p.home_score > p.away_score THEN 'H' WHEN p.home_score < p.away_score THEN 'A' ELSE 'D' END) =
               (CASE WHEN m.home_score > m.away_score THEN 'H' WHEN m.home_score < m.away_score THEN 'A' ELSE 'D' END)
          THEN 1 ELSE 0 END), 0)::int AS outcomes,
        COALESCE(SUM(CASE
          WHEN p.id IS NOT NULL
           AND m.home_score IS NOT NULL
           AND m.away_score IS NOT NULL
          THEN 1 ELSE 0 END), 0)::int AS predictions_checked,
        COUNT(p.id)::int AS total_predictions
      FROM users u
      LEFT JOIN predictions p ON p.user_id = u.id
      LEFT JOIN matches m ON m.id = p.match_id
      WHERE u.role <> 'admin'
      GROUP BY u.id
      ORDER BY points DESC, exacts DESC, outcomes DESC, predictions_checked DESC, u.name ASC
    `);

    return result.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      email: row.email,
      points: Number(row.points),
      exacts: Number(row.exacts),
      outcomes: Number(row.outcomes),
      predictions_checked: Number(row.predictions_checked),
      total_predictions: Number(row.total_predictions)
    }));
  }
  
  async listAllPredictionsDetailed() {
  const result = await this.pool.query(`
    SELECT
      u.name AS user_name,
      u.email AS user_email,
      m.id AS match_id,
      m.group_name,
      m.home_team,
      m.away_team,
      m.kickoff_at,
      p.home_score AS prediction_home_score,
      p.away_score AS prediction_away_score,
      m.home_score AS real_home_score,
      m.away_score AS real_away_score,
      CASE
        WHEN m.home_score IS NULL OR m.away_score IS NULL THEN NULL
        WHEN p.home_score = m.home_score AND p.away_score = m.away_score THEN 3
        WHEN
          (CASE WHEN p.home_score > p.away_score THEN 'H' WHEN p.home_score < p.away_score THEN 'A' ELSE 'D' END) =
          (CASE WHEN m.home_score > m.away_score THEN 'H' WHEN m.home_score < m.away_score THEN 'A' ELSE 'D' END)
        THEN 1
        ELSE 0
      END AS points
    FROM predictions p
    JOIN users u ON u.id = p.user_id
    JOIN matches m ON m.id = p.match_id
    ORDER BY m.kickoff_at ASC, u.name ASC
  `);

  return result.rows;
}
  async getStatsSummary() {
    const result = await this.pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE role <> 'admin') AS players,
        (SELECT COUNT(*)::int FROM matches) AS total_matches,
        (SELECT COUNT(*)::int FROM matches WHERE home_score IS NOT NULL AND away_score IS NOT NULL) AS completed_matches,
        (SELECT COUNT(*)::int FROM predictions) AS total_predictions
    `);
    return {
      players: Number(result.rows[0].players),
      total_matches: Number(result.rows[0].total_matches),
      completed_matches: Number(result.rows[0].completed_matches),
      total_predictions: Number(result.rows[0].total_predictions)
    };
  }
}

const db = config.databaseUrl ? new PgDatabase(config) : new JsonDatabase(config);



module.exports = db;
