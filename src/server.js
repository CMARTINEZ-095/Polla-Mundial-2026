const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const crypto = require("crypto");

const config = require("./config");
const db = require("./db");
const { syncResultsOnce, startResultsSync } = require("./results-sync");
const {
  normalizeEmail,
  cleanText,
  parsePredictionScores,
  parseNonNegativeInt,
  parseKickoffFromBogotaInput,
  formatDateTime,
  formatTime,
  formatDateGroup,
  toBogotaDateTimeLocal,
  isMatchLocked,
  matchResultLabel,
  pointsForPrediction,
  csvEscape
} = require("./utils");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.locals.config = config;
app.locals.helpers = {
  formatDateTime: (value) => formatDateTime(value, config.timezone),
  formatTime: (value) => formatTime(value, config.timezone),
  formatDateGroup: (value) => formatDateGroup(value, config.timezone),
  toBogotaDateTimeLocal: (value) => toBogotaDateTimeLocal(value, config.timezone),
  matchResultLabel
};

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function generateTemporaryPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const submittedToken = req.body ? req.body._csrf : null;
    if (!submittedToken || submittedToken !== req.session.csrfToken) {
      flash(req, "danger", "La sesion del formulario expiro. Intenta de nuevo.");
      return res.redirect(req.get("referer") || "/");
    }
  }

  next();
});

function groupMatches(matches, predictionsByMatchId = {}) {
  const now = new Date();
  const groups = [];
  const groupMap = new Map();

  for (const match of matches) {
    const label = formatDateGroup(match.kickoff_at, config.timezone);
    if (!groupMap.has(label)) {
      const group = { label, items: [] };
      groupMap.set(label, group);
      groups.push(group);
    }

    const prediction = predictionsByMatchId[match.id] || null;
    groupMap.get(label).items.push({
      match,
      prediction,
      isLocked: isMatchLocked(match, now),
      points: pointsForPrediction(prediction, match)
    });
  }

  return groups;
}

function requireAuth(req, res, next) {
  if (!res.locals.currentUser) {
    flash(req, "warning", "Inicia sesion para continuar.");
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.currentUser || res.locals.currentUser.role !== "admin") {
    flash(req, "danger", "No tienes permisos para entrar a esa seccion.");
    return res.redirect("/");
  }
  next();
}

function parseMatchForm(body) {
  const homeTeam = cleanText(body.home_team);
  const awayTeam = cleanText(body.away_team);
  if (!homeTeam || !awayTeam) {
    throw new Error("Debes escribir los dos equipos.");
  }

  const homeScore = parseNonNegativeInt(body.home_score, "Goles local");
  const awayScore = parseNonNegativeInt(body.away_score, "Goles visitante");
  if ((homeScore === null && awayScore !== null) || (homeScore !== null && awayScore === null)) {
    throw new Error("Para registrar resultado debes escribir los dos marcadores.");
  }

  return {
    group_name: cleanText(body.group_name),
    home_team: homeTeam,
    away_team: awayTeam,
    kickoff_at: parseKickoffFromBogotaInput(body.kickoff_at),
    venue: cleanText(body.venue),
    status: homeScore !== null && awayScore !== null ? "finished" : "scheduled",
    home_score: homeScore,
    away_score: awayScore
  };
}

