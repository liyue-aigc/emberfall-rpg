export const PLANET_RADIUS = 96;
export const REGION_SIZE = 42;
export const RECENTER_DISTANCE = 12;
export const LOCAL_SPAWN_RADIUS = 21;

export const BIOMES = Object.freeze([
  Object.freeze({
    id: "verdigris",
    name: "铜绿苔原",
    subtitle: "游荡幽魂与腐弦猎手盘踞的湿冷地带",
    accent: 0x61c8b6,
    enemyBias: ["wisp", "ranger", "crawler", "wisp", "ranger"],
  }),
  Object.freeze({
    id: "rust",
    name: "赤锈荒原",
    subtitle: "重甲蛮兵在灼热铁砂中巡猎",
    accent: 0xe56f38,
    enemyBias: ["brute", "crawler", "ranger", "brute", "crawler"],
  }),
  Object.freeze({
    id: "glass",
    name: "蚀光晶原",
    subtitle: "魔法抗性更高的幽光生物在此繁衍",
    accent: 0xa987ff,
    enemyBias: ["wisp", "wisp", "ranger", "crawler", "wisp"],
  }),
  Object.freeze({
    id: "slag",
    name: "黑渣裂谷",
    subtitle: "高威胁近战族群守卫着稀有战利品",
    accent: 0xffb15f,
    enemyBias: ["brute", "brute", "crawler", "ranger", "brute"],
  }),
]);

export function getSurfaceHeight(x, z, radius = PLANET_RADIUS) {
  const radialSquared = x * x + z * z;
  const safeSquared = Math.min(radialSquared, radius * radius * 0.92);
  return Math.sqrt(radius * radius - safeSquared) - radius;
}

export function getRegionCoordinates(worldX, worldZ) {
  return {
    x: Math.floor((worldX + REGION_SIZE * 0.5) / REGION_SIZE),
    z: Math.floor((worldZ + REGION_SIZE * 0.5) / REGION_SIZE),
  };
}

export function getRegionKey(x, z) {
  return `${x}:${z}`;
}

export function getRegionBiome(x, z) {
  return BIOMES[Math.abs(hash2D(x, z)) % BIOMES.length];
}

export function getRegionThreat(x, z, regionsCleared = 0, playerLevel = 1) {
  const distanceTier = Math.floor(Math.hypot(x, z) * 0.72);
  const clearTier = Math.floor(Math.max(0, regionsCleared) / 3);
  const levelTier = Math.floor(Math.max(0, playerLevel - 1) * 0.48);
  return Math.max(1, 1 + distanceTier + clearTier + levelTier);
}

export function createRegionState(x, z, regionsCleared = 0, playerLevel = 1) {
  return {
    key: getRegionKey(x, z),
    x,
    z,
    biome: getRegionBiome(x, z),
    threat: getRegionThreat(x, z, regionsCleared, playerLevel),
    active: false,
    defeated: 0,
    enemyCount: 0,
    clears: 0,
    respawnAt: 0,
    hasBoss: false,
  };
}

function hash2D(x, z) {
  let value = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ z, 0xc2b2ae35);
  value ^= value >>> 16;
  return value | 0;
}
