import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const RULES = {
  kills: {
    crawler: 80,
    wisp: 100,
    ranger: 130,
    brute: 160,
    boss: 1200,
  },
  waveBase: 300,
  waveMultiplier: 50,
  chapterClear: 2000,
  wavesPerChapter: 3,
};

let sqlClient;
let schemaPromise;

function getSql() {
  if (sqlClient) return sqlClient;
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error("Neon database environment variables are not configured");
  }
  sqlClient = neon(connectionString);
  return sqlClient;
}

async function ensureSchema(sql) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS emberfall_players (
          player_id TEXT PRIMARY KEY,
          player_name VARCHAR(12) NOT NULL,
          total_points BIGINT NOT NULL DEFAULT 0,
          best_score BIGINT NOT NULL DEFAULT 0,
          best_wave INTEGER NOT NULL DEFAULT 1,
          kills INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS emberfall_runs (
          run_id TEXT PRIMARY KEY,
          player_id TEXT NOT NULL,
          score BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS emberfall_rate_limits (
          bucket TEXT PRIMARY KEY,
          request_count INTEGER NOT NULL DEFAULT 1,
          expires_at TIMESTAMPTZ NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS emberfall_players_best_score_idx
        ON emberfall_players (best_score DESC, updated_at ASC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS emberfall_players_total_points_idx
        ON emberfall_players (total_points DESC, updated_at ASC)
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export default async function handler(request, response) {
  setCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();

  try {
    const sql = getSql();
    await ensureSchema(sql);
    if (request.method === "GET") return await listLeaderboard(sql, request, response);
    if (request.method === "POST") return await submitScore(sql, request, response);
    return response.status(405).json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("leaderboard_error", error);
    return response.status(500).json({ error: "leaderboard_unavailable" });
  }
}

async function listLeaderboard(sql, request, response) {
  const type = request.query.type === "points" ? "points" : "score";
  const limit = clampInteger(request.query.limit, 1, 50, 20);
  const rows =
    type === "points"
      ? await sql`
          SELECT player_id, player_name, total_points AS value, best_wave, kills, updated_at
          FROM emberfall_players
          WHERE total_points > 0
          ORDER BY total_points DESC, updated_at ASC
          LIMIT ${limit}
        `
      : await sql`
          SELECT player_id, player_name, best_score AS value, best_wave, kills, updated_at
          FROM emberfall_players
          WHERE best_score > 0
          ORDER BY best_score DESC, updated_at ASC
          LIMIT ${limit}
        `;

  const entries = rows.map((row, index) => ({
    rank: index + 1,
    playerId: String(row.player_id),
    playerName: sanitizeName(row.player_name),
    value: Number(row.value) || 0,
    bestWave: Number(row.best_wave) || 1,
    kills: Number(row.kills) || 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }));

  return response.status(200).json({
    type,
    rules: RULES,
    entries,
  });
}

async function submitScore(sql, request, response) {
  const count = await consumeRateLimit(sql, getClientIp(request));
  if (count > 24) return response.status(429).json({ error: "rate_limited" });

  const payload = validatePayload(request.body);
  if (!payload.ok) return response.status(400).json({ error: payload.error });

  const { playerId, playerName, runId, stats } = payload.value;
  const score = calculateScore(stats);
  const runResult = await saveRunProgress(sql, {
    runId,
    playerId,
    score: score.total,
  });
  if (runResult.ownerMismatch) {
    return response.status(409).json({ error: "run_owner_mismatch" });
  }

  const rows = await sql`
    INSERT INTO emberfall_players (
      player_id,
      player_name,
      total_points,
      best_score,
      best_wave,
      kills,
      updated_at
    )
    VALUES (
      ${playerId},
      ${playerName},
      ${runResult.pointsAdded},
      ${score.total},
      ${stats.bestWave},
      ${score.kills},
      NOW()
    )
    ON CONFLICT (player_id) DO UPDATE SET
      player_name = EXCLUDED.player_name,
      total_points = emberfall_players.total_points + EXCLUDED.total_points,
      best_wave = CASE
        WHEN EXCLUDED.best_score >= emberfall_players.best_score
          THEN EXCLUDED.best_wave
        ELSE emberfall_players.best_wave
      END,
      kills = CASE
        WHEN EXCLUDED.best_score >= emberfall_players.best_score
          THEN EXCLUDED.kills
        ELSE emberfall_players.kills
      END,
      best_score = GREATEST(emberfall_players.best_score, EXCLUDED.best_score),
      updated_at = NOW()
    RETURNING total_points
  `;
  const totalPoints = Number(rows[0]?.total_points) || 0;

  return response.status(200).json({
    accepted: runResult.pointsAdded > 0,
    score: score.total,
    pointsAdded: runResult.pointsAdded,
    totalPoints,
    rules: RULES,
  });
}

async function saveRunProgress(sql, { runId, playerId, score }) {
  const inserted = await sql`
    INSERT INTO emberfall_runs (run_id, player_id, score, updated_at)
    VALUES (${runId}, ${playerId}, ${score}, NOW())
    ON CONFLICT (run_id) DO NOTHING
    RETURNING score
  `;
  if (inserted.length > 0) {
    return { pointsAdded: score, ownerMismatch: false };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await sql`
      SELECT player_id, score
      FROM emberfall_runs
      WHERE run_id = ${runId}
    `;
    const current = existing[0];
    if (!current) continue;
    if (current.player_id !== playerId) {
      return { pointsAdded: 0, ownerMismatch: true };
    }

    const previousScore = Number(current.score) || 0;
    if (score <= previousScore) {
      return { pointsAdded: 0, ownerMismatch: false };
    }

    const updated = await sql`
      UPDATE emberfall_runs
      SET score = ${score}, updated_at = NOW()
      WHERE run_id = ${runId} AND player_id = ${playerId} AND score = ${previousScore}
      RETURNING score
    `;
    if (updated.length > 0) {
      return { pointsAdded: score - previousScore, ownerMismatch: false };
    }
  }

  return { pointsAdded: 0, ownerMismatch: false };
}

async function consumeRateLimit(sql, ip) {
  const window = Math.floor(Date.now() / 60_000);
  const bucket = createHash("sha256")
    .update(`${ip}:${window}`)
    .digest("hex")
    .slice(0, 32);
  const rows = await sql`
    INSERT INTO emberfall_rate_limits (bucket, request_count, expires_at)
    VALUES (${bucket}, 1, NOW() + INTERVAL '2 minutes')
    ON CONFLICT (bucket) DO UPDATE SET
      request_count = emberfall_rate_limits.request_count + 1,
      expires_at = EXCLUDED.expires_at
    RETURNING request_count
  `;

  if (Math.random() < 0.02) {
    await sql`DELETE FROM emberfall_rate_limits WHERE expires_at < NOW()`;
  }
  return Number(rows[0]?.request_count) || 1;
}

function validatePayload(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const playerId = String(body.playerId || "");
  const runId = String(body.runId || "");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(playerId)) return { ok: false, error: "invalid_player_id" };
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(runId)) return { ok: false, error: "invalid_run_id" };

  const input = body.stats || {};
  const kills = input.kills || {};
  const wavesCleared = clampInteger(input.wavesCleared, 0, 1000, 0);
  const bestWave = clampInteger(input.bestWave, 1, wavesCleared + 1, 1);
  const stats = {
    kills: {
      crawler: clampInteger(kills.crawler, 0, 25000, 0),
      wisp: clampInteger(kills.wisp, 0, 25000, 0),
      ranger: clampInteger(kills.ranger, 0, 25000, 0),
      brute: clampInteger(kills.brute, 0, 25000, 0),
      boss: clampInteger(kills.boss, 0, 1000, 0),
    },
    wavesCleared,
    chaptersCleared: Math.min(
      clampInteger(input.chaptersCleared, 0, 333, 0),
      Math.floor(wavesCleared / RULES.wavesPerChapter),
    ),
    bestWave,
  };
  const totalKills = Object.values(stats.kills).reduce((sum, count) => sum + count, 0);
  const plausibleKillLimit = Math.max(20, wavesCleared * 30 + 30);
  if (totalKills > plausibleKillLimit) return { ok: false, error: "implausible_run" };

  return {
    ok: true,
    value: {
      playerId,
      runId,
      playerName: sanitizeName(body.playerName),
      stats,
    },
  };
}

function calculateScore(stats) {
  const killScore = Object.entries(stats.kills).reduce(
    (sum, [type, count]) => sum + count * RULES.kills[type],
    0,
  );
  const waves = stats.wavesCleared;
  const waveScore =
    waves * RULES.waveBase +
    RULES.waveMultiplier * ((waves * (waves + 1)) / 2);
  const chapterScore = stats.chaptersCleared * RULES.chapterClear;
  return {
    total: Math.round(killScore + waveScore + chapterScore),
    kills: Object.values(stats.kills).reduce((sum, count) => sum + count, 0),
  };
}

function sanitizeName(value) {
  const name = String(value || "")
    .replace(/[<>{}[\]\\/"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12);
  return name || "无名旅者";
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function getClientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "");
  return (forwarded.split(",")[0] || request.socket?.remoteAddress || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9:.\-]/g, "")
    .slice(0, 64);
}

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
}

export { calculateScore, sanitizeName, validatePayload };
