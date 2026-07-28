import { Redis } from "@upstash/redis";

const KEYS = {
  best: "emberfall:v1:leaderboard:best",
  points: "emberfall:v1:leaderboard:points",
  player: (id) => `emberfall:v1:player:${id}`,
  run: (id) => `emberfall:v1:run:${id}`,
  rate: (ip) => `emberfall:v1:rate:${ip}`,
};

const RULES = {
  kills: {
    crawler: 80,
    wisp: 100,
    brute: 160,
    boss: 1200,
  },
  waveBase: 300,
  waveMultiplier: 50,
  chapterClear: 2000,
  wavesPerChapter: 3,
};

let redisClient;

function getRedis() {
  if (redisClient) return redisClient;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.REDIS_REST_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis environment variables are not configured");
  redisClient = new Redis({ url, token });
  return redisClient;
}

export default async function handler(request, response) {
  setCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();

  try {
    if (request.method === "GET") return await listLeaderboard(request, response);
    if (request.method === "POST") return await submitScore(request, response);
    return response.status(405).json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("leaderboard_error", error);
    return response.status(500).json({ error: "leaderboard_unavailable" });
  }
}

async function listLeaderboard(request, response) {
  const redis = getRedis();
  const type = request.query.type === "points" ? "points" : "score";
  const limit = clampInteger(request.query.limit, 1, 50, 20);
  const key = type === "points" ? KEYS.points : KEYS.best;
  const rows = await redis.zrange(key, 0, limit - 1, {
    rev: true,
    withScores: true,
  });

  const ranked = [];
  for (let index = 0; index < rows.length; index += 2) {
    ranked.push({
      playerId: String(rows[index]),
      value: Number(rows[index + 1]) || 0,
    });
  }

  const profiles = await Promise.all(
    ranked.map(({ playerId }) => redis.hgetall(KEYS.player(playerId))),
  );
  const entries = ranked.map((entry, index) => {
    const profile = profiles[index] || {};
    return {
      rank: index + 1,
      playerId: entry.playerId,
      playerName: sanitizeName(profile.playerName),
      value: entry.value,
      bestWave: Number(profile.bestWave) || 1,
      kills: Number(profile.kills) || 0,
      updatedAt: profile.updatedAt || null,
    };
  });

  return response.status(200).json({
    type,
    rules: RULES,
    entries,
  });
}

async function submitScore(request, response) {
  const redis = getRedis();
  const ip = getClientIp(request);
  const count = await redis.incr(KEYS.rate(ip));
  if (count === 1) await redis.expire(KEYS.rate(ip), 60);
  if (count > 24) return response.status(429).json({ error: "rate_limited" });

  const payload = validatePayload(request.body);
  if (!payload.ok) return response.status(400).json({ error: payload.error });

  const { playerId, playerName, runId, stats } = payload.value;
  const score = calculateScore(stats);
  const runKey = KEYS.run(runId);
  const previousScore = Number(await redis.get(runKey)) || 0;
  const pointsAdded = Math.max(0, score.total - previousScore);

  if (score.total > previousScore) {
    await redis.set(runKey, score.total, { ex: 60 * 60 * 24 * 365 });
  }

  const currentBest = Number(await redis.zscore(KEYS.best, playerId)) || 0;
  let totalPoints = Number(await redis.zscore(KEYS.points, playerId)) || 0;
  if (pointsAdded > 0) {
    totalPoints = Number(await redis.zincrby(KEYS.points, pointsAdded, playerId));
  }
  if (score.total >= currentBest) {
    await redis.zadd(KEYS.best, { gt: true }, { score: score.total, member: playerId });
  }

  const currentProfile = (await redis.hgetall(KEYS.player(playerId))) || {};
  const bestIsCurrent = score.total >= currentBest;
  await redis.hset(KEYS.player(playerId), {
    playerName,
    totalPoints,
    bestScore: Math.max(currentBest, score.total),
    bestWave: bestIsCurrent ? stats.bestWave : Number(currentProfile.bestWave) || 1,
    kills: bestIsCurrent ? score.kills : Number(currentProfile.kills) || 0,
    updatedAt: new Date().toISOString(),
  });

  return response.status(200).json({
    accepted: pointsAdded > 0,
    score: score.total,
    pointsAdded,
    totalPoints,
    rules: RULES,
  });
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
