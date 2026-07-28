import { calculateScore, normalizeRunStats } from "./scoring.js";

const PROFILE_KEY = "emberfall-player-profile-v1";
const LOCAL_BOARD_KEY = "emberfall-local-leaderboard-v1";
const API_URL = (import.meta.env.VITE_LEADERBOARD_API_URL || "").replace(/\/$/, "");

export class LeaderboardService {
  constructor() {
    this.profile = this.loadProfile();
    this.mode = API_URL ? "online" : "local";
  }

  getProfile() {
    return { ...this.profile };
  }

  setPlayerName(name) {
    this.profile.name = sanitizeName(name);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
    return this.getProfile();
  }

  createRunId() {
    return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async submit(runId, stats) {
    const normalized = normalizeRunStats(stats);
    const payload = {
      runId,
      playerId: this.profile.id,
      playerName: this.profile.name,
      stats: normalized,
    };
    const localResult = this.submitLocal(payload);
    if (!API_URL) return { ...localResult, mode: "local" };

    try {
      const response = await fetch(`${API_URL}/api/leaderboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      this.mode = "online";
      return { ...result, mode: "online" };
    } catch (error) {
      this.mode = "local";
      return {
        ...localResult,
        mode: "local",
        fallback: true,
        error: error instanceof Error ? error.message : "network_error",
      };
    }
  }

  async list(type = "score", limit = 20) {
    if (API_URL) {
      try {
        const response = await fetch(
          `${API_URL}/api/leaderboard?type=${encodeURIComponent(type)}&limit=${limit}`,
          { headers: { Accept: "application/json" } },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        this.mode = "online";
        return { entries: result.entries ?? [], mode: "online" };
      } catch {
        this.mode = "local";
      }
    }
    return { entries: this.listLocal(type, limit), mode: "local" };
  }

  loadProfile() {
    try {
      const existing = JSON.parse(localStorage.getItem(PROFILE_KEY));
      if (existing?.id) {
        return {
          id: String(existing.id),
          name: sanitizeName(existing.name),
        };
      }
    } catch {
      // Create a new profile below.
    }
    const profile = {
      id: globalThis.crypto?.randomUUID?.() ?? `player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      name: `旅者${Math.floor(1000 + Math.random() * 9000)}`,
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  }

  submitLocal(payload) {
    const database = readLocalDatabase();
    const result = calculateScore(payload.stats);
    const previousRunScore = Number(database.runs[payload.runId] ?? 0);
    const delta = Math.max(0, result.total - previousRunScore);
    database.runs[payload.runId] = Math.max(previousRunScore, result.total);

    const player = database.players[payload.playerId] ?? {
      id: payload.playerId,
      name: payload.playerName,
      bestScore: 0,
      totalPoints: 0,
      bestWave: 1,
      kills: 0,
      updatedAt: new Date().toISOString(),
    };
    player.name = payload.playerName;
    player.totalPoints += delta;
    if (result.total >= player.bestScore) {
      player.bestScore = result.total;
      player.bestWave = result.stats.bestWave;
      player.kills = result.kills;
    }
    player.updatedAt = new Date().toISOString();
    database.players[payload.playerId] = player;
    localStorage.setItem(LOCAL_BOARD_KEY, JSON.stringify(database));
    return {
      accepted: delta > 0,
      score: result.total,
      pointsAdded: delta,
      totalPoints: player.totalPoints,
    };
  }

  listLocal(type, limit) {
    const database = readLocalDatabase();
    const field = type === "points" ? "totalPoints" : "bestScore";
    return Object.values(database.players)
      .sort((a, b) => b[field] - a[field] || a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, limit)
      .map((player, index) => ({
        rank: index + 1,
        playerId: player.id,
        playerName: player.name,
        value: player[field],
        bestWave: player.bestWave,
        kills: player.kills,
        isCurrentPlayer: player.id === this.profile.id,
      }));
  }
}

export function sanitizeName(value) {
  const normalized = String(value || "")
    .replace(/[<>{}[\]\\/"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12);
  return normalized || "无名旅者";
}

function readLocalDatabase() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_BOARD_KEY));
    if (parsed?.players && parsed?.runs) return parsed;
  } catch {
    // Return a fresh local database below.
  }
  return { players: {}, runs: {} };
}