app.use(async (req, res, next) => {
  try {
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;
    res.locals.currentUser = null;
    if (req.session.userId) {
      const user = await db.getUserById(req.session.userId);
      if (user) {
        res.locals.currentUser = user;
      } else {
        delete req.session.userId;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});

app.get("/", async (req, res, next) => {
  try {
    const [summary, leaderboard, matches] = await Promise.all([
      db.getStatsSummary(),
      db.getLeaderboard(),
      db.listMatches()
    ]);
    const now = new Date();
    const nextMatches = matches.filter((match) => new Date(match.kickoff_at) >= now).slice(0, 8);
    res.render("home", {
      title: "Inicio",
      summary,
      topPlayers: leaderboard.slice(0, 5),
      nextMatches
    });
  } catch (error) {
    next(error);
  }
});

app.get("/rules", (req, res) => {
  res.render("rules", { title: "Reglas" });
});

app.get("/register", (req, res) => {
  res.render("register", { title: "Registro", values: {} });
});

app.post("/register", async (req, res, next) => {
  try {
    const name = cleanText(req.body.name);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      flash(req, "danger", "Nombre, correo y clave son obligatorios.");
      return res.status(400).render("register", { title: "Registro", values: { name, email } });
    }
    if (password.length < 6) {
      flash(req, "danger", "La clave debe tener minimo 6 caracteres.");
      return res.status(400).render("register", { title: "Registro", values: { name, email } });
    }
    if (await db.getUserByEmail(email)) {
      flash(req, "danger", "Ese correo ya esta registrado.");
      return res.status(400).render("register", { title: "Registro", values: { name, email } });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.createUser({ name, email, passwordHash, role: "user" });
    req.session.userId = user.id;
    flash(req, "success", "Cuenta creada. Ya puedes registrar tus marcadores.");
    res.redirect("/predictions");
  } catch (error) {
    next(error);
  }
});

app.get("/login", (req, res) => {
  res.render("login", { title: "Ingresar", nextUrl: req.query.next || "" });
});

app.post("/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const nextUrl = String(req.body.next || "");
    const user = await db.getUserByEmail(email);
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!ok) {
      flash(req, "danger", "Correo o clave incorrectos.");
      return res.status(401).render("login", { title: "Ingresar", nextUrl });
    }

    req.session.userId = user.id;
    flash(req, "success", `Bienvenido, ${user.name}.`);
    res.redirect(nextUrl && nextUrl.startsWith("/") ? nextUrl : "/predictions");
  } catch (error) {
    next(error);
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/account", requireAuth, (req, res) => {
  res.render("account", { title: "Mi cuenta" });
});

app.post("/account/password", requireAuth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body.current_password || "");
    const newPassword = String(req.body.new_password || "");
    const user = await db.getUserById(res.locals.currentUser.id);
    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) {
      flash(req, "danger", "La clave actual no es correcta.");
      return res.redirect("/account");
    }
    if (newPassword.length < 6) {
      flash(req, "danger", "La nueva clave debe tener minimo 6 caracteres.");
      return res.redirect("/account");
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.updateUserPassword(user.id, hash);
    flash(req, "success", "Clave actualizada correctamente.");
    res.redirect("/account");
  } catch (error) {
    next(error);
  }
});

