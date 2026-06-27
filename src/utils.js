function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizePlayerName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseNonNegativeInt(value, fieldName = "valor") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 30) {
    throw new Error(`${fieldName} debe ser un numero entre 0 y 30.`);
  }
  return parsed;
}

function parsePredictionScores(homeValue, awayValue) {
  const homeScore = parseNonNegativeInt(homeValue, "Goles local");
  const awayScore = parseNonNegativeInt(awayValue, "Goles visitante");
  if (homeScore === null || awayScore === null) {
    throw new Error("Debes escribir ambos marcadores.");
  }
  return { homeScore, awayScore };
}

function parseKickoffFromBogotaInput(value) {
  const input = cleanText(value);
  if (!input) {
    throw new Error("La fecha y hora del partido es obligatoria.");
  }

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(input)) {
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) {
      throw new Error("La fecha y hora no es valida.");
    }
    return date.toISOString();
  }

  const withSeconds = input.length === 16 ? `${input}:00` : input;
  const date = new Date(`${withSeconds}-05:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("La fecha y hora no es valida.");
  }
  return date.toISOString();
}

function formatDateTime(isoValue, timezone = "America/Bogota") {
  if (!isoValue) return "Pendiente";
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone
  }).format(new Date(isoValue));
}

function formatTime(isoValue, timezone = "America/Bogota") {
  if (!isoValue) return "";
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  }).format(new Date(isoValue));
}

function formatDateGroup(isoValue, timezone = "America/Bogota") {
  if (!isoValue) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: timezone
  }).format(new Date(isoValue));
}

function toBogotaDateTimeLocal(isoValue, timezone = "America/Bogota") {
  if (!isoValue) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(new Date(isoValue));

  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function isMatchLocked(match, now = new Date()) {
  return new Date(match.kickoff_at).getTime() <= now.getTime();
}

function matchResultLabel(match) {
  if (match.home_score === null || match.home_score === undefined || match.away_score === null || match.away_score === undefined) {
    return "Pendiente";
  }
  return `${match.home_score} - ${match.away_score}`;
}

function resultSign(homeScore, awayScore) {
  const home = Number(homeScore);
  const away = Number(awayScore);
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

function pointsForPrediction(prediction, match) {
  if (!prediction || match.home_score === null || match.home_score === undefined || match.away_score === null || match.away_score === undefined) {
    return null;
  }

  const predictedHome = Number(prediction.home_score);
  const predictedAway = Number(prediction.away_score);
  const realHome = Number(match.home_score);
  const realAway = Number(match.away_score);

  let points = 0;

  if (predictedHome === realHome && predictedAway === realAway) {
    points += 3;
  } else if (resultSign(predictedHome, predictedAway) === resultSign(realHome, realAway)) {
    points += 1;
  }

  if (match.tie_breaker_enabled) {
    const predictedGoalScorer = normalizePlayerName(prediction.predicted_goal_scorer);
    const officialGoalScorer = normalizePlayerName(match.goal_scorer);

    const predictedAssistPlayer = normalizePlayerName(prediction.predicted_assist_player);
    const officialAssistPlayer = normalizePlayerName(match.assist_player);

    if (predictedGoalScorer && officialGoalScorer && predictedGoalScorer === officialGoalScorer) {
      points += 3;
    }

    if (predictedAssistPlayer && officialAssistPlayer && predictedAssistPlayer === officialAssistPlayer) {
      points += 3;
    }
  }

  return points;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

module.exports = {
  normalizeEmail,
  cleanText,
  normalizePlayerName,
  parseNonNegativeInt,
  parsePredictionScores,
  parseKickoffFromBogotaInput,
  formatDateTime,
  formatTime,
  formatDateGroup,
  toBogotaDateTimeLocal,
  isMatchLocked,
  matchResultLabel,
  resultSign,
  pointsForPrediction,
  csvEscape
};