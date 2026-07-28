export const SCORE_RULES = Object.freeze({
  kills: Object.freeze({
    crawler: 80,
    wisp: 100,
    ranger: 130,
    brute: 160,
    boss: 1200,
  }),
  waveBase: 300,
  waveMultiplier: 50,
  chapterClear: 2000,
  wavesPerChapter: 3,
});

export function createRunStats() {
  return {
    kills: {
      crawler: 0,
      wisp: 0,
      ranger: 0,
      brute: 0,
      boss: 0,
    },
    wavesCleared: 0,
    chaptersCleared: 0,
    bestWave: 1,
  };
}

export function normalizeRunStats(stats = {}) {
  const kills = stats.kills ?? {};
  return {
    kills: {
      crawler: nonNegativeInteger(kills.crawler),
      wisp: nonNegativeInteger(kills.wisp),
      ranger: nonNegativeInteger(kills.ranger),
      brute: nonNegativeInteger(kills.brute),
      boss: nonNegativeInteger(kills.boss),
    },
    wavesCleared: nonNegativeInteger(stats.wavesCleared),
    chaptersCleared: nonNegativeInteger(stats.chaptersCleared),
    bestWave: Math.max(1, nonNegativeInteger(stats.bestWave)),
  };
}

export function calculateScore(stats) {
  const normalized = normalizeRunStats(stats);
  const killScore = Object.entries(normalized.kills).reduce(
    (total, [type, count]) => total + count * SCORE_RULES.kills[type],
    0,
  );
  const waves = normalized.wavesCleared;
  const waveScore =
    waves * SCORE_RULES.waveBase +
    SCORE_RULES.waveMultiplier * ((waves * (waves + 1)) / 2);
  const chapterScore = normalized.chaptersCleared * SCORE_RULES.chapterClear;
  return {
    total: Math.round(killScore + waveScore + chapterScore),
    killScore,
    waveScore,
    chapterScore,
    kills: Object.values(normalized.kills).reduce((sum, count) => sum + count, 0),
    stats: normalized,
  };
}

export function formatScore(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Number(value) || 0));
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}