app.get("/predictions", requireAuth, async (req, res, next) => {
  try {
    const [matches, predictions] = await Promise.all([
      db.listMatches(),
      db.listPredictionsByUser(res.locals.currentUser.id)
    ]);
    const predictionsByMatchId = Object.fromEntries(predictions.map((prediction) => [prediction.match_id, prediction]));
    res.render("predictions", {
      title: "Mis pronosticos",
      groups: groupMatches(matches, predictionsByMatchId)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/predictions/:matchId", requireAuth, async (req, res, next) => {
  try {
    const match = await db.getMatch(req.params.matchId);
    if (!match) {
      flash(req, "danger", "Partido no encontrado.");
      return res.redirect("/predictions");
    }
    if (isMatchLocked(match)) {
      flash(req, "warning", "Ese partido ya empezo o esta cerrado. No se puede cambiar el pronostico.");
      return res.redirect("/predictions");
    }

    const { homeScore, awayScore } = parsePredictionScores(req.body.home_score, req.body.away_score);
    await db.upsertPrediction(res.locals.currentUser.id, match.id, homeScore, awayScore);
    flash(req, "success", `Pronostico guardado: ${match.home_team} ${homeScore} - ${awayScore} ${match.away_team}.`);
    res.redirect("/predictions");
  } catch (error) {
    flash(req, "danger", error.message);
    res.redirect("/predictions");
  }
});

app.get("/leaderboard", async (req, res, next) => {
  try {
    const leaderboard = await db.getLeaderboard();
    res.render("leaderboard", { title: "Tabla de posiciones", leaderboard });
  } catch (error) {
    next(error);
  }
});

app.get("/leaderboard.csv", requireAdmin, async (req, res, next) => {
  try {
    const leaderboard = await db.getLeaderboard();
    const rows = [
      ["posicion", "nombre", "correo", "puntos", "marcadores_exactos", "ganador_o_empate", "pronosticos_revisados", "pronosticos_totales"],
      ...leaderboard.map((row, index) => [
        index + 1,
        row.name,
        row.email,
        row.points,
        row.exacts,
        row.outcomes || 0,
        row.predictions_checked,
        row.total_predictions
      ])
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=tabla-polla-mundial-2026.csv");
    res.send(`\ufeff${csv}`);
  } catch (error) {
    next(error);
  }
});

app.post("/admin/sync-results", requireAdmin, async (req, res) => {
  try {
    const result = await syncResultsOnce();
    if (result.skipped) {
      flash(req, "warning", result.message);
    } else {
      flash(req, "success", `Sincronizacion ejecutada. Partidos actualizados: ${result.updates.length}.`);
    }
  } catch (error) {
    flash(req, "danger", error.message);
  }
  res.redirect("/admin");
});

app.get("/admin", requireAdmin, async (req, res, next) => {
  try {
    const [summary, matches] = await Promise.all([db.getStatsSummary(), db.listMatches()]);
    res.render("admin", {
      title: "Administracion",
      summary,
      matches,
      values: {
        group_name: "",
        home_team: "",
        away_team: "",
        kickoff_at: "",
        venue: "",
        home_score: "",
        away_score: ""
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post("/admin/matches", requireAdmin, async (req, res, next) => {
  try {
    const data = parseMatchForm(req.body);
    await db.createMatch(data);
    flash(req, "success", "Partido creado correctamente.");
    res.redirect("/admin");
  } catch (error) {
    flash(req, "danger", error.message);
    res.redirect("/admin");
  }
});
app.post("/admin/matches/:id/result", requireAdmin, async (req, res, next) => {
  try {
    const match = await db.getMatch(req.params.id);

    if (!match) {
      flash(req, "danger", "Partido no encontrado.");
      return res.redirect("/admin");
    }

    const homeScore = parseNonNegativeInt(req.body.home_score, "Goles local");
    const awayScore = parseNonNegativeInt(req.body.away_score, "Goles visitante");

    if ((homeScore === null && awayScore !== null) || (homeScore !== null && awayScore === null)) {
      flash(req, "danger", "Debes escribir los dos marcadores.");
      return res.redirect("/admin");
    }

    await db.updateMatch(req.params.id, {
      group_name: match.group_name,
      home_team: match.home_team,
      away_team: match.away_team,
      kickoff_at: match.kickoff_at,
      venue: match.venue,
      status: homeScore !== null && awayScore !== null ? "finished" : "scheduled",
      home_score: homeScore,
      away_score: awayScore
    });

    flash(req, "success", "Marcador oficial actualizado.");
    res.redirect("/admin");
  } catch (error) {
    flash(req, "danger", error.message);
    res.redirect("/admin");
  }
});
  

app.get("/admin/matches/:id/edit", requireAdmin, async (req, res, next) => {
  try {
    const match = await db.getMatch(req.params.id);
    if (!match) {
      flash(req, "danger", "Partido no encontrado.");
      return res.redirect("/admin");
    }
    res.render("admin-edit-match", { title: "Editar partido", match });
  } catch (error) {
    next(error);
  }
});

app.post("/admin/matches/:id", requireAdmin, async (req, res, next) => {
  try {
    const data = parseMatchForm(req.body);
    await db.updateMatch(req.params.id, data);
    flash(req, "success", "Partido actualizado. La tabla se recalcula automaticamente.");
    res.redirect("/admin");
  } catch (error) {
    flash(req, "danger", error.message);
    res.redirect(`/admin/matches/${req.params.id}/edit`);
  }
});


app.post("/admin/matches/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    await db.deleteMatch(req.params.id);
    flash(req, "success", "Partido eliminado.");
    res.redirect("/admin");
  } catch (error) {
    next(error);
  }
});

app.get("/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const users = await db.listUsers();
    res.render("admin-users", { title: "Usuarios", users });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/users/:id/predictions", requireAdmin, async (req, res, next) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user || user.role === "admin") {
      flash(req, "danger", "Usuario no encontrado.");
      return res.redirect("/admin/users");
    }

    const [matches, predictions] = await Promise.all([
      db.listMatches(),
      db.listPredictionsByUser(user.id)
    ]);
    const predictionsByMatchId = new Map(predictions.map((prediction) => [Number(prediction.match_id), prediction]));
    const rows = matches.map((match) => {
      const prediction = predictionsByMatchId.get(Number(match.id)) || null;
      return {
        match,
        prediction,
        points: pointsForPrediction(prediction, match)
      };
    });

    res.render("admin-user-predictions", {
      title: `Pronósticos de ${user.name}`,
      user,
      rows,
      totalPredictions: predictions.length
    });
  } catch (error) {
    next(error);
  }
});

app.post("/admin/users/:id/password", requireAdmin, async (req, res, next) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) {
      flash(req, "danger", "Usuario no encontrado.");
      return res.redirect("/admin/users");
    }

    const submittedPassword = String(req.body.new_password || "");
    const password = submittedPassword.trim() ? submittedPassword : generateTemporaryPassword();

    if (submittedPassword.trim() && password.length < 6) {
      flash(req, "danger", "La nueva clave debe tener minimo 6 caracteres.");
      return res.redirect("/admin/users");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.updateUserPassword(user.id, passwordHash);

    if (submittedPassword.trim()) {
      flash(req, "success", `Clave actualizada para ${user.name}.`);
    } else {
      flash(req, "warning", `Clave temporal creada para ${user.name}: ${password}`);
    }

    res.redirect("/admin/users");
  } catch (error) {
    next(error);
  }
});

app.get("/public-predictions", requireAuth, async (req, res, next) => {
  try {
    const [matches, predictions] = await Promise.all([
      db.listMatches(),
      db.listAllPredictionsDetailed()
    ]);

    const now = new Date();

    const visibleMatches = matches.map((match) => {
      const locked = isMatchLocked(match, now);

      return {
        match,
        isVisible: locked,
        predictions: locked
          ? predictions.filter((prediction) => Number(prediction.match_id) === Number(match.id))
          : []
      };
    });

    res.render("public-predictions", {
      title: "Pronósticos de participantes",
      visibleMatches
    });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/predictions", requireAdmin, async (req, res, next) => {
  try {
    const predictions = await db.listAllPredictionsDetailed();
    const q = cleanText(req.query.q || "").toLowerCase();

    const filtered = q
      ? predictions.filter((item) => {
          const text = [
            item.user_name,
            item.user_email,
            item.group_name,
            item.home_team,
            item.away_team
          ].join(" ").toLowerCase();

          return text.includes(q);
        })
      : predictions;

    res.render("admin-predictions", {
      title: "Todos los pronósticos",
      predictions: filtered,
      q
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).render("404", { title: "No encontrado" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).render("error", {
    title: "Error",
    message: process.env.NODE_ENV === "production" ? "Ocurrio un error inesperado." : error.message
  });
});

async function start() {
  if (process.env.NODE_ENV === "production" && config.sessionSecret === "dev-cambia-este-secreto") {
    console.warn("ADVERTENCIA: define SESSION_SECRET en produccion.");
  }
  await db.init();
  startResultsSync();
  app.listen(config.port, () => {
    console.log(`${config.appName} escuchando en http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error("No se pudo iniciar la app", error);
  process.exit(1);
});
