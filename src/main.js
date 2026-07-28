import * as THREE from "three";
import "./style.css";
import { LeaderboardService } from "./leaderboard.js";
import { calculateScore, createRunStats, formatScore, normalizeRunStats } from "./scoring.js";
import { EmberAudio } from "./audio-engine.js";
import {
  LOCAL_SPAWN_RADIUS,
  PLANET_RADIUS,
  RECENTER_DISTANCE,
  REGION_SIZE,
  createRegionState,
  getRegionCoordinates,
  getRegionKey,
  getRegionThreat,
  getSurfaceHeight,
} from "./world-system.js";

const SAVE_KEY = "emberfall-save-v1";
const MINIMAP_RANGE = 34;

const ui = {
  shell: document.querySelector("#game-shell"),
  startScreen: document.querySelector("#start-screen"),
  pauseScreen: document.querySelector("#pause-screen"),
  deathScreen: document.querySelector("#death-screen"),
  victoryScreen: document.querySelector("#victory-screen"),
  startButton: document.querySelector("#start-button"),
  startButtonLabel: document.querySelector("#start-button-label"),
  newRunButton: document.querySelector("#new-run-button"),
  pauseButton: document.querySelector("#pause-button"),
  audioButton: document.querySelector("#audio-button"),
  resumeButton: document.querySelector("#resume-button"),
  restartButton: document.querySelector("#restart-button"),
  retryButton: document.querySelector("#retry-button"),
  continueButton: document.querySelector("#continue-button"),
  victoryRestartButton: document.querySelector("#victory-restart-button"),
  potionButton: document.querySelector("#potion-button"),
  healthLabel: document.querySelector("#health-label"),
  healthFill: document.querySelector("#health-fill"),
  shieldFill: document.querySelector("#shield-fill"),
  xpLabel: document.querySelector("#xp-label"),
  xpFill: document.querySelector("#xp-fill"),
  levelLabel: document.querySelector("#level-label"),
  waveLabel: document.querySelector("#wave-label"),
  zoneLabel: document.querySelector("#zone-label"),
  objectiveTitle: document.querySelector("#objective-title"),
  objectiveText: document.querySelector("#objective-text"),
  objectivePercent: document.querySelector("#objective-percent"),
  objectiveFill: document.querySelector("#objective-fill"),
  damageStat: document.querySelector("#damage-stat"),
  skillStat: document.querySelector("#skill-stat"),
  armorStat: document.querySelector("#armor-stat"),
  resistStat: document.querySelector("#resist-stat"),
  threatStat: document.querySelector("#threat-stat"),
  regionStatus: document.querySelector("#region-status"),
  shardStat: document.querySelector("#shard-stat"),
  currentScore: document.querySelector("#current-score"),
  potionCount: document.querySelector("#potion-count"),
  relicToggle: document.querySelector("#relic-toggle"),
  relicDrawer: document.querySelector("#relic-drawer"),
  relicSlots: document.querySelector("#relic-slots"),
  relicCount: document.querySelector("#relic-count"),
  lootFeed: document.querySelector("#loot-feed"),
  bossBar: document.querySelector("#boss-bar"),
  bossName: document.querySelector("#boss-name"),
  bossFill: document.querySelector("#boss-fill"),
  deathWave: document.querySelector("#death-wave"),
  deathSummary: document.querySelector("#death-summary"),
  victorySummary: document.querySelector("#victory-summary"),
  deathScore: document.querySelector("#death-score"),
  victoryScore: document.querySelector("#victory-score"),
  deathSubmitStatus: document.querySelector("#death-submit-status"),
  victorySubmitStatus: document.querySelector("#victory-submit-status"),
  playerNameInput: document.querySelector("#player-name-input"),
  rankingButton: document.querySelector("#ranking-button"),
  startRankingButton: document.querySelector("#start-ranking-button"),
  rankingPanel: document.querySelector("#ranking-panel"),
  rankingClose: document.querySelector("#ranking-close"),
  rankingPlayerName: document.querySelector("#ranking-player-name"),
  rankingMode: document.querySelector("#ranking-mode"),
  rankingList: document.querySelector("#ranking-list"),
  rankingValueLabel: document.querySelector("#ranking-value-label"),
  rankingTabs: [...document.querySelectorAll("[data-ranking-type]")],
  minimap: document.querySelector("#minimap"),
  skillButtons: [...document.querySelectorAll("[data-skill]")],
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => min + Math.random() * (max - min);
const choose = (items) => items[Math.floor(Math.random() * items.length)];
const distanceXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function makeMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.78,
    metalness: options.metalness ?? 0.08,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
  });
}

function mesh(geometry, material, castShadow = true, receiveShadow = false) {
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = castShadow;
  object.receiveShadow = receiveShadow;
  return object;
}

function createGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#173234";
  ctx.fillRect(0, 0, 512, 512);

  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const shade = Math.floor(rand(22, 39));
      ctx.fillStyle = `rgb(${shade - 4}, ${shade + 14}, ${shade + 13})`;
      ctx.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
      ctx.strokeStyle = "rgba(3, 14, 15, .32)";
      ctx.strokeRect(x * 32 + 0.5, y * 32 + 0.5, 31, 31);
    }
  }

  ctx.lineWidth = 1;
  for (let i = 0; i < 85; i += 1) {
    const x = rand(0, 512);
    const y = rand(0, 512);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rand(-12, 12), y + rand(4, 18));
    ctx.lineTo(x + rand(-20, 20), y + rand(18, 34));
    ctx.strokeStyle = `rgba(2, 9, 10, ${rand(0.16, 0.38)})`;
    ctx.stroke();
  }

  for (let i = 0; i < 2600; i += 1) {
    const alpha = rand(0.015, 0.07);
    ctx.fillStyle = `rgba(220, 225, 201, ${alpha})`;
    ctx.fillRect(rand(0, 512), rand(0, 512), 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

class EmberfallGame {
  constructor() {
    this.canvas = document.querySelector("#game-canvas");
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x071315);
    this.scene.fog = new THREE.FogExp2(0x071315, 0.027);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.camera = new THREE.OrthographicCamera(-16, 16, 10, -10, 0.1, 140);
    this.cameraOffset = new THREE.Vector3(12.5, 16.5, 12.5);
    this.cameraTarget = new THREE.Vector3();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerWorld = new THREE.Vector3(0, 0, -4);
    this.keys = new Set();

    this.state = "start";
    this.elapsed = 0;
    this.wave = 1;
    this.waveTotal = 0;
    this.waveDefeated = 0;
    this.waveActive = false;
    this.nextWaveTimer = -1;
    this.kills = 0;
    this.victorySeen = false;
    this.lastSaveAt = 0;
    this.cameraShake = 0;
    this.audio = new EmberAudio();
    this.planetRadius = PLANET_RADIUS;
    this.worldOffset = new THREE.Vector2();
    this.regionStates = new Map();
    this.currentRegionKey = null;
    this.regionsCleared = 0;
    this.lastRegionUpdate = 0;
    this.leaderboard = new LeaderboardService();
    this.runStats = createRunStats();
    this.runId = this.leaderboard.createRunId();
    this.rankingType = "score";
    this.scoreSubmission = null;

    this.enemies = [];
    this.projectiles = [];
    this.drops = [];
    this.effects = [];
    this.damageNumbers = [];

    this.skillState = {
      attack: { cooldown: 0, max: 0.42 },
      nova: { cooldown: 0, max: 6 },
      dash: { cooldown: 0, max: 4.2 },
      ward: { cooldown: 0, max: 12 },
    };

    this.player = {
      group: null,
      body: null,
      target: null,
      attackTarget: null,
      speed: 7.2,
      hp: 130,
      maxHp: 130,
      shield: 0,
      damage: 20,
      skillPower: 26,
      armor: 5,
      magicResist: 5,
      attackSpeed: 0,
      critChance: 0.08,
      gearScore: 0,
      level: 1,
      xp: 0,
      xpNeeded: 100,
      shards: 0,
      potions: 3,
      relics: [],
      invulnerable: 0,
      moving: false,
      running: false,
      action: null,
      aimDirection: new THREE.Vector3(0, 0, -1),
    };

    this.floatLayer = document.createElement("div");
    this.floatLayer.className = "float-layer";
    ui.shell.append(this.floatLayer);

    this.createWorld();
    this.createPlayer();
    this.createCursor();
    this.bindEvents();
    this.resize();
    this.refreshSaveState();
    this.initializeLeaderboard();
    this.syncAudioButton();
    this.updateUI();
    this.animate();
  }

  surfaceHeight(x, z, lift = 0) {
    return getSurfaceHeight(x, z, this.planetRadius) + lift;
  }

  snapToSurface(object, lift = 0) {
    object.position.y = this.surfaceHeight(object.position.x, object.position.z, lift);
  }

  getPlayerWorldPosition() {
    return new THREE.Vector2(
      this.worldOffset.x + this.player.group.position.x,
      this.worldOffset.y + this.player.group.position.z,
    );
  }

  createWorld() {
    const hemi = new THREE.HemisphereLight(0x7db9ad, 0x081214, 1.3);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xbbe3d8, 2.35);
    keyLight.position.set(-12, 24, 9);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -30;
    keyLight.shadow.camera.right = 30;
    keyLight.shadow.camera.top = 30;
    keyLight.shadow.camera.bottom = -30;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 70;
    keyLight.shadow.bias = -0.0004;
    this.scene.add(keyLight);

    const emberLight = new THREE.PointLight(0xe5682d, 58, 22, 1.8);
    emberLight.position.set(0, 5, 0);
    this.scene.add(emberLight);
    this.emberLight = emberLight;

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x53706a,
      map: createGroundTexture(),
      roughness: 0.96,
      metalness: 0.03,
    });
    const ground = mesh(
      new THREE.SphereGeometry(this.planetRadius, 96, 72),
      groundMaterial,
      false,
      true,
    );
    ground.position.y = -this.planetRadius;
    ground.rotation.y = Math.PI * 0.18;
    ground.userData.isGround = true;
    this.scene.add(ground);
    this.ground = ground;
    this.planet = ground;

    this.decor = new THREE.Group();
    const stoneMaterial = makeMaterial(0x254345, { roughness: 1 });
    const mossMaterial = makeMaterial(0x2f6055, { roughness: 1 });
    for (let i = 0; i < 42; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const radius = rand(19.8, 24.6);
      const stone = mesh(
        new THREE.DodecahedronGeometry(rand(0.3, 0.85), 0),
        Math.random() > 0.78 ? mossMaterial : stoneMaterial,
      );
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      stone.position.set(x, this.surfaceHeight(x, z) + rand(0.05, 0.22), z);
      stone.scale.y = rand(0.45, 1.1);
      stone.rotation.set(rand(0, 1), rand(0, Math.PI), rand(0, 1));
      this.decor.add(stone);
    }
    this.scene.add(this.decor);

    this.landmarks = new THREE.Group();
    this.scene.add(this.landmarks);
    this.createCenterForge();
    this.createBraziers();

    const dustGeometry = new THREE.BufferGeometry();
    const dustPositions = new Float32Array(220 * 3);
    for (let i = 0; i < 220; i += 1) {
      dustPositions[i * 3] = rand(-28, 28);
      dustPositions[i * 3 + 1] = rand(0.2, 8);
      dustPositions[i * 3 + 2] = rand(-28, 28);
    }
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    this.dust = new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: 0x76b8a9,
        size: 0.045,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    this.scene.add(this.dust);
  }

  createCenterForge() {
    const group = new THREE.Group();
    const ringMaterial = makeMaterial(0x83523c, {
      roughness: 0.48,
      metalness: 0.55,
      emissive: 0x4b1708,
      emissiveIntensity: 0.24,
    });
    const stoneMaterial = makeMaterial(0x173436, { roughness: 0.9 });

    const disc = mesh(new THREE.CylinderGeometry(4.4, 4.65, 0.25, 12), stoneMaterial, false, true);
    disc.position.y = 0.03;
    group.add(disc);

    const ring = mesh(new THREE.TorusGeometry(3.45, 0.09, 8, 64), ringMaterial, false);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    group.add(ring);

    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const spoke = mesh(new THREE.BoxGeometry(0.13, 0.05, 2.3), ringMaterial, false);
      spoke.position.set(Math.sin(angle) * 1.75, 0.22, Math.cos(angle) * 1.75);
      spoke.rotation.y = angle;
      group.add(spoke);
    }

    const core = mesh(
      new THREE.OctahedronGeometry(0.52, 0),
      makeMaterial(0xe36b31, {
        emissive: 0xe36b31,
        emissiveIntensity: 2.4,
        roughness: 0.28,
      }),
      false,
    );
    core.position.y = 0.82;
    group.add(core);
    this.forgeCore = core;
    this.landmarks.add(group);
  }

  createBraziers() {
    this.flames = [];
    const metal = makeMaterial(0x4b443b, { metalness: 0.65, roughness: 0.45 });
    const ember = makeMaterial(0xff7434, {
      emissive: 0xff4d18,
      emissiveIntensity: 3,
      roughness: 0.2,
    });

    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const group = new THREE.Group();
      group.position.set(Math.cos(angle) * 16.8, 0, Math.sin(angle) * 16.8);
      group.position.y = this.surfaceHeight(group.position.x, group.position.z);

      const stem = mesh(new THREE.CylinderGeometry(0.12, 0.19, 1.5, 8), metal);
      stem.position.y = 0.75;
      group.add(stem);

      const bowl = mesh(new THREE.CylinderGeometry(0.62, 0.3, 0.35, 8), metal);
      bowl.position.y = 1.55;
      group.add(bowl);

      const flame = mesh(new THREE.ConeGeometry(0.28, 0.85, 7), ember, false);
      flame.position.y = 2.13;
      group.add(flame);
      this.flames.push(flame);

      const light = new THREE.PointLight(0xff6d2d, 8, 7, 2);
      light.position.y = 2.25;
      group.add(light);
      this.landmarks.add(group);
    }
  }

  createPlayer() {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);

    const cloakMaterial = makeMaterial(0x225c59, { roughness: 0.86 });
    const cloakDark = makeMaterial(0x102f31, { roughness: 0.9 });
    const copper = makeMaterial(0x9f6544, { roughness: 0.42, metalness: 0.5 });
    const leather = makeMaterial(0x4a2c23, { roughness: 0.82 });
    const bootLeather = makeMaterial(0x291b18, { roughness: 0.94 });
    const face = makeMaterial(0x1a1715, { roughness: 1 });
    const ember = makeMaterial(0xff9c54, {
      emissive: 0xff6a2d,
      emissiveIntensity: 2.8,
      roughness: 0.25,
    });

    const torso = new THREE.Group();
    body.add(torso);

    const cloak = mesh(new THREE.ConeGeometry(0.72, 1.8, 7), cloakMaterial);
    cloak.position.y = 1.2;
    cloak.rotation.y = Math.PI / 7;
    torso.add(cloak);

    const chest = mesh(new THREE.CylinderGeometry(0.43, 0.55, 1.15, 7), cloakDark);
    chest.position.y = 1.55;
    torso.add(chest);

    const chestPlate = mesh(new THREE.BoxGeometry(0.56, 0.5, 0.12), copper);
    chestPlate.position.set(0, 1.62, -0.45);
    chestPlate.rotation.x = -0.08;
    torso.add(chestPlate);

    const cloakTail = mesh(
      new THREE.BoxGeometry(0.72, 1.05, 0.08),
      makeMaterial(0x194a48, { roughness: 0.92, side: THREE.DoubleSide }),
    );
    cloakTail.position.set(0, 0.82, 0.45);
    cloakTail.rotation.x = -0.12;
    torso.add(cloakTail);

    const hoodPivot = new THREE.Group();
    hoodPivot.position.y = 2.25;
    torso.add(hoodPivot);

    const hood = mesh(new THREE.SphereGeometry(0.48, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.78), cloakMaterial);
    hood.scale.z = 0.9;
    hoodPivot.add(hood);

    const faceVoid = mesh(new THREE.SphereGeometry(0.31, 10, 8), face, false);
    faceVoid.position.set(0, -0.06, -0.27);
    faceVoid.scale.set(0.9, 0.8, 0.35);
    hoodPivot.add(faceVoid);

    const eye = mesh(new THREE.BoxGeometry(0.17, 0.035, 0.03), ember, false);
    eye.position.set(0, -0.02, -0.385);
    hoodPivot.add(eye);

    const belt = mesh(new THREE.TorusGeometry(0.46, 0.055, 6, 20), copper);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 1.25;
    torso.add(belt);

    const makeLeg = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.23, 0.82, 0);
      const leg = mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.72, 7), leather);
      leg.position.y = -0.34;
      pivot.add(leg);
      const boot = mesh(new THREE.BoxGeometry(0.3, 0.28, 0.48), bootLeather);
      boot.position.set(0, -0.77, -0.1);
      pivot.add(boot);
      body.add(pivot);
      return pivot;
    };
    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);

    const makeArm = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.54, 1.87, 0);
      const upper = mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.66, 7), cloakMaterial);
      upper.position.y = -0.29;
      pivot.add(upper);
      const glove = mesh(new THREE.SphereGeometry(0.15, 8, 6), leather);
      glove.position.y = -0.67;
      pivot.add(glove);
      const shoulder = mesh(new THREE.DodecahedronGeometry(0.25, 0), copper);
      shoulder.position.y = -0.02;
      shoulder.scale.set(1.2, 0.7, 1);
      pivot.add(shoulder);
      torso.add(pivot);
      return pivot;
    };
    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);

    const staff = new THREE.Group();
    const shaft = mesh(new THREE.CylinderGeometry(0.055, 0.065, 2.5, 7), leather);
    shaft.position.y = 0.2;
    staff.add(shaft);
    const cap = mesh(new THREE.TorusGeometry(0.25, 0.045, 7, 20), copper);
    cap.position.y = 1.44;
    cap.rotation.x = Math.PI / 2;
    staff.add(cap);
    const gem = mesh(new THREE.OctahedronGeometry(0.18, 0), ember, false);
    gem.position.y = 1.44;
    staff.add(gem);
    const crownLeft = mesh(new THREE.ConeGeometry(0.045, 0.42, 5), copper);
    crownLeft.position.set(-0.16, 1.28, 0);
    crownLeft.rotation.z = -0.6;
    staff.add(crownLeft);
    const crownRight = crownLeft.clone();
    crownRight.position.x = 0.16;
    crownRight.rotation.z = 0.6;
    staff.add(crownRight);
    staff.position.set(0.04, -0.68, 0.03);
    staff.rotation.z = -0.08;
    rightArm.add(staff);
    this.playerStaff = staff;
    this.playerStaffGem = gem;

    const shadow = mesh(
      new THREE.CircleGeometry(0.78, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
      false,
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    group.add(shadow);

    const selection = mesh(
      new THREE.RingGeometry(0.82, 0.92, 32),
      new THREE.MeshBasicMaterial({
        color: 0x62c9b9,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      false,
    );
    selection.rotation.x = -Math.PI / 2;
    selection.position.y = 0.025;
    group.add(selection);
    this.playerRing = selection;

    group.position.set(0, 0, 6);
    this.scene.add(group);
    this.player.group = group;
    this.player.body = body;
    this.player.rig = {
      torso,
      hoodPivot,
      cloak,
      cloakTail,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      staff,
      staffGem: gem,
      eye,
    };
  }

  createCursor() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xe6783d,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.cursor = mesh(new THREE.RingGeometry(0.28, 0.38, 4), material, false);
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.rotation.z = Math.PI / 4;
    this.cursor.position.y = 0.04;
    this.scene.add(this.cursor);
  }

  bindEvents() {
    window.addEventListener("resize", () => this.resize());

    this.canvas.addEventListener("pointermove", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.updatePointerWorld();
    });

    this.canvas.addEventListener("pointerdown", (event) => {
      void this.audio.unlock();
      if (event.button !== 0 || this.state !== "running") return;
      this.updatePointerWorld();
      const enemy = this.pickEnemy();
      if (enemy) {
        this.player.attackTarget = enemy;
        this.player.target = null;
        this.tryAttack(enemy);
      } else {
        this.player.attackTarget = null;
        this.player.target = this.pointerWorld.clone();
        this.spawnClickMarker(this.player.target);
      }
    });

    window.addEventListener("keydown", (event) => {
      if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyQ", "KeyE", "KeyF", "KeyR", "Escape"].includes(event.code)) {
        event.preventDefault();
      }

      if (event.code === "Escape") {
        if (ui.rankingPanel.classList.contains("open")) {
          this.closeRanking();
          return;
        }
        if (this.state === "running") this.pause();
        else if (this.state === "paused") this.resume();
        return;
      }

      this.keys.add(event.code);
      if (this.state === "running") void this.audio.unlock();
      if (event.repeat || this.state !== "running") return;
      if (event.code === "Space") this.tryAttack();
      if (event.code === "KeyQ") this.castNova();
      if (event.code === "KeyE") this.castDash();
      if (event.code === "KeyF") this.castWard();
      if (event.code === "KeyR") this.usePotion();
    });

    window.addEventListener("keyup", (event) => this.keys.delete(event.code));

    ui.startButton.addEventListener("click", () => {
      void this.audio.unlock();
      this.syncPlayerName();
      this.startRun(this.hasSave());
    });
    ui.newRunButton.addEventListener("click", () => {
      void this.audio.unlock();
      this.syncPlayerName();
      void this.submitCurrentScore();
      this.startRun(false);
    });
    ui.pauseButton.addEventListener("click", () => this.pause());
    ui.resumeButton.addEventListener("click", () => this.resume());
    ui.restartButton.addEventListener("click", () => {
      void this.submitCurrentScore();
      this.startRun(false);
    });
    ui.retryButton.addEventListener("click", () => this.startRun(false));
    ui.continueButton.addEventListener("click", () => this.continueAfterVictory());
    ui.victoryRestartButton.addEventListener("click", () => {
      void this.audio.unlock();
      void this.submitCurrentScore();
      this.startRun(false);
    });
    ui.potionButton.addEventListener("click", () => this.usePotion());
    ui.audioButton.addEventListener("click", () => {
      this.audio.toggle();
      this.syncAudioButton();
    });
    ui.relicToggle.addEventListener("click", () => ui.relicDrawer.classList.toggle("collapsed"));
    ui.playerNameInput.addEventListener("change", () => this.syncPlayerName());
    ui.rankingButton.addEventListener("click", () => this.openRanking());
    ui.startRankingButton.addEventListener("click", () => this.openRanking());
    ui.rankingClose.addEventListener("click", () => this.closeRanking());
    ui.rankingTabs.forEach((tab) => {
      tab.addEventListener("click", () => this.loadRanking(tab.dataset.rankingType));
    });

    ui.skillButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const skill = button.dataset.skill;
        if (skill === "attack") this.tryAttack();
        if (skill === "nova") this.castNova();
        if (skill === "dash") this.castDash();
        if (skill === "ward") this.castWard();
      });
    });
  }

  initializeLeaderboard() {
    const profile = this.leaderboard.getProfile();
    ui.playerNameInput.value = profile.name;
    ui.rankingPlayerName.textContent = profile.name;
    ui.rankingMode.textContent = this.leaderboard.mode === "online" ? "全服榜" : "本地榜";
  }

  syncAudioButton() {
    const enabled = this.audio.isEnabled();
    ui.audioButton.classList.toggle("muted", !enabled);
    ui.audioButton.setAttribute("aria-pressed", String(enabled));
    ui.audioButton.setAttribute("aria-label", enabled ? "关闭声音" : "开启声音");
    ui.audioButton.title = enabled ? "关闭音乐与音效" : "开启音乐与音效";
  }

  syncPlayerName() {
    const profile = this.leaderboard.setPlayerName(ui.playerNameInput.value);
    ui.playerNameInput.value = profile.name;
    ui.rankingPlayerName.textContent = profile.name;
  }

  openRanking() {
    this.syncPlayerName();
    this.resumeAfterRanking = this.state === "running";
    if (this.resumeAfterRanking) this.state = "paused";
    ui.rankingPanel.classList.add("open");
    void this.loadRanking(this.rankingType);
  }

  closeRanking() {
    ui.rankingPanel.classList.remove("open");
    if (this.resumeAfterRanking && this.state === "paused") {
      this.state = "running";
      this.clock.getDelta();
    }
    this.resumeAfterRanking = false;
  }

  async loadRanking(type = "score") {
    this.rankingType = type === "points" ? "points" : "score";
    ui.rankingTabs.forEach((tab) => {
      const active = tab.dataset.rankingType === this.rankingType;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    ui.rankingValueLabel.textContent = this.rankingType === "points" ? "累计积分" : "最高分";
    ui.rankingList.innerHTML = '<li class="ranking-empty">正在读取试炼记录…</li>';
    const result = await this.leaderboard.list(this.rankingType, 20);
    this.renderRanking(result.entries, result.mode);
  }

  renderRanking(entries, mode) {
    ui.rankingMode.textContent = mode === "online" ? "全服在线" : "当前设备";
    ui.rankingList.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "ranking-empty";
      empty.textContent = this.rankingType === "points" ? "还没有累计积分，完成一次试炼即可上榜。" : "还没有成绩，成为第一位试炼者。";
      ui.rankingList.append(empty);
      return;
    }

    const currentPlayerId = this.leaderboard.getProfile().id;
    entries.forEach((entry, index) => {
      const item = document.createElement("li");
      const current = entry.isCurrentPlayer || entry.playerId === currentPlayerId;
      item.className = `ranking-entry${current ? " current" : ""}`;

      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(entry.rank ?? index + 1).padStart(2, "0");

      const identity = document.createElement("span");
      identity.className = "ranking-identity";
      const name = document.createElement("strong");
      name.textContent = entry.playerName || "无名旅者";
      const detail = document.createElement("small");
      detail.textContent = `最高第 ${entry.bestWave ?? 1} 波 · ${entry.kills ?? 0} 次击杀`;
      identity.append(name, detail);

      const value = document.createElement("strong");
      value.className = "ranking-value";
      value.textContent = formatScore(entry.value);
      item.append(rank, identity, value);
      ui.rankingList.append(item);
    });
  }

  async submitCurrentScore(statusElement) {
    const score = calculateScore(this.runStats);
    if (score.total <= 0) {
      if (statusElement) statusElement.textContent = "尚未获得积分";
      return null;
    }
    if (statusElement) statusElement.textContent = "正在同步成绩…";
    if (this.scoreSubmission) return this.scoreSubmission;
    this.scoreSubmission = this.leaderboard
      .submit(this.runId, this.runStats)
      .then((result) => {
        const modeText = result.mode === "online" ? "已同步全服榜" : result.fallback ? "网络不可用，已保存本地榜" : "已保存本地榜";
        const addedText = result.pointsAdded > 0 ? ` · 新增 ${formatScore(result.pointsAdded)} 分` : " · 成绩已记录";
        if (statusElement) statusElement.textContent = `${modeText}${addedText}`;
        if (ui.rankingPanel.classList.contains("open")) void this.loadRanking(this.rankingType);
        return result;
      })
      .finally(() => {
        this.scoreSubmission = null;
      });
    return this.scoreSubmission;
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const viewHeight = width < 700 ? 23 : 20;
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  updatePointerWorld() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.ground, false)[0];
    if (!hit) return;
    this.pointerWorld.copy(hit.point);
    this.cursor.position.x = this.pointerWorld.x;
    this.cursor.position.y = this.pointerWorld.y + 0.04;
    this.cursor.position.z = this.pointerWorld.z;
  }

  pickEnemy() {
    const hitboxes = this.enemies.filter((enemy) => !enemy.dead).map((enemy) => enemy.hitbox);
    const hit = this.raycaster.intersectObjects(hitboxes, false)[0];
    return hit?.object?.userData?.enemy ?? null;
  }

  startRun(fromSave) {
    this.clearRuntimeObjects();
    this.resetPlayerStats();
    this.wave = 1;
    this.kills = 0;
    this.victorySeen = false;
    this.runStats = createRunStats();
    this.runId = this.leaderboard.createRunId();
    this.scoreSubmission = null;
    this.worldOffset.set(0, 0);
    this.regionStates.clear();
    this.currentRegionKey = null;
    this.regionsCleared = 0;

    if (fromSave) this.loadSave();

    this.player.group.position.set(0, this.surfaceHeight(0, 6), 6);
    this.landmarks.position.set(-this.worldOffset.x, 0, -this.worldOffset.y);
    this.planet.rotation.x = this.worldOffset.y / this.planetRadius;
    this.planet.rotation.z = -this.worldOffset.x / this.planetRadius;
    this.player.target = null;
    this.player.attackTarget = null;
    this.player.action = null;
    this.player.invulnerable = 1.8;
    this.state = "running";
    this.nextWaveTimer = -1;
    this.skillState.attack.cooldown = 0;
    this.skillState.nova.cooldown = 0;
    this.skillState.dash.cooldown = 0;
    this.skillState.ward.cooldown = 0;
    document.body.classList.add("game-started");
    ui.startScreen.classList.remove("active");
    ui.pauseScreen.classList.remove("active");
    ui.deathScreen.classList.remove("active");
    ui.victoryScreen.classList.remove("active");
    this.updateCurrentRegion(true);
    this.updateUI();
  }

  resetPlayerStats() {
    Object.assign(this.player, {
      hp: 130,
      maxHp: 130,
      shield: 0,
      damage: 20,
      skillPower: 26,
      armor: 5,
      magicResist: 5,
      attackSpeed: 0,
      critChance: 0.08,
      gearScore: 0,
      level: 1,
      xp: 0,
      xpNeeded: 100,
      shards: 0,
      potions: 3,
      relics: [],
      invulnerable: 0,
      speed: 7.2,
      moving: false,
      running: false,
      action: null,
    });
  }

  clearRuntimeObjects() {
    this.enemies.forEach((enemy) => {
      if (enemy.telegraph) {
        this.scene.remove(enemy.telegraph.ring);
        this.scene.remove(enemy.telegraph.disc);
      }
    });
    [...this.enemies, ...this.projectiles, ...this.drops].forEach((entity) => {
      if (entity.group) this.scene.remove(entity.group);
      if (entity.mesh) this.scene.remove(entity.mesh);
      if (entity.trailLine) this.scene.remove(entity.trailLine);
    });
    this.effects.forEach((effect) => {
      if (effect.object) this.scene.remove(effect.object);
    });
    this.enemies = [];
    this.projectiles = [];
    this.drops = [];
    this.effects = [];
    this.floatLayer.replaceChildren();
    ui.bossBar.classList.add("hidden");
  }

  spawnWave() {
    const region = this.regionStates.get(this.currentRegionKey);
    if (region) this.spawnRegionPack(region);
  }

  chooseEnemyType(region) {
    const roll = Math.random();
    const biased = choose(region?.biome?.enemyBias ?? ["crawler", "wisp", "ranger", "brute"]);
    if ((region?.threat ?? 1) < 2 && biased === "brute" && roll < 0.68) return "crawler";
    if (roll > 0.82 && (region?.threat ?? 1) >= 2) return "brute";
    return biased;
  }

  updateCurrentRegion(force = false) {
    const worldPosition = this.getPlayerWorldPosition();
    const coordinates = getRegionCoordinates(worldPosition.x, worldPosition.y);
    const key = getRegionKey(coordinates.x, coordinates.z);
    if (!force && key === this.currentRegionKey) return;
    if (!force && this.currentRegionKey) {
      const current = this.regionStates.get(this.currentRegionKey);
      const hysteresis = 0.62;
      if (
        current &&
        Math.abs(worldPosition.x - current.x * REGION_SIZE) <
          REGION_SIZE * hysteresis &&
        Math.abs(worldPosition.y - current.z * REGION_SIZE) <
          REGION_SIZE * hysteresis
      ) {
        return;
      }
    }

    this.currentRegionKey = key;
    let region = this.regionStates.get(key);
    if (!region) {
      region = createRegionState(
        coordinates.x,
        coordinates.z,
        this.regionsCleared,
        this.player.level,
      );
      this.regionStates.set(key, region);
    }
    region.threat = getRegionThreat(
      region.x,
      region.z,
      this.regionsCleared + region.clears,
      this.player.level,
    );
    this.wave = region.threat;
    ui.zoneLabel.textContent = region.biome.name;
    ui.objectiveTitle.textContent = region.biome.subtitle;
    this.despawnDistantRegions();

    if (!region.active && Date.now() >= region.respawnAt) {
      this.spawnRegionPack(region);
    } else {
      this.syncRegionObjective(region);
    }
    this.addFeed(
      `<b>${region.biome.name}</b> · 威胁 ${region.threat} · 球面区域 ${region.x}, ${region.z}`,
    );
  }

  spawnRegionPack(region) {
    region.active = true;
    region.defeated = 0;
    region.threat = getRegionThreat(
      region.x,
      region.z,
      this.regionsCleared + region.clears,
      this.player.level,
    );
    const bossCycle = Math.abs(region.x * 5 + region.z * 7 + region.clears + this.regionsCleared);
    region.hasBoss = region.threat >= 2 && bossCycle % 2 === 1;
    const count = Math.min(12, 5 + Math.floor(region.threat * 0.7) + (region.hasBoss ? 1 : 0));
    region.enemyCount = count;
    this.waveActive = true;
    this.waveDefeated = 0;
    this.waveTotal = count;
    this.wave = region.threat;

    let rangedSpawned = 0;
    const rangedLimit = Math.min(
      count - 1,
      2 + Math.floor(Math.max(0, region.threat - 1) * 0.65),
    );
    for (let i = 0; i < count; i += 1) {
      let type = region.hasBoss && i === 0 ? "boss" : this.chooseEnemyType(region);
      if (["wisp", "ranger"].includes(type)) {
        if (rangedSpawned >= rangedLimit) {
          type = region.threat >= 2 && Math.random() > 0.55 ? "brute" : "crawler";
        } else {
          rangedSpawned += 1;
        }
      }
      const angle = (i / count) * Math.PI * 2 + rand(-0.42, 0.42);
      const radius = rand(14.5, LOCAL_SPAWN_RADIUS);
      const position = this.player.group.position
        .clone()
        .add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
      position.y = this.surfaceHeight(position.x, position.z);
      this.spawnEnemy(type, position, {
        regionKey: region.key,
        threat: region.threat,
        biome: region.biome,
      });
    }

    ui.bossBar.classList.toggle("hidden", !region.hasBoss);
    this.addFeed(
      region.hasBoss
        ? "<b>区域霸主苏醒</b> · 红色为物理冲击，紫色为魔法风暴"
        : `<b>${region.biome.name}</b> · 腐化族群重新出现`,
    );
    this.syncRegionObjective(region);
    this.updateUI();
  }

  syncRegionObjective(region) {
    if (!region) return;
    if (region.active) {
      const remaining = Math.max(0, region.enemyCount - region.defeated);
      ui.objectiveText.textContent = `区域敌人 ${remaining} · 刷新随机`;
      ui.objectivePercent.textContent = `${Math.round((region.defeated / Math.max(1, region.enemyCount)) * 100)}%`;
      ui.objectiveFill.style.width = `${(region.defeated / Math.max(1, region.enemyCount)) * 100}%`;
    } else {
      const seconds = Math.max(0, Math.ceil((region.respawnAt - Date.now()) / 1000));
      ui.objectiveText.textContent = seconds > 0 ? `腐化将在 ${seconds} 秒后重聚` : "腐化正在重新聚集";
      ui.objectivePercent.textContent = "探索";
      ui.objectiveFill.style.width = "0%";
    }
  }

  despawnDistantRegions() {
    const distantKeys = new Set();
    this.enemies.forEach((enemy) => {
      if (
        !enemy.dead &&
        enemy.regionKey !== this.currentRegionKey &&
        distanceXZ(enemy.group.position, this.player.group.position) > 28
      ) {
        distantKeys.add(enemy.regionKey);
      }
    });
    distantKeys.forEach((key) => {
      this.enemies
        .filter((enemy) => enemy.regionKey === key)
        .forEach((enemy) => {
          if (enemy.telegraph) {
            this.scene.remove(enemy.telegraph.ring);
            this.scene.remove(enemy.telegraph.disc);
          }
          this.scene.remove(enemy.group);
        });
      this.enemies = this.enemies.filter((enemy) => enemy.regionKey !== key);
      const region = this.regionStates.get(key);
      if (region) {
        region.active = false;
        region.defeated = 0;
        region.respawnAt = 0;
      }
    });
  }

  spawnEnemy(type, position, options = {}) {
    const presets = {
      crawler: {
        name: "锈牙爬兽",
        hp: 42,
        speed: 3.45,
        damage: 6,
        range: 1.25,
        xp: 18,
        radius: 0.62,
        armor: 2,
        magicResist: 1,
        damageType: "physical",
      },
      wisp: {
        name: "蚀光幽魂",
        hp: 34,
        speed: 3.15,
        damage: 6,
        range: 9,
        preferredRange: 7,
        xp: 22,
        radius: 0.5,
        armor: 1,
        magicResist: 8,
        ranged: true,
        damageType: "magic",
      },
      ranger: {
        name: "腐弦猎手",
        hp: 52,
        speed: 2.7,
        damage: 8,
        range: 11,
        preferredRange: 8.5,
        xp: 27,
        radius: 0.7,
        armor: 5,
        magicResist: 3,
        ranged: true,
        damageType: "physical",
      },
      brute: {
        name: "铸渣蛮兵",
        hp: 92,
        speed: 2.15,
        damage: 12,
        range: 1.65,
        xp: 34,
        radius: 0.9,
        armor: 10,
        magicResist: 2,
        damageType: "physical",
      },
      boss: {
        name: (options.threat ?? this.wave) > 3 ? "再铸暴君" : "熔铸暴君",
        hp: 520,
        speed: 1.72,
        damage: 21,
        range: 2.05,
        xp: 190,
        radius: 1.4,
        armor: 16,
        magicResist: 12,
        damageType: "physical",
      },
    };
    const base = presets[type];
    const threat = Math.max(1, options.threat ?? this.wave);
    const healthScale = 1 + Math.max(0, threat - 1) * (type === "boss" ? 0.3 : 0.22);
    const damageScale = 1 + Math.max(0, threat - 1) * (type === "boss" ? 0.17 : 0.135);
    const enemy = {
      type,
      name: base.name,
      group: new THREE.Group(),
      body: new THREE.Group(),
      hitbox: null,
      hp: Math.round(base.hp * healthScale),
      maxHp: Math.round(base.hp * healthScale),
      speed: base.speed,
      damage: Math.round(base.damage * damageScale),
      range: base.range,
      preferredRange: base.preferredRange ?? base.range,
      xp: Math.round(base.xp * healthScale),
      radius: base.radius,
      armor: Math.round(base.armor * (1 + Math.max(0, threat - 1) * 0.12)),
      magicResist: Math.round(base.magicResist * (1 + Math.max(0, threat - 1) * 0.12)),
      ranged: Boolean(base.ranged),
      damageType: base.damageType,
      threat,
      regionKey: options.regionKey ?? this.currentRegionKey,
      biome: options.biome,
      attackCooldown: base.ranged ? rand(1.35, 2.45) : rand(0.35, 0.95),
      specialCooldown: type === "boss" ? 2.8 : Infinity,
      specialIndex: 0,
      aggroDelay:
        type === "boss"
          ? rand(1.1, 1.8)
          : rand(
              Math.max(0.8, 2.25 - threat * 0.11),
              Math.max(1.35, 3.45 - threat * 0.12),
            ),
      attackAnim: 0,
      telegraph: null,
      flash: 0,
      dead: false,
      materials: [],
      phase: rand(0, Math.PI * 2),
    };
    enemy.group.position.copy(position);
    this.snapToSurface(enemy.group);
    enemy.group.add(enemy.body);
    this.buildEnemyModel(enemy);

    const hitbox = mesh(
      new THREE.CylinderGeometry(base.radius, base.radius, type === "boss" ? 3.8 : 2.2, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      false,
    );
    hitbox.position.y = type === "boss" ? 1.9 : 1.1;
    hitbox.userData.enemy = enemy;
    enemy.group.add(hitbox);
    enemy.hitbox = hitbox;

    this.createEnemyHealthBar(enemy);
    this.scene.add(enemy.group);
    this.enemies.push(enemy);

    if (type === "boss") {
      ui.bossBar.classList.remove("hidden");
      ui.bossName.textContent = enemy.name;
      ui.bossFill.style.transform = "scaleX(1)";
    }
  }

  buildEnemyModel(enemy) {
    const addPart = (geometry, material, position, rotation, scale) => {
      const part = mesh(geometry, material);
      if (material.userData.baseEmissive === undefined) {
        material.userData.baseEmissive = material.emissive.getHex();
        material.userData.baseIntensity = material.emissiveIntensity;
      }
      part.position.copy(position);
      if (rotation) part.rotation.set(rotation.x, rotation.y, rotation.z);
      if (scale) part.scale.copy(scale);
      enemy.body.add(part);
      enemy.materials.push(material);
      return part;
    };

    if (enemy.type === "crawler") {
      const shell = makeMaterial(0x6e3b2d, { roughness: 0.9 });
      const dark = makeMaterial(0x261d1b, { roughness: 1 });
      const glow = makeMaterial(0xf05b2d, { emissive: 0xe83f19, emissiveIntensity: 2.2 });
      addPart(new THREE.DodecahedronGeometry(0.58, 0), shell, new THREE.Vector3(0, 0.62, 0), null, new THREE.Vector3(1.25, 0.75, 1.45));
      addPart(new THREE.SphereGeometry(0.36, 8, 6), dark, new THREE.Vector3(0, 0.62, -0.62));
      [-1, 1].forEach((side) => {
        addPart(new THREE.ConeGeometry(0.08, 0.48, 5), shell, new THREE.Vector3(side * 0.22, 0.72, -0.93), new THREE.Euler(Math.PI / 2, 0, side * 0.14));
        addPart(new THREE.SphereGeometry(0.06, 6, 5), glow, new THREE.Vector3(side * 0.13, 0.76, -0.91));
      });
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i += 1) {
          addPart(
            new THREE.CylinderGeometry(0.035, 0.045, 0.75, 5),
            dark,
            new THREE.Vector3(side * (0.58 + i * 0.03), 0.35, -0.35 + i * 0.35),
            new THREE.Euler(0, 0, side * -1.05),
          );
        }
      }
    }

    if (enemy.type === "wisp") {
      const veil = makeMaterial(0x32736f, { roughness: 0.72, transparent: true, opacity: 0.86 });
      const glow = makeMaterial(0x6fe1c9, { emissive: 0x3dc6b4, emissiveIntensity: 2.4 });
      addPart(new THREE.ConeGeometry(0.55, 1.45, 7, 1, true), veil, new THREE.Vector3(0, 0.84, 0));
      addPart(new THREE.SphereGeometry(0.36, 10, 8), veil, new THREE.Vector3(0, 1.48, 0));
      addPart(new THREE.OctahedronGeometry(0.17, 0), glow, new THREE.Vector3(0, 1.45, -0.28));
      for (let i = 0; i < 3; i += 1) {
        const ribbon = addPart(
          new THREE.ConeGeometry(0.09, 0.72, 5),
          veil,
          new THREE.Vector3((i - 1) * 0.23, 0.05, 0.1),
          new THREE.Euler(0, 0, (i - 1) * 0.22),
        );
        ribbon.userData.ribbon = true;
      }
    }

    if (enemy.type === "ranger") {
      const leather = makeMaterial(0x563526, { roughness: 0.9 });
      const hood = makeMaterial(0x273d3a, { roughness: 0.96 });
      const bone = makeMaterial(0xb6956b, { roughness: 0.78 });
      const toxin = makeMaterial(0x9bd35a, {
        emissive: 0x5fa62c,
        emissiveIntensity: 2.1,
        roughness: 0.3,
      });
      addPart(
        new THREE.ConeGeometry(0.56, 1.55, 7),
        leather,
        new THREE.Vector3(0, 0.86, 0),
      );
      addPart(
        new THREE.SphereGeometry(0.39, 9, 7),
        hood,
        new THREE.Vector3(0, 1.66, 0),
      );
      addPart(
        new THREE.BoxGeometry(0.44, 0.08, 0.05),
        toxin,
        new THREE.Vector3(0, 1.65, -0.37),
      );
      const bow = addPart(
        new THREE.TorusGeometry(0.58, 0.045, 5, 18, Math.PI * 1.5),
        bone,
        new THREE.Vector3(-0.66, 1.08, -0.12),
        new THREE.Euler(0, 0.28, Math.PI * 0.2),
      );
      bow.userData.weapon = true;
      addPart(
        new THREE.CylinderGeometry(0.025, 0.025, 1.18, 5),
        toxin,
        new THREE.Vector3(0.34, 1.15, -0.45),
        new THREE.Euler(Math.PI / 2, 0, 0.12),
      );
    }

    if (enemy.type === "brute") {
      const slag = makeMaterial(0x434541, { roughness: 0.97 });
      const iron = makeMaterial(0x57463c, { roughness: 0.58, metalness: 0.48 });
      const ember = makeMaterial(0xff7335, { emissive: 0xe94a1d, emissiveIntensity: 2.5 });
      addPart(new THREE.DodecahedronGeometry(0.86, 0), slag, new THREE.Vector3(0, 1.1, 0), null, new THREE.Vector3(1, 1.2, 0.82));
      addPart(new THREE.BoxGeometry(1.5, 0.22, 0.28), iron, new THREE.Vector3(0, 1.55, -0.2));
      addPart(new THREE.DodecahedronGeometry(0.48, 0), slag, new THREE.Vector3(0, 2, -0.04));
      addPart(new THREE.BoxGeometry(0.48, 0.11, 0.06), ember, new THREE.Vector3(0, 2.04, -0.47));
      [-1, 1].forEach((side) => {
        addPart(new THREE.DodecahedronGeometry(0.42, 0), slag, new THREE.Vector3(side * 0.88, 1.32, 0));
        addPart(new THREE.CylinderGeometry(0.2, 0.25, 0.95, 6), iron, new THREE.Vector3(side * 0.96, 0.7, 0), new THREE.Euler(0, 0, side * -0.08));
      });
    }

    if (enemy.type === "boss") {
      const armor = makeMaterial(0x4e4b45, { roughness: 0.62, metalness: 0.44 });
      const rust = makeMaterial(0x713626, { roughness: 0.72, metalness: 0.24 });
      const core = makeMaterial(0xff6b2e, { emissive: 0xff4318, emissiveIntensity: 3.2 });
      const dark = makeMaterial(0x201b19, { roughness: 0.9 });
      addPart(new THREE.CylinderGeometry(1.1, 1.34, 2.1, 7), armor, new THREE.Vector3(0, 1.52, 0));
      addPart(new THREE.DodecahedronGeometry(0.78, 0), dark, new THREE.Vector3(0, 2.92, 0));
      addPart(new THREE.BoxGeometry(1.15, 0.24, 0.14), core, new THREE.Vector3(0, 2.9, -0.7));
      addPart(new THREE.CylinderGeometry(0.32, 0.44, 2.2, 7), rust, new THREE.Vector3(-1.35, 1.42, 0), new THREE.Euler(0, 0, -0.18));
      addPart(new THREE.CylinderGeometry(0.32, 0.44, 2.2, 7), rust, new THREE.Vector3(1.35, 1.42, 0), new THREE.Euler(0, 0, 0.18));
      [-1, 1].forEach((side) => {
        addPart(
          new THREE.ConeGeometry(0.22, 1.18, 6),
          rust,
          new THREE.Vector3(side * 0.54, 3.65, 0),
          new THREE.Euler(0, 0, side * -0.45),
        );
        addPart(new THREE.DodecahedronGeometry(0.48, 0), armor, new THREE.Vector3(side * 1.34, 2.26, 0));
      });
      addPart(new THREE.OctahedronGeometry(0.55, 0), core, new THREE.Vector3(0, 1.62, -1.05));
      enemy.body.scale.setScalar(1.16);
    }

    const shadow = mesh(
      new THREE.CircleGeometry(enemy.radius * 1.1, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
      false,
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    enemy.group.add(shadow);
  }

  createEnemyHealthBar(enemy) {
    if (enemy.type === "boss") return;
    const group = new THREE.Group();
    group.position.y = enemy.type === "brute" ? 2.9 : 2.25;
    const bg = mesh(
      new THREE.PlaneGeometry(1.28, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x130b0a, transparent: true, opacity: 0.8, depthTest: false }),
      false,
    );
    group.add(bg);
    const fill = mesh(
      new THREE.PlaneGeometry(1.2, 0.055),
      new THREE.MeshBasicMaterial({ color: 0xe55f37, depthTest: false }),
      false,
    );
    fill.position.z = 0.01;
    group.add(fill);
    enemy.healthFill = fill;
    enemy.healthBar = group;
    enemy.group.add(group);
  }

  updatePlayer(dt) {
    const player = this.player;
    const position = player.group.position;
    const action = this.updatePlayerAction(dt);
    const movementLocked = Boolean(action?.lockMovement);
    const keyboardDirection = new THREE.Vector3(
      (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0),
      0,
      (this.keys.has("KeyS") ? 1 : 0) - (this.keys.has("KeyW") ? 1 : 0),
    );
    const wantsRun = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");

    player.moving = false;
    player.running = false;
    if (!movementLocked && keyboardDirection.lengthSq() > 0) {
      keyboardDirection.normalize();
      player.running = wantsRun;
      position.addScaledVector(keyboardDirection, player.speed * (player.running ? 1.55 : 1) * dt);
      player.aimDirection.lerp(keyboardDirection, 0.22).normalize();
      player.target = null;
      player.attackTarget = null;
      player.moving = true;
    } else if (!movementLocked && player.attackTarget && !player.attackTarget.dead) {
      const targetPosition = player.attackTarget.group.position;
      const distance = distanceXZ(position, targetPosition);
      const direction = targetPosition.clone().sub(position).setY(0).normalize();
      player.aimDirection.lerp(direction, 0.28).normalize();
      if (distance > 11.2) {
        player.running = distance > 12 || wantsRun;
        position.addScaledVector(direction, player.speed * (player.running ? 1.42 : 1) * dt);
        player.moving = true;
      } else {
        this.tryAttack(player.attackTarget);
      }
    } else if (!movementLocked && player.target) {
      const direction = player.target.clone().sub(position).setY(0);
      const distance = direction.length();
      if (distance > 0.18) {
        direction.normalize();
        player.running = wantsRun || distance > 7;
        const movementSpeed = player.speed * (player.running ? 1.48 : 1);
        position.addScaledVector(direction, Math.min(movementSpeed * dt, distance));
        player.aimDirection.lerp(direction, 0.22).normalize();
        player.moving = true;
      } else {
        player.target = null;
      }
    }

    this.snapToSurface(player.group);
    this.recenterWorldIfNeeded();

    const targetYaw = Math.atan2(player.aimDirection.x, player.aimDirection.z);
    player.body.rotation.y = this.lerpAngle(player.body.rotation.y, targetYaw, 1 - Math.pow(0.001, dt));
    this.animatePlayerRig(dt);
    this.playerRing.material.opacity = 0.26 + Math.sin(this.elapsed * 3) * 0.08;

    player.invulnerable = Math.max(0, player.invulnerable - dt);
    if (player.invulnerable > 0) {
      player.body.visible = Math.floor(player.invulnerable * 18) % 2 === 0;
    } else {
      player.body.visible = true;
    }
  }

  recenterWorldIfNeeded() {
    const position = this.player.group.position;
    if (Math.hypot(position.x, position.z) < RECENTER_DISTANCE) return;

    const shift = new THREE.Vector3(position.x, 0, position.z);
    this.worldOffset.x += shift.x;
    this.worldOffset.y += shift.z;
    position.x = 0;
    position.z = 0;
    this.snapToSurface(this.player.group);

    const shiftedObjects = new Set();
    this.enemies.forEach((enemy) => {
      enemy.group.position.sub(shift);
      this.snapToSurface(enemy.group);
      shiftedObjects.add(enemy.group);
      if (enemy.telegraph) {
        enemy.telegraph.origin.sub(shift);
        enemy.telegraph.ring.position.sub(shift);
        enemy.telegraph.disc?.position.sub(shift);
      }
    });
    this.drops.forEach((drop) => drop.mesh.position.sub(shift));
    this.projectiles.forEach((projectile) => {
      projectile.mesh.position.sub(shift);
      projectile.trailPositions?.forEach((point) => point.sub(shift));
    });
    this.effects.forEach((effect) => {
      if (effect.object && !shiftedObjects.has(effect.object)) effect.object.position.sub(shift);
    });

    this.landmarks.position.sub(shift);
    this.decor.position.sub(shift);
    if (Math.hypot(this.decor.position.x, this.decor.position.z) > 42) {
      this.decor.position.set(0, 0, 0);
    }
    this.player.target?.sub(shift);
    this.pointerWorld.sub(shift);
    this.cursor.position.sub(shift);
    this.camera.position.sub(shift);
    this.cameraTarget.sub(shift);
    this.planet.rotation.x += shift.z / this.planetRadius;
    this.planet.rotation.z -= shift.x / this.planetRadius;
    this.updateCurrentRegion();
  }

  beginPlayerAction(name, duration, onRelease, releaseAt = 0.58, lockMovement = true) {
    if (this.player.action) return false;
    this.player.action = {
      name,
      time: 0,
      duration,
      releaseAt,
      released: false,
      onRelease,
      lockMovement,
    };
    return true;
  }

  updatePlayerAction(dt) {
    const action = this.player.action;
    if (!action) return null;
    action.time += dt;
    if (!action.released && action.time >= action.duration * action.releaseAt) {
      action.released = true;
      action.onRelease?.();
    }
    if (action.time >= action.duration) {
      this.player.action = null;
    }
    return action;
  }

  animatePlayerRig(dt) {
    const player = this.player;
    const rig = player.rig;
    if (!rig) return;
    const action = player.action;
    const speed = player.running ? 14 : 9;
    const phase = this.elapsed * speed;
    const swing = player.moving ? Math.sin(phase) : 0;
    const bounce = player.moving
      ? Math.abs(Math.sin(phase)) * (player.running ? 0.11 : 0.065)
      : Math.sin(this.elapsed * 2.2) * 0.022;
    const blend = 1 - Math.pow(0.00008, dt);
    const settle = (object, x = 0, y = 0, z = 0) => {
      object.rotation.x = THREE.MathUtils.lerp(object.rotation.x, x, blend);
      object.rotation.y = THREE.MathUtils.lerp(object.rotation.y, y, blend);
      object.rotation.z = THREE.MathUtils.lerp(object.rotation.z, z, blend);
    };

    let torsoX = player.running && player.moving ? -0.16 : 0;
    let torsoZ = player.moving ? swing * (player.running ? 0.045 : 0.025) : 0;
    let leftArmX = player.moving ? swing * (player.running ? 0.78 : 0.42) : 0.06;
    let rightArmX = player.moving ? -swing * (player.running ? 0.5 : 0.26) : -0.04;
    let leftArmZ = 0.08;
    let rightArmZ = -0.1;
    let leftLegX = player.moving ? -swing * (player.running ? 0.86 : 0.48) : 0;
    let rightLegX = player.moving ? swing * (player.running ? 0.86 : 0.48) : 0;
    let cloakX = player.running && player.moving ? 0.12 : 0;
    let tailX = player.moving ? 0.18 + Math.abs(swing) * (player.running ? 0.42 : 0.18) : -0.12;
    let bodyScaleX = 1;
    let bodyScaleY = 1;
    let bodyScaleZ = 1;

    if (action) {
      const p = clamp(action.time / action.duration, 0, 1);
      const pulse = Math.sin(p * Math.PI);
      if (action.name === "attack") {
        const strike = p < 0.38 ? p / 0.38 : (p - 0.38) / 0.62;
        rightArmX = p < 0.38 ? THREE.MathUtils.lerp(-0.05, 1.05, strike) : THREE.MathUtils.lerp(1.05, -1.12, Math.sin(strike * Math.PI * 0.5));
        rightArmZ = -0.42 * pulse;
        leftArmX = -0.4 * pulse;
        leftArmZ = 0.34 * pulse;
        torsoX = -0.12 * pulse;
        torsoZ = -0.16 * pulse;
        tailX = 0.34 * pulse;
      }
      if (action.name === "nova") {
        const charge = Math.sin(Math.min(1, p / 0.72) * Math.PI * 0.5);
        leftArmX = -1.34 * charge;
        rightArmX = -1.18 * charge;
        leftArmZ = 0.72 * charge;
        rightArmZ = -0.72 * charge;
        torsoX = -0.18 * charge;
        torsoZ = Math.sin(p * Math.PI * 6) * 0.025 * charge;
        tailX = 0.48 * charge;
        bodyScaleY = 1 + pulse * 0.045;
      }
      if (action.name === "ward") {
        const charge = Math.sin(Math.min(1, p / 0.68) * Math.PI * 0.5);
        leftArmX = -1.48 * charge;
        leftArmZ = 0.18 * charge;
        rightArmX = -0.74 * charge;
        rightArmZ = -0.3 * charge;
        torsoX = -0.1 * charge;
        tailX = 0.28 * charge;
      }
      if (action.name === "dash") {
        torsoX = -0.56 * pulse;
        leftArmX = 1.05 * pulse;
        rightArmX = 0.9 * pulse;
        leftLegX = -0.38 * pulse;
        rightLegX = 0.38 * pulse;
        tailX = 0.95 * pulse;
        bodyScaleX = 1 - pulse * 0.08;
        bodyScaleY = 1 - pulse * 0.12;
        bodyScaleZ = 1 + pulse * 0.3;
      }
    }

    player.body.position.y = THREE.MathUtils.lerp(player.body.position.y, bounce + 0.02, blend);
    player.body.rotation.z = THREE.MathUtils.lerp(player.body.rotation.z, torsoZ * 0.35, blend);
    player.body.scale.x = THREE.MathUtils.lerp(player.body.scale.x, bodyScaleX, blend);
    player.body.scale.y = THREE.MathUtils.lerp(player.body.scale.y, bodyScaleY, blend);
    player.body.scale.z = THREE.MathUtils.lerp(player.body.scale.z, bodyScaleZ, blend);
    settle(rig.torso, torsoX, 0, torsoZ);
    settle(rig.leftArm, leftArmX, 0, leftArmZ);
    settle(rig.rightArm, rightArmX, 0, rightArmZ);
    settle(rig.leftLeg, leftLegX);
    settle(rig.rightLeg, rightLegX);
    rig.cloak.rotation.x = THREE.MathUtils.lerp(rig.cloak.rotation.x, cloakX, blend);
    rig.cloakTail.rotation.x = THREE.MathUtils.lerp(rig.cloakTail.rotation.x, tailX, blend);
    rig.hoodPivot.rotation.y = THREE.MathUtils.lerp(
      rig.hoodPivot.rotation.y,
      player.moving ? -swing * 0.045 : Math.sin(this.elapsed * 0.8) * 0.08,
      blend,
    );
    rig.staff.rotation.z = THREE.MathUtils.lerp(rig.staff.rotation.z, -0.08 + (player.running ? swing * 0.045 : 0), blend);
    rig.staffGem.rotation.y += dt * (action ? 6 : 1.2);
    rig.eye.material.emissiveIntensity = 2.4 + Math.sin(this.elapsed * (action ? 11 : 3)) * (action ? 1.1 : 0.25);
  }

  lerpAngle(from, to, alpha) {
    let delta = (to - from) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta * alpha;
  }

  tryAttack(preferredTarget) {
    this.skillState.attack.max = Math.max(
      0.2,
      0.42 / (1 + this.player.attackSpeed),
    );
    if (this.state !== "running" || this.skillState.attack.cooldown > 0 || this.player.action) return;
    let target = preferredTarget;
    if (!target || target.dead || distanceXZ(this.player.group.position, target.group.position) > 13) {
      target = this.findNearestEnemy(13);
    }
    if (!target) {
      this.addFeed("射程内没有目标");
      return;
    }

    const started = this.beginPlayerAction("attack", 0.38, () => this.fireProjectile(target), 0.46, true);
    if (!started) return;
    this.audio.play("attackCast");
    this.skillState.attack.cooldown = this.skillState.attack.max;
    this.player.aimDirection.copy(target.group.position).sub(this.player.group.position).setY(0).normalize();
  }

  fireProjectile(target) {
    if (!target || target.dead) target = this.findNearestEnemy(13);
    if (!target) return;
    this.audio.play("attackRelease");
    this.player.rig.staffGem.updateWorldMatrix(true, false);
    const start = this.player.rig.staffGem.getWorldPosition(new THREE.Vector3());
    const projectileGroup = new THREE.Group();
    projectileGroup.position.copy(start);
    const core = mesh(
      new THREE.IcosahedronGeometry(0.17, 1),
      makeMaterial(0xffa45f, {
        emissive: 0xff571f,
        emissiveIntensity: 4.2,
        roughness: 0.12,
      }),
      false,
    );
    projectileGroup.add(core);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xffbb76,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const haloA = mesh(new THREE.TorusGeometry(0.27, 0.018, 5, 24), haloMaterial, false);
    const haloB = haloA.clone();
    haloA.rotation.x = Math.PI / 2;
    haloB.rotation.y = Math.PI / 2;
    projectileGroup.add(haloA, haloB);
    this.scene.add(projectileGroup);

    const trailPositions = Array.from({ length: 9 }, () => start.clone());
    const trailArray = new Float32Array(trailPositions.length * 3);
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailArray, 3));
    const trailLine = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: 0xff8b47, transparent: true, opacity: 0.68, depthWrite: false }),
    );
    this.scene.add(trailLine);

    this.projectiles.push({
      mesh: projectileGroup,
      core,
      haloA,
      haloB,
      trailLine,
      trailPositions,
      trailGeometry,
      target,
      speed: 19,
      damage: this.player.damage,
      damageType: "physical",
      critical: Math.random() < this.player.critChance,
      life: 1.4,
    });
    this.createMuzzleBurst(start);
  }

  castNova() {
    const skill = this.skillState.nova;
    if (this.state !== "running" || skill.cooldown > 0 || this.player.action) return;
    const started = this.beginPlayerAction("nova", 0.86, () => this.releaseNova(), 0.7, true);
    if (!started) return;
    this.audio.play("novaCast");
    skill.cooldown = skill.max;
    this.spawnCastingEffect(0xff7838, 0.86, "nova");
    this.addFeed("<b>余烬震环</b> · 正在吟唱");
  }

  releaseNova() {
    this.audio.play("novaRelease", 1.12);
    const center = this.player.group.position.clone();
    const damage = Math.round(this.player.skillPower * 1.65 + this.player.damage * 0.35);
    this.spawnRing(center, 5.2, 0xe76f34, 0.55);
    this.spawnEnergyColumn(center, 0xff7738, 0.42, 4.8);
    this.spawnBurst(center.clone().add(new THREE.Vector3(0, 0.35, 0)), 22, 0xff8b46, 7);
    this.cameraShake = Math.max(this.cameraShake, 0.24);
    this.enemies.forEach((enemy) => {
      if (!enemy.dead && distanceXZ(center, enemy.group.position) <= 5.4) {
        this.damageEnemy(enemy, damage, true, "magic");
        const push = enemy.group.position.clone().sub(center).setY(0).normalize();
        enemy.group.position.addScaledVector(push, enemy.type === "boss" ? 0.6 : 1.4);
      }
    });
    this.addFeed("<b>余烬震环</b> · 腐化被震退");
  }

  castDash() {
    const skill = this.skillState.dash;
    if (this.state !== "running" || skill.cooldown > 0 || this.player.action) return;
    const started = this.beginPlayerAction("dash", 0.34, null, 0.2, true);
    if (!started) return;
    this.audio.play("dash");
    skill.cooldown = skill.max;
    const start = this.player.group.position.clone();
    let direction = this.pointerWorld.clone().sub(start).setY(0);
    if (direction.lengthSq() < 0.2) direction.copy(this.player.aimDirection);
    direction.normalize();
    const destination = start.clone().addScaledVector(direction, 6.2);
    destination.y = this.surfaceHeight(destination.x, destination.z);
    this.player.group.position.copy(destination);
    this.player.aimDirection.copy(direction);
    this.player.invulnerable = 0.38;
    this.spawnDashTrail(start, destination);
    this.spawnAfterimages(start, destination);
    this.spawnBurst(start.clone().add(new THREE.Vector3(0, 0.8, 0)), 10, 0x69d4c3, 4);
    this.spawnRing(destination, 1.4, 0x5cc9bb, 0.32);
    this.cameraShake = Math.max(this.cameraShake, 0.08);
  }

  castWard() {
    const skill = this.skillState.ward;
    if (this.state !== "running" || skill.cooldown > 0 || this.player.action) return;
    const started = this.beginPlayerAction("ward", 0.74, () => this.releaseWard(), 0.66, true);
    if (!started) return;
    this.audio.play("wardCast");
    skill.cooldown = skill.max;
    this.spawnCastingEffect(0x74d5ce, 0.74, "ward");
    this.addFeed("<b>铜卫结界</b> · 正在构筑");
  }

  releaseWard() {
    this.audio.play("wardRelease");
    this.player.shield = Math.round(this.player.maxHp * 0.38);
    const shieldGroup = new THREE.Group();
    const shield = mesh(
      new THREE.IcosahedronGeometry(1.12, 2),
      new THREE.MeshBasicMaterial({
        color: 0x79d8d2,
        transparent: true,
        opacity: 0.12,
        wireframe: true,
        depthWrite: false,
      }),
      false,
    );
    shieldGroup.add(shield);
    const shieldRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x8fe5dc,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const ringA = mesh(new THREE.TorusGeometry(1.15, 0.018, 5, 40), shieldRingMaterial, false);
    const ringB = ringA.clone();
    ringA.rotation.x = Math.PI / 2;
    ringB.rotation.y = Math.PI / 2;
    shieldGroup.add(ringA, ringB);
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const plate = mesh(
        new THREE.BoxGeometry(0.18, 0.34, 0.035),
        new THREE.MeshBasicMaterial({ color: 0xb1eee6, transparent: true, opacity: 0.48, depthWrite: false }),
        false,
      );
      plate.position.set(Math.cos(angle) * 1.22, Math.sin(angle * 2) * 0.35, Math.sin(angle) * 1.22);
      plate.lookAt(0, 0, 0);
      shieldGroup.add(plate);
    }
    shieldGroup.position.copy(this.player.group.position).add(new THREE.Vector3(0, 1.12, 0));
    this.scene.add(shieldGroup);
    this.spawnRing(this.player.group.position.clone(), 2.25, 0x74d8cf, 0.45);
    this.spawnBurst(this.player.group.position.clone().add(new THREE.Vector3(0, 1, 0)), 14, 0x8de0d7, 4);
    this.effects.push({
      object: shieldGroup,
      life: 8,
      maxLife: 8,
      update: (effect, dt) => {
        effect.object.position.copy(this.player.group.position).add(new THREE.Vector3(0, 1.1, 0));
        effect.object.rotation.y += dt * 0.72;
        effect.object.rotation.x = Math.sin(this.elapsed * 0.8) * 0.08;
        shield.material.opacity = Math.min(0.14, effect.life * 0.05) * (this.player.shield > 0 ? 1 : 0);
        ringA.rotation.z += dt * 0.5;
        ringB.rotation.z -= dt * 0.38;
        if (this.player.shield <= 0) effect.life = 0;
      },
    });
    this.addFeed(`<b>铜卫结界</b> · 获得 ${this.player.shield} 点护盾`);
    this.updateUI();
  }

  usePotion() {
    if (this.state !== "running" || this.player.potions <= 0 || this.player.hp >= this.player.maxHp) return;
    this.player.potions -= 1;
    const healed = Math.min(Math.round(this.player.maxHp * 0.45), this.player.maxHp - this.player.hp);
    this.player.hp += healed;
    this.audio.play("potion");
    this.spawnRing(this.player.group.position.clone(), 1.8, 0x7bd6b6, 0.45);
    this.spawnDamageNumber(this.player.group.position, `+${healed}`, "#8ee1ba");
    this.updateUI();
    this.saveGame();
  }

  findNearestEnemy(range = Infinity) {
    let nearest = null;
    let nearestDistance = range;
    this.enemies.forEach((enemy) => {
      if (enemy.dead) return;
      const distance = distanceXZ(this.player.group.position, enemy.group.position);
      if (distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  fireEnemyProjectile(enemy) {
    if (!enemy || enemy.dead) return;
    const magic = enemy.damageType === "magic";
    this.audio.play(magic ? "enemyMagicShot" : "enemyPhysicalShot", 0.7);
    const color = magic ? 0xa87cff : 0xd9b36f;
    const group = new THREE.Group();
    group.position.copy(enemy.group.position).add(
      new THREE.Vector3(0, enemy.type === "wisp" ? 1.45 : 1.2, 0),
    );
    const core = mesh(
      magic
        ? new THREE.OctahedronGeometry(0.2, 0)
        : new THREE.CylinderGeometry(0.045, 0.045, 0.72, 6),
      makeMaterial(color, {
        emissive: color,
        emissiveIntensity: magic ? 3.6 : 1.5,
        roughness: 0.25,
      }),
      false,
    );
    if (!magic) core.rotation.x = Math.PI / 2;
    group.add(core);
    const halo = mesh(
      new THREE.TorusGeometry(magic ? 0.31 : 0.17, 0.018, 5, 20),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      }),
      false,
    );
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    this.scene.add(group);

    const target = this.player.group.position
      .clone()
      .add(new THREE.Vector3(rand(-0.2, 0.2), 1.1, rand(-0.2, 0.2)));
    const velocity = target
      .sub(group.position)
      .normalize()
      .multiplyScalar(magic ? 10.5 : 14.5);
    const trailPositions = Array.from({ length: 7 }, () => group.position.clone());
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(trailPositions.length * 3), 3),
    );
    const trailLine = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }),
    );
    this.scene.add(trailLine);
    this.projectiles.push({
      hostile: true,
      source: enemy,
      mesh: group,
      core,
      haloA: halo,
      haloB: halo,
      trailLine,
      trailPositions,
      trailGeometry,
      velocity,
      damage: enemy.damage,
      damageType: enemy.damageType,
      life: 2.6,
    });
  }

  removeProjectile(index) {
    const projectile = this.projectiles[index];
    if (!projectile) return;
    this.scene.remove(projectile.mesh);
    this.scene.remove(projectile.trailLine);
    this.projectiles.splice(index, 1);
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      projectile.life -= dt;
      if (projectile.hostile) {
        if (projectile.life <= 0 || projectile.source?.dead) {
          this.removeProjectile(i);
          continue;
        }
        projectile.mesh.position.addScaledVector(projectile.velocity, dt);
        projectile.core.rotation.y += dt * 8;
        projectile.haloA.rotation.z += dt * 7;
        if (
          projectile.mesh.position.distanceTo(
            this.player.group.position.clone().add(new THREE.Vector3(0, 1.05, 0)),
          ) < 0.78
        ) {
          this.damagePlayer(
            projectile.damage,
            projectile.source,
            projectile.damageType,
          );
          this.spawnBurst(projectile.mesh.position.clone(), 7, projectile.damageType === "magic" ? 0xa87cff : 0xd9b36f, 4);
          this.removeProjectile(i);
          continue;
        }
        projectile.trailPositions.unshift(projectile.mesh.position.clone());
        projectile.trailPositions.length = 7;
        const hostileAttribute = projectile.trailGeometry.getAttribute("position");
        projectile.trailPositions.forEach((point, index) => {
          hostileAttribute.setXYZ(index, point.x, point.y, point.z);
        });
        hostileAttribute.needsUpdate = true;
        continue;
      }
      if (projectile.life <= 0 || projectile.target.dead) {
        this.removeProjectile(i);
        continue;
      }
      const target = projectile.target.group.position.clone().add(new THREE.Vector3(0, projectile.target.type === "boss" ? 1.9 : 1, 0));
      const direction = target.sub(projectile.mesh.position);
      const distance = direction.length();
      if (distance < 0.45) {
        this.damageEnemy(
          projectile.target,
          projectile.damage,
          projectile.critical,
          projectile.damageType,
        );
        this.spawnBurst(projectile.mesh.position.clone(), 7, 0xff7838, 4);
        this.spawnRing(projectile.target.group.position.clone(), 0.72, 0xff8a49, 0.2);
        this.removeProjectile(i);
      } else {
        projectile.mesh.position.addScaledVector(direction.normalize(), projectile.speed * dt);
        projectile.core.scale.setScalar(0.88 + Math.sin(this.elapsed * 28) * 0.14);
        projectile.haloA.rotation.z += dt * 8;
        projectile.haloB.rotation.x += dt * 7;
        projectile.trailPositions.unshift(projectile.mesh.position.clone());
        projectile.trailPositions.length = 9;
        const attribute = projectile.trailGeometry.getAttribute("position");
        projectile.trailPositions.forEach((point, index) => {
          attribute.setXYZ(index, point.x, point.y, point.z);
        });
        attribute.needsUpdate = true;
        projectile.trailLine.material.opacity = clamp(projectile.life * 0.8, 0, 0.68);
      }
    }
  }

  updateEnemies(dt) {
    const playerPosition = this.player.group.position;
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i];
      if (enemy.dead) continue;
      enemy.attackCooldown -= dt;
      enemy.specialCooldown -= dt;
      enemy.aggroDelay -= dt;
      enemy.attackAnim = Math.max(0, enemy.attackAnim - dt);
      enemy.flash = Math.max(0, enemy.flash - dt);

      enemy.materials.forEach((material) => {
        if (!material.emissive) return;
        if (enemy.flash > 0) {
          material.emissive.setHex(0xffb476);
          material.emissiveIntensity = Math.max(material.emissiveIntensity, 1.7);
        } else {
          material.emissive.setHex(material.userData.baseEmissive);
          material.emissiveIntensity = material.userData.baseIntensity;
        }
      });

      const toPlayer = playerPosition.clone().sub(enemy.group.position).setY(0);
      const distance = toPlayer.length();
      const direction = toPlayer.normalize();

      const separation = new THREE.Vector3();
      for (let j = 0; j < this.enemies.length; j += 1) {
        if (i === j || this.enemies[j].dead) continue;
        const other = this.enemies[j];
        const apart = enemy.group.position.clone().sub(other.group.position).setY(0);
        const minDistance = enemy.radius + other.radius;
        const actual = apart.length();
        if (actual > 0 && actual < minDistance) {
          separation.add(apart.normalize().multiplyScalar((minDistance - actual) * 0.75));
        }
      }

      if (enemy.telegraph) {
        this.updateBossTelegraph(enemy, dt);
      } else if (enemy.type === "boss" && enemy.specialCooldown <= 0 && distance < 18) {
        this.startBossTelegraph(enemy);
      } else if (enemy.ranged) {
        if (enemy.aggroDelay > 0 || distance > enemy.range) {
          direction.add(separation).normalize();
          enemy.group.position.addScaledVector(
            direction,
            enemy.speed * dt * (enemy.aggroDelay > 0 ? 0.42 : 1),
          );
        } else if (distance < enemy.preferredRange * 0.68) {
          direction.multiplyScalar(-1).add(separation).normalize();
          enemy.group.position.addScaledVector(direction, enemy.speed * dt * 0.9);
        } else {
          const strafe = new THREE.Vector3(-direction.z, 0, direction.x)
            .multiplyScalar(Math.sin(this.elapsed * 1.6 + enemy.phase) * 0.42)
            .add(separation)
            .normalize();
          enemy.group.position.addScaledVector(strafe, enemy.speed * dt * 0.32);
          if (enemy.attackCooldown <= 0) {
            enemy.attackCooldown = enemy.type === "wisp" ? rand(1.45, 1.9) : rand(1.15, 1.55);
            enemy.attackAnim = 0.44;
            this.fireEnemyProjectile(enemy);
          }
        }
      } else if (distance > enemy.range || enemy.aggroDelay > 0) {
        direction.add(separation).normalize();
        enemy.group.position.addScaledVector(
          direction,
          enemy.speed * dt * (enemy.aggroDelay > 0 ? 0.48 : 1),
        );
      } else if (enemy.attackCooldown <= 0) {
        enemy.attackCooldown = enemy.type === "boss" ? 1.25 : rand(0.78, 1.16);
        enemy.attackAnim = enemy.type === "boss" ? 0.52 : 0.34;
        this.damagePlayer(enemy.damage, enemy, enemy.damageType);
        enemy.body.scale.y = 0.84;
      }

      this.snapToSurface(enemy.group);
      enemy.body.rotation.y = this.lerpAngle(enemy.body.rotation.y, Math.atan2(direction.x, direction.z), 1 - Math.pow(0.004, dt));
      const bobSpeed = enemy.type === "wisp" ? 4.5 : enemy.type === "ranger" ? 5.4 : 7;
      const bobAmount = enemy.type === "wisp" ? 0.18 : enemy.type === "ranger" ? 0.065 : 0.045;
      const attackDuration = enemy.type === "boss" ? 0.52 : enemy.ranged ? 0.44 : 0.34;
      const attackPulse = enemy.attackAnim > 0 ? Math.sin((1 - enemy.attackAnim / attackDuration) * Math.PI) : 0;
      enemy.body.position.y = Math.sin(this.elapsed * bobSpeed + enemy.phase) * bobAmount + (enemy.type === "wisp" ? 0.34 : 0);
      enemy.body.position.z = THREE.MathUtils.lerp(enemy.body.position.z, -attackPulse * (enemy.type === "boss" ? 0.7 : 0.34), Math.min(1, dt * 14));
      enemy.body.rotation.x = THREE.MathUtils.lerp(enemy.body.rotation.x, -attackPulse * 0.2, Math.min(1, dt * 12));
      enemy.body.scale.z = THREE.MathUtils.lerp(enemy.body.scale.z, 1 + attackPulse * 0.18, Math.min(1, dt * 12));
      enemy.body.scale.y += (1 - enemy.body.scale.y) * Math.min(1, dt * 10);
      if (enemy.healthBar) enemy.healthBar.quaternion.copy(this.camera.quaternion);
    }
  }

  startBossTelegraph(enemy) {
    const isMagicStorm = enemy.specialIndex % 2 === 1;
    enemy.specialIndex += 1;
    const radius = isMagicStorm ? 14.5 : 8.4;
    const duration = isMagicStorm ? 1.55 : 1.16;
    const color = isMagicStorm ? 0xa45cff : 0xe34a2d;
    const origin = isMagicStorm
      ? this.player.group.position.clone()
      : enemy.group.position.clone();
    const ring = mesh(
      new THREE.RingGeometry(0.92, 1, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      false,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(origin);
    ring.position.y = this.surfaceHeight(origin.x, origin.z, 0.055);
    ring.scale.setScalar(radius);
    const disc = mesh(
      new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
      false,
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.copy(ring.position);
    disc.scale.setScalar(radius);
    this.scene.add(ring);
    this.scene.add(disc);
    enemy.telegraph = {
      ring,
      disc,
      timer: duration,
      max: duration,
      origin,
      radius,
      damageType: isMagicStorm ? "magic" : "physical",
      kind: isMagicStorm ? "虚空风暴" : "熔炉震击",
    };
    const healthPressure = 1 - enemy.hp / enemy.maxHp;
    enemy.specialCooldown = Math.max(3.1, 5.7 - healthPressure * 1.8);
    this.addFeed(
      isMagicStorm
        ? "<b>虚空风暴</b> · 全屏魔法伤害，冲刺或结界可抵挡"
        : "<b>熔炉震击</b> · 大范围物理伤害，立即离开红圈",
    );
    this.audio.play(
      isMagicStorm ? "bossMagicWarning" : "bossPhysicalWarning",
      1.15,
    );
  }

  updateBossTelegraph(enemy, dt) {
    enemy.telegraph.timer -= dt;
    const progress = 1 - enemy.telegraph.timer / enemy.telegraph.max;
    const pulse = 0.42 + Math.sin(progress * Math.PI * 14) * 0.27;
    enemy.telegraph.ring.material.opacity = pulse;
    enemy.telegraph.ring.scale.setScalar(
      enemy.telegraph.radius * (1 - progress * 0.045),
    );
    enemy.telegraph.disc.material.opacity = 0.045 + progress * 0.16;
    enemy.telegraph.disc.rotation.z +=
      dt * (enemy.telegraph.damageType === "magic" ? 1.4 : -0.45);
    enemy.body.rotation.y += dt * (enemy.telegraph.damageType === "magic" ? 3.4 : 2);
    if (enemy.telegraph.timer <= 0) {
      const origin = enemy.telegraph.origin;
      if (distanceXZ(this.player.group.position, origin) < enemy.telegraph.radius) {
        const multiplier = enemy.telegraph.damageType === "magic" ? 1.38 : 1.72;
        this.damagePlayer(
          Math.round(enemy.damage * multiplier),
          enemy,
          enemy.telegraph.damageType,
        );
      }
      const color = enemy.telegraph.damageType === "magic" ? 0xa65cff : 0xf0522c;
      this.spawnRing(origin, enemy.telegraph.radius, color, 0.58);
      this.spawnEnergyColumn(
        origin,
        color,
        0.42,
        enemy.telegraph.damageType === "magic" ? 7.5 : 4.5,
      );
      this.spawnBurst(
        origin.clone().add(new THREE.Vector3(0, 0.2, 0)),
        enemy.telegraph.damageType === "magic" ? 32 : 24,
        color,
        enemy.telegraph.damageType === "magic" ? 9 : 7,
      );
      this.cameraShake = Math.max(
        this.cameraShake,
        enemy.telegraph.damageType === "magic" ? 0.42 : 0.34,
      );
      this.audio.play(
        enemy.telegraph.damageType === "magic"
          ? "bossMagicImpact"
          : "bossPhysicalImpact",
        1.2,
      );
      this.scene.remove(enemy.telegraph.ring);
      this.scene.remove(enemy.telegraph.disc);
      enemy.telegraph = null;
    }
  }

  damageEnemy(enemy, amount, critical = false, damageType = "physical") {
    if (!enemy || enemy.dead) return;
    const variance = rand(0.92, 1.08);
    const defense = damageType === "magic" ? enemy.magicResist : enemy.armor;
    const mitigation = 100 / (100 + Math.max(0, defense) * 3.5);
    const dealt = Math.max(
      1,
      Math.round(amount * variance * mitigation * (critical ? 1.15 : 1)),
    );
    enemy.hp -= dealt;
    this.audio.play(damageType === "magic" ? "magicHit" : "attackHit", critical ? 1.25 : 1);
    enemy.flash = 0.09;
    this.spawnDamageNumber(
      enemy.group.position.clone().add(new THREE.Vector3(0, enemy.type === "boss" ? 3.4 : 2.2, 0)),
      critical ? `${dealt}!` : `${dealt}`,
      critical ? "#ffcf77" : damageType === "magic" ? "#c7a0ff" : "#e8dfc8",
      critical,
    );

    const healthRatio = clamp(enemy.hp / enemy.maxHp, 0, 1);
    if (enemy.healthFill) {
      enemy.healthFill.scale.x = healthRatio;
      enemy.healthFill.position.x = -0.6 * (1 - healthRatio);
    }
    if (enemy.type === "boss") ui.bossFill.style.transform = `scaleX(${healthRatio})`;
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  killEnemy(enemy) {
    enemy.dead = true;
    this.audio.play("enemyDeath", enemy.type === "boss" ? 1.8 : 0.9);
    const region = this.regionStates.get(enemy.regionKey);
    if (region) region.defeated += 1;
    if (enemy.regionKey === this.currentRegionKey) {
      this.waveDefeated = region?.defeated ?? this.waveDefeated + 1;
    }
    this.kills += 1;
    if (Object.hasOwn(this.runStats.kills, enemy.type)) {
      this.runStats.kills[enemy.type] += 1;
    }
    this.runStats.bestWave = Math.max(
      this.runStats.bestWave,
      this.regionsCleared + 1,
    );
    this.player.attackTarget = null;
    if (enemy.telegraph) {
      this.scene.remove(enemy.telegraph.ring);
      this.scene.remove(enemy.telegraph.disc);
    }
    this.spawnBurst(enemy.group.position.clone().add(new THREE.Vector3(0, 0.65, 0)), enemy.type === "boss" ? 36 : 12, enemy.type === "wisp" ? 0x59c6b9 : 0xe26732, enemy.type === "boss" ? 9 : 5);
    this.spawnDrop("xp", enemy.group.position, enemy.xp);
    if (Math.random() < 0.76) {
      this.spawnDrop(
        "shard",
        enemy.group.position,
        enemy.type === "boss"
          ? 22 + enemy.threat * 3
          : Math.ceil(rand(2, 6) + enemy.threat * 0.35),
      );
    }
    if (Math.random() < 0.09 || enemy.type === "boss") this.spawnDrop("potion", enemy.group.position, 1);
    const gearChance = Math.min(0.34, 0.13 + enemy.threat * 0.018);
    if (Math.random() < gearChance || enemy.type === "boss") {
      this.spawnDrop("gear", enemy.group.position, {
        level: enemy.threat,
        boss: enemy.type === "boss",
      });
    }
    if (enemy.type === "boss") {
      ui.bossBar.classList.add("hidden");
      this.spawnDrop(
        "gear",
        enemy.group.position.clone().add(new THREE.Vector3(0.8, 0, 0.4)),
        { level: enemy.threat + 1, boss: true },
      );
    }

    const startScale = enemy.group.scale.clone();
    this.effects.push({
      object: enemy.group,
      life: 0.42,
      maxLife: 0.42,
      remove: false,
      update: (effect) => {
        const t = effect.life / effect.maxLife;
        effect.object.scale.copy(startScale).multiplyScalar(Math.max(0.01, t));
        effect.object.rotation.y += 0.22;
        effect.object.position.y = (1 - t) * 0.8;
      },
      onEnd: () => {
        this.scene.remove(enemy.group);
        const index = this.enemies.indexOf(enemy);
        if (index >= 0) this.enemies.splice(index, 1);
      },
    });
    this.updateUI();
  }

  damagePlayer(amount, source, damageType = source?.damageType ?? "physical") {
    if (this.player.invulnerable > 0 || this.state !== "running") return;
    const defense =
      damageType === "magic" ? this.player.magicResist : this.player.armor;
    const reduced = Math.max(
      1,
      Math.round(amount * (100 / (100 + Math.max(0, defense) * 5))),
    );
    let remaining = reduced;
    if (this.player.shield > 0) {
      const absorbed = Math.min(this.player.shield, remaining);
      this.player.shield -= absorbed;
      remaining -= absorbed;
    }
    this.player.hp -= remaining;
    this.audio.play(
      damageType === "magic" ? "playerMagicHit" : "playerPhysicalHit",
      source?.type === "boss" ? 1.35 : 0.9,
    );
    this.player.invulnerable = 0.38;
    this.cameraShake = Math.max(this.cameraShake, source?.type === "boss" ? 0.24 : 0.1);
    this.spawnDamageNumber(
      this.player.group.position.clone().add(new THREE.Vector3(0, 2.5, 0)),
      `-${reduced}`,
      damageType === "magic" ? "#c884ff" : "#ff7454",
    );
    this.spawnRing(
      this.player.group.position.clone(),
      1.1,
      damageType === "magic" ? 0x9d53dc : 0xc73d2b,
      0.24,
    );

    if (source) {
      const knockback = this.player.group.position.clone().sub(source.group.position).setY(0).normalize();
      this.player.group.position.addScaledVector(
        knockback,
        damageType === "magic" ? 0.22 : source.type === "boss" ? 1.2 : 0.45,
      );
    }
    this.updateUI();
    if (this.player.hp <= 0) this.die();
  }

  spawnDrop(type, position, value) {
    const colors = {
      xp: 0x69d0bd,
      shard: 0xf07c3e,
      potion: 0xe84d45,
      relic: 0xffc56d,
      gear: value?.boss ? 0xc889ff : 0x79cfe2,
    };
    const geometry =
      type === "xp"
        ? new THREE.OctahedronGeometry(0.18, 0)
        : type === "shard"
          ? new THREE.TetrahedronGeometry(0.22, 0)
          : type === "potion"
            ? new THREE.SphereGeometry(0.24, 8, 6)
            : type === "gear"
              ? new THREE.IcosahedronGeometry(value?.boss ? 0.42 : 0.34, 0)
              : new THREE.DodecahedronGeometry(0.33, 0);
    const dropMesh = mesh(
      geometry,
      makeMaterial(colors[type], {
        emissive: colors[type],
        emissiveIntensity: type === "relic" || type === "gear" ? 2.8 : 1.7,
        roughness: 0.3,
      }),
      false,
    );
    dropMesh.position.copy(position).add(new THREE.Vector3(rand(-0.45, 0.45), 0.38, rand(-0.45, 0.45)));
    this.scene.add(dropMesh);
    this.drops.push({
      type,
      value,
      mesh: dropMesh,
      life: 18,
      phase: rand(0, Math.PI * 2),
    });
  }

  updateDrops(dt) {
    for (let i = this.drops.length - 1; i >= 0; i -= 1) {
      const drop = this.drops[i];
      drop.life -= dt;
      drop.mesh.rotation.y += dt * 2.3;
      drop.mesh.position.y =
        this.surfaceHeight(drop.mesh.position.x, drop.mesh.position.z, 0.42) +
        Math.sin(this.elapsed * 4 + drop.phase) * 0.12;
      const distance = distanceXZ(drop.mesh.position, this.player.group.position);
      if (distance < 4.2) {
        const direction = this.player.group.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(drop.mesh.position);
        drop.mesh.position.addScaledVector(direction.normalize(), dt * (8 + (4.2 - distance) * 4));
      }
      if (distance < 0.9) {
        this.collectDrop(drop);
        this.scene.remove(drop.mesh);
        this.drops.splice(i, 1);
      } else if (drop.life <= 0) {
        this.scene.remove(drop.mesh);
        this.drops.splice(i, 1);
      }
    }
  }

  collectDrop(drop) {
    this.audio.play("pickup", drop.type === "gear" ? 1.25 : 0.75);
    if (drop.type === "xp") this.addXP(drop.value);
    if (drop.type === "shard") {
      this.player.shards += drop.value;
      this.addFeed(`收集 <b>${drop.value} 枚余烬</b>`);
    }
    if (drop.type === "potion") {
      this.player.potions = Math.min(5, this.player.potions + drop.value);
      this.addFeed("拾取 <b>疗愈药剂</b>");
    }
    if (drop.type === "relic") this.acquireRelic();
    if (drop.type === "gear") this.acquireGear(drop.value);
    this.spawnRing(drop.mesh.position.clone().setY(0.06), 0.8, drop.type === "xp" ? 0x62cdbb : 0xe98043, 0.22);
    this.updateUI();
  }

  addXP(amount) {
    this.player.xp += amount;
    while (this.player.xp >= this.player.xpNeeded) {
      this.player.xp -= this.player.xpNeeded;
      this.player.level += 1;
      this.player.xpNeeded = 80 + this.player.level * 40;
      this.player.maxHp += 15;
      this.player.hp = this.player.maxHp;
      this.player.damage += 3;
      this.player.skillPower += 4;
      this.player.armor += 1;
      if (this.player.level % 2 === 0) this.player.magicResist += 1;
      this.audio.play("levelUp", 1.3);
      this.spawnRing(this.player.group.position.clone(), 3.2, 0xffad65, 0.7);
      this.spawnBurst(this.player.group.position.clone().add(new THREE.Vector3(0, 1, 0)), 18, 0xffb36b, 6);
      this.addFeed(`<b>灵火升阶</b> · 当前等级 ${this.player.level}`);
    }
  }

  acquireRelic() {
    const relics = [
      { name: "裂纹齿轮", glyph: "⚙", stat: "damage", value: 5, text: "伤害 +5" },
      { name: "青铜甲片", glyph: "◇", stat: "armor", value: 3, text: "护甲 +3" },
      { name: "余温玻璃", glyph: "◈", stat: "maxHp", value: 22, text: "生命 +22" },
      { name: "疾行轴承", glyph: "⌁", stat: "speed", value: 0.5, text: "移速 +0.5" },
    ];
    const relic = { ...choose(relics) };
    if (this.player.relics.length >= 3) {
      this.player.shards += 15;
      this.addFeed(`<b>${relic.name}</b> 化作 15 枚余烬`);
      return;
    }
    this.player.relics.push(relic);
    this.player[relic.stat] += relic.value;
    if (relic.stat === "maxHp") {
      this.player.hp += relic.value;
    }
    this.addFeed(`获得遗物 <b>${relic.name}</b> · ${relic.text}`);
    this.updateRelics();
  }

  acquireGear(dropData = {}) {
    const level = Math.max(1, Math.floor(dropData.level || this.wave || 1));
    const rarityRoll = Math.random() + (dropData.boss ? 0.22 : 0) + level * 0.012;
    const rarity =
      rarityRoll > 1.08
        ? { id: "legendary", name: "传说", multiplier: 2.35, color: "#ffd17c" }
        : rarityRoll > 0.82
          ? { id: "epic", name: "史诗", multiplier: 1.72, color: "#cda3ff" }
          : rarityRoll > 0.5
            ? { id: "rare", name: "稀有", multiplier: 1.3, color: "#8de3ef" }
            : { id: "common", name: "精良", multiplier: 1, color: "#e8dfc8" };
    const basePower = Math.max(1, Math.round((2.2 + level * 0.72) * rarity.multiplier));
    const affixes = [
      {
        name: "猎炉刃芯",
        glyph: "✦",
        stat: "damage",
        value: basePower,
        text: `普通攻击 +${basePower}`,
      },
      {
        name: "秘焰透镜",
        glyph: "◉",
        stat: "skillPower",
        value: Math.round(basePower * 1.18),
        text: `技能强度 +${Math.round(basePower * 1.18)}`,
      },
      {
        name: "活性心核",
        glyph: "◆",
        stat: "maxHp",
        value: Math.round(basePower * 4.4),
        text: `生命上限 +${Math.round(basePower * 4.4)}`,
      },
      {
        name: "重铸甲片",
        glyph: "◇",
        stat: "armor",
        value: Math.max(1, Math.round(basePower * 0.62)),
        text: `物理护甲 +${Math.max(1, Math.round(basePower * 0.62))}`,
      },
      {
        name: "虚空护符",
        glyph: "⬡",
        stat: "magicResist",
        value: Math.max(1, Math.round(basePower * 0.58)),
        text: `魔法抗性 +${Math.max(1, Math.round(basePower * 0.58))}`,
      },
      {
        name: "连发轴承",
        glyph: "⌁",
        stat: "attackSpeed",
        value: Math.min(0.12, 0.025 + level * 0.0025 * rarity.multiplier),
        text: `攻击速度 +${Math.round(Math.min(0.12, 0.025 + level * 0.0025 * rarity.multiplier) * 100)}%`,
      },
    ];
    const item = {
      ...choose(affixes),
      rarity: rarity.id,
      rarityName: rarity.name,
      level,
    };
    this.player[item.stat] += item.value;
    if (item.stat === "maxHp") this.player.hp += item.value;
    this.player.gearScore += Math.round(basePower * rarity.multiplier * 8);
    this.player.relics.unshift(item);
    this.player.relics = this.player.relics.slice(0, 6);
    this.audio.play(
      "gear",
      rarity.id === "legendary" ? 1.8 : rarity.id === "epic" ? 1.35 : 1,
    );
    this.spawnEnergyColumn(
      this.player.group.position.clone(),
      Number.parseInt(rarity.color.slice(1), 16),
      0.34,
      rarity.id === "legendary" ? 5.2 : 3.5,
    );
    this.addFeed(
      `<b>${rarity.name} · ${item.name}</b> · ${item.text}（区域 Lv.${level}）`,
    );
    this.updateRelics();
    this.saveGame();
  }

  updateRelics() {
    ui.relicSlots.innerHTML = "";
    for (let i = 0; i < 6; i += 1) {
      const relic = this.player.relics[i];
      const slot = document.createElement("div");
      slot.className = `relic-slot${relic ? "" : " empty"}`;
      if (relic?.rarity) slot.dataset.rarity = relic.rarity;
      slot.title = relic ? `${relic.name}：${relic.text}` : "空槽";
      slot.innerHTML = relic
        ? `<span>${relic.glyph}</span><small>${relic.rarityName ? `${relic.rarityName}·` : ""}${relic.name}</small>`
        : `<span>${["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ"][i]}</span><small>等待掉落</small>`;
      ui.relicSlots.append(slot);
    }
    ui.relicCount.textContent = `战力 ${this.player.gearScore}`;
  }

  spawnCastingEffect(color, duration, mode) {
    const group = new THREE.Group();
    group.position.copy(this.player.group.position);
    group.position.y = 0.055;
    const runeMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const rings = [];
    [
      [0.72, 0.76],
      [1.08, 1.11],
      [1.48, 1.52],
    ].forEach(([inner, outer], index) => {
      const ring = mesh(new THREE.RingGeometry(inner, outer, 48), runeMaterial.clone(), false);
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = index * 0.37;
      group.add(ring);
      rings.push(ring);
    });

    const glyphs = [];
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      const glyph = mesh(
        i % 2 === 0 ? new THREE.BoxGeometry(0.07, 0.02, 0.28) : new THREE.TetrahedronGeometry(0.1, 0),
        runeMaterial.clone(),
        false,
      );
      glyph.position.set(Math.cos(angle) * 1.3, 0.025, Math.sin(angle) * 1.3);
      glyph.rotation.y = -angle;
      group.add(glyph);
      glyphs.push(glyph);
    }

    const orbiters = [];
    const orbMaterial = makeMaterial(color, {
      emissive: color,
      emissiveIntensity: 3.4,
      roughness: 0.12,
      transparent: true,
      opacity: 0.9,
    });
    for (let i = 0; i < 6; i += 1) {
      const orb = mesh(new THREE.OctahedronGeometry(0.07 + (i % 2) * 0.025, 0), orbMaterial.clone(), false);
      group.add(orb);
      orbiters.push(orb);
    }

    const beam = mesh(
      new THREE.CylinderGeometry(mode === "nova" ? 0.15 : 0.28, 0.72, 2.8, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      false,
    );
    beam.position.y = 1.4;
    group.add(beam);
    this.scene.add(group);
    this.effects.push({
      object: group,
      life: duration,
      maxLife: duration,
      update: (effect, dt) => {
        const progress = clamp(1 - effect.life / effect.maxLife, 0, 1);
        effect.object.position.x = this.player.group.position.x;
        effect.object.position.z = this.player.group.position.z;
        rings.forEach((ring, index) => {
          ring.rotation.z += dt * (index % 2 === 0 ? 1.4 : -1.1) * (1 + index * 0.2);
          ring.scale.setScalar(0.55 + progress * (0.78 + index * 0.13));
          ring.material.opacity = (0.28 + progress * 0.58) * Math.sin(progress * Math.PI);
        });
        glyphs.forEach((glyph, index) => {
          glyph.rotation.y += dt * (index % 2 ? -2 : 2);
          glyph.position.y = 0.04 + Math.sin(this.elapsed * 8 + index) * 0.025;
          glyph.material.opacity = Math.sin(progress * Math.PI) * 0.68;
        });
        orbiters.forEach((orb, index) => {
          const angle = this.elapsed * (mode === "nova" ? 4.8 : 3.2) + (index / orbiters.length) * Math.PI * 2;
          const radius = THREE.MathUtils.lerp(1.45, 0.34, progress);
          orb.position.set(
            Math.cos(angle) * radius,
            0.35 + progress * 1.75 + Math.sin(angle * 2) * 0.16,
            Math.sin(angle) * radius,
          );
          orb.rotation.y += dt * 7;
          orb.material.opacity = Math.sin(progress * Math.PI) * 0.9;
        });
        beam.scale.set(0.6 + progress * 0.5, 0.4 + progress * 0.7, 0.6 + progress * 0.5);
        beam.material.opacity = Math.sin(progress * Math.PI) * 0.11;
      },
    });
  }

  spawnEnergyColumn(position, color, duration, height) {
    const column = mesh(
      new THREE.CylinderGeometry(0.32, 1.7, height, 28, 1, true),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      false,
    );
    column.position.copy(position);
    column.position.y = height / 2;
    column.scale.set(0.18, 0.12, 0.18);
    this.scene.add(column);
    this.effects.push({
      object: column,
      life: duration,
      maxLife: duration,
      update: (effect, dt) => {
        const progress = 1 - effect.life / effect.maxLife;
        const width = 0.18 + Math.sin(progress * Math.PI) * 1.15;
        effect.object.scale.set(width, 0.12 + progress * 1.18, width);
        effect.object.rotation.y += dt * 3.4;
        effect.object.material.opacity = (1 - progress) * 0.32;
      },
    });
  }

  spawnAfterimages(start, end) {
    const bodyRotation = this.player.body.rotation.clone();
    for (let i = 0; i < 4; i += 1) {
      const ghost = this.player.body.clone(true);
      ghost.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = false;
        child.receiveShadow = false;
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0.14 - i * 0.018;
        child.material.depthWrite = false;
        if (child.material.emissive) {
          child.material.emissive.setHex(0x4fc6b7);
          child.material.emissiveIntensity = 1.2;
        }
      });
      ghost.position.copy(start).lerp(end, 0.14 + i * 0.18);
      ghost.position.y = 0.02;
      ghost.rotation.copy(bodyRotation);
      this.scene.add(ghost);
      this.effects.push({
        object: ghost,
        life: 0.28 + i * 0.035,
        maxLife: 0.28 + i * 0.035,
        update: (effect) => {
          const alpha = effect.life / effect.maxLife;
          effect.object.position.y += 0.006;
          effect.object.traverse((child) => {
            if (child.isMesh) child.material.opacity = alpha * (0.12 - i * 0.015);
          });
        },
      });
    }
  }

  spawnRing(position, radius, color, duration) {
    const ring = mesh(
      new THREE.RingGeometry(0.82, 1, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      false,
    );
    ring.position.copy(position);
    ring.position.y = Math.max(0.045, position.y);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.15);
    this.scene.add(ring);
    this.effects.push({
      object: ring,
      life: duration,
      maxLife: duration,
      update: (effect) => {
        const progress = 1 - effect.life / effect.maxLife;
        effect.object.scale.setScalar(0.15 + progress * radius);
        effect.object.material.opacity = (1 - progress) * 0.7;
      },
    });
  }

  spawnBurst(position, count, color, speed) {
    const group = new THREE.Group();
    const particles = [];
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    for (let i = 0; i < count; i += 1) {
      const particle = mesh(new THREE.TetrahedronGeometry(rand(0.04, 0.11), 0), material.clone(), false);
      particle.position.copy(position);
      const velocity = new THREE.Vector3(rand(-1, 1), rand(0.15, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(speed * 0.35, speed));
      group.add(particle);
      particles.push({ mesh: particle, velocity });
    }
    this.scene.add(group);
    this.effects.push({
      object: group,
      life: 0.62,
      maxLife: 0.62,
      update: (effect, dt) => {
        const alpha = effect.life / effect.maxLife;
        particles.forEach((particle) => {
          particle.velocity.y -= dt * 6;
          particle.mesh.position.addScaledVector(particle.velocity, dt);
          particle.mesh.material.opacity = alpha;
          particle.mesh.rotation.x += dt * 8;
        });
      },
    });
  }

  createMuzzleBurst(position) {
    this.spawnBurst(position, 4, 0xffa45f, 2.5);
  }

  spawnDashTrail(start, end) {
    const direction = end.clone().sub(start);
    const distance = direction.length();
    const trail = mesh(
      new THREE.PlaneGeometry(0.8, distance),
      new THREE.MeshBasicMaterial({
        color: 0x5bc8b8,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      false,
    );
    trail.position.copy(start).add(end).multiplyScalar(0.5);
    trail.position.y = 0.06;
    trail.rotation.x = -Math.PI / 2;
    trail.rotation.z = -Math.atan2(direction.z, direction.x) + Math.PI / 2;
    this.scene.add(trail);
    this.effects.push({
      object: trail,
      life: 0.35,
      maxLife: 0.35,
      update: (effect) => {
        effect.object.material.opacity = (effect.life / effect.maxLife) * 0.42;
      },
    });
  }

  spawnClickMarker(position) {
    this.spawnRing(position.clone(), 0.75, 0xe8874d, 0.3);
  }

  spawnDamageNumber(worldPosition, text, color, large = false) {
    const element = document.createElement("span");
    element.className = `damage-number${large ? " critical" : ""}`;
    element.textContent = text;
    element.style.color = color;
    this.floatLayer.append(element);
    this.damageNumbers.push({
      element,
      position: worldPosition.clone(),
      life: 0.85,
      maxLife: 0.85,
      drift: rand(-12, 12),
    });
  }

  updateDamageNumbers(dt) {
    for (let i = this.damageNumbers.length - 1; i >= 0; i -= 1) {
      const number = this.damageNumbers[i];
      number.life -= dt;
      number.position.y += dt * 0.72;
      const projected = number.position.clone().project(this.camera);
      const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
      number.element.style.transform = `translate3d(${x + number.drift * (1 - number.life / number.maxLife)}px, ${y}px, 0)`;
      number.element.style.opacity = String(clamp(number.life / 0.35, 0, 1));
      if (number.life <= 0) {
        number.element.remove();
        this.damageNumbers.splice(i, 1);
      }
    }
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i -= 1) {
      const effect = this.effects[i];
      effect.life -= dt;
      effect.update?.(effect, dt);
      if (effect.life <= 0) {
        effect.onEnd?.();
        if (effect.remove !== false && effect.object?.parent) effect.object.parent.remove(effect.object);
        this.effects.splice(i, 1);
      }
    }
  }

  updateCooldowns(dt) {
    Object.values(this.skillState).forEach((skill) => {
      skill.cooldown = Math.max(0, skill.cooldown - dt);
    });
    ui.skillButtons.forEach((button) => {
      const state = this.skillState[button.dataset.skill];
      const ratio = state.cooldown / state.max;
      const sweep = button.querySelector(".cooldown-sweep");
      sweep.style.transform = `translateY(${100 - ratio * 100}%)`;
      button.classList.toggle("cooling", ratio > 0);
      if (ratio === 0 && button.dataset.wasCooling === "true") {
        button.classList.add("ready-flash");
        setTimeout(() => button.classList.remove("ready-flash"), 450);
      }
      button.dataset.wasCooling = String(ratio > 0);
    });
  }

  checkWaveState(dt) {
    this.lastRegionUpdate -= dt;
    if (this.lastRegionUpdate <= 0) {
      this.lastRegionUpdate = 0.25;
      this.updateCurrentRegion();
    }

    const region = this.regionStates.get(this.currentRegionKey);
    if (!region) return;
    if (region.active && region.defeated >= region.enemyCount) {
      this.completeRegion(region);
      return;
    }
    if (!region.active && Date.now() >= region.respawnAt) {
      this.spawnRegionPack(region);
      return;
    }
    this.syncRegionObjective(region);
  }

  completeRegion(region) {
    region.active = false;
    region.clears += 1;
    const respawnSeconds = Math.round(rand(24, 58));
    region.respawnAt = Date.now() + respawnSeconds * 1000;
    this.waveActive = false;
    this.regionsCleared += 1;
    this.runStats.wavesCleared += 1;
    this.runStats.bestWave = Math.max(
      this.runStats.bestWave,
      this.regionsCleared + 1,
    );
    if (this.regionsCleared % 3 === 0) {
      this.runStats.chaptersCleared += 1;
      this.addFeed("<b>探索里程碑</b> · 连续净化 3 个区域，额外获得 2000 积分");
    }
    ui.bossBar.classList.add("hidden");
    this.player.hp = Math.min(
      this.player.maxHp,
      this.player.hp + Math.round(this.player.maxHp * 0.12),
    );
    if (Math.random() < 0.42 || region.hasBoss) {
      this.spawnDrop("gear", this.player.group.position, {
        level: region.threat,
        boss: region.hasBoss,
      });
    }
    this.addFeed(
      `<b>${region.biome.name} 已净化</b> · ${respawnSeconds} 秒后随机重生，继续前往相邻区域`,
    );
    this.audio.play("regionClear", 1.2);
    this.syncRegionObjective(region);
    this.updateUI();
    this.saveGame();
    void this.submitCurrentScore();
  }

  continueAfterVictory() {
    ui.victoryScreen.classList.remove("active");
    this.state = "running";
    this.updateCurrentRegion(true);
  }

  pause() {
    if (this.state !== "running") return;
    this.state = "paused";
    this.saveGame();
    ui.pauseScreen.classList.add("active");
  }

  resume() {
    if (this.state !== "paused") return;
    this.state = "running";
    ui.pauseScreen.classList.remove("active");
    this.clock.getDelta();
  }

  die() {
    this.state = "dead";
    this.player.hp = 0;
    localStorage.removeItem(SAVE_KEY);
    ui.deathWave.textContent = String(this.wave);
    ui.deathSummary.textContent = `击败 ${this.kills} 个敌人 · 收集 ${this.player.shards} 枚余烬`;
    ui.deathScore.textContent = formatScore(calculateScore(this.runStats).total);
    void this.submitCurrentScore(ui.deathSubmitStatus);
    ui.deathScreen.classList.add("active");
    this.updateUI();
  }

  hasSave() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      return Boolean(data?.wave && data?.player);
    } catch {
      return false;
    }
  }

  refreshSaveState() {
    if (!this.hasSave()) {
      ui.startButtonLabel.textContent = "进入地窟";
      ui.newRunButton.classList.add("hidden");
      return;
    }
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    ui.startButtonLabel.textContent = `继续威胁 ${data.wave} 区域`;
    ui.newRunButton.classList.remove("hidden");
  }

  saveGame() {
    if (!["running", "paused", "victory"].includes(this.state)) return;
    const data = {
      version: 1,
      wave: this.wave,
      kills: this.kills,
      victorySeen: this.victorySeen,
      runId: this.runId,
      runStats: normalizeRunStats(this.runStats),
      world: {
        offsetX: this.worldOffset.x,
        offsetZ: this.worldOffset.y,
        regionsCleared: this.regionsCleared,
      },
      player: {
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        damage: this.player.damage,
        skillPower: this.player.skillPower,
        armor: this.player.armor,
        magicResist: this.player.magicResist,
        attackSpeed: this.player.attackSpeed,
        critChance: this.player.critChance,
        gearScore: this.player.gearScore,
        level: this.player.level,
        xp: this.player.xp,
        xpNeeded: this.player.xpNeeded,
        shards: this.player.shards,
        potions: this.player.potions,
        relics: this.player.relics,
        speed: this.player.speed,
      },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  }

  loadSave() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!data?.player) return;
      this.wave = data.wave ?? 1;
      this.kills = data.kills ?? 0;
      this.victorySeen = data.victorySeen ?? false;
      this.worldOffset.set(
        Number(data.world?.offsetX) || 0,
        Number(data.world?.offsetZ) || 0,
      );
      this.regionsCleared = Math.max(
        0,
        Number(data.world?.regionsCleared) || data.runStats?.wavesCleared || 0,
      );
      this.runId = data.runId || this.leaderboard.createRunId();
      if (data.runStats) {
        this.runStats = normalizeRunStats(data.runStats);
      } else {
        const migratedStats = createRunStats();
        migratedStats.kills.crawler = Math.max(0, Number(data.kills) || 0);
        migratedStats.wavesCleared = Math.max(0, (Number(data.wave) || 1) - 1);
        migratedStats.chaptersCleared = Math.floor(migratedStats.wavesCleared / 3);
        migratedStats.bestWave = Math.max(1, Number(data.wave) || 1);
        this.runStats = migratedStats;
      }
      Object.assign(this.player, data.player);
      this.player.hp = Math.max(1, this.player.hp);
    } catch {
      localStorage.removeItem(SAVE_KEY);
    }
  }

  addFeed(html) {
    const message = document.createElement("div");
    message.className = "loot-message";
    message.innerHTML = html;
    ui.lootFeed.prepend(message);
    while (ui.lootFeed.children.length > 4) ui.lootFeed.lastElementChild.remove();
    setTimeout(() => message.remove(), 3700);
  }

  updateUI() {
    const player = this.player;
    const hpRatio = clamp(player.hp / player.maxHp, 0, 1);
    const shieldRatio = clamp(player.shield / player.maxHp, 0, 1);
    ui.healthLabel.textContent = `${Math.max(0, Math.ceil(player.hp))} / ${player.maxHp}`;
    ui.healthFill.style.transform = `scaleX(${hpRatio})`;
    ui.shieldFill.style.transform = `translateX(${hpRatio * 100}%) scaleX(${shieldRatio})`;
    ui.xpLabel.textContent = `${Math.floor(player.xp)} / ${player.xpNeeded}`;
    ui.xpFill.style.transform = `scaleX(${clamp(player.xp / player.xpNeeded, 0, 1)})`;
    ui.levelLabel.textContent = String(player.level).padStart(2, "0");
    ui.waveLabel.textContent = `威胁 ${this.wave}`;
    ui.damageStat.textContent = String(Math.round(player.damage));
    ui.skillStat.textContent = String(Math.round(player.skillPower));
    ui.armorStat.textContent = String(Math.round(player.armor));
    ui.resistStat.textContent = String(Math.round(player.magicResist));
    ui.threatStat.textContent = String(this.wave);
    ui.shardStat.textContent = String(player.shards);
    ui.currentScore.textContent = formatScore(calculateScore(this.runStats).total);
    ui.potionCount.textContent = String(player.potions);

    const worldPosition = this.getPlayerWorldPosition();
    const region = this.regionStates.get(this.currentRegionKey);
    const coordinates = region ?? getRegionCoordinates(worldPosition.x, worldPosition.y);
    ui.regionStatus.textContent = `球面坐标 ${coordinates.x} · ${coordinates.z} ｜ 已净化 ${this.regionsCleared}`;
    const remaining = Math.max(
      0,
      (region?.enemyCount ?? this.waveTotal) - (region?.defeated ?? this.waveDefeated),
    );
    const progress = region?.enemyCount
      ? region.defeated / region.enemyCount
      : this.waveTotal
        ? this.waveDefeated / this.waveTotal
        : 0;
    if (region?.active) {
      ui.objectiveText.textContent = `剩余 ${remaining} 个敌人`;
      ui.objectivePercent.textContent = `${Math.round(progress * 100)}%`;
      ui.objectiveFill.style.width = `${progress * 100}%`;
    }
    this.updateRelics();
  }

  updateMinimap() {
    const ctx = ui.minimap.getContext("2d");
    const size = ui.minimap.width;
    const center = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, center - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(5, 20, 21, .8)";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(105, 176, 163, .12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      ctx.arc(center, center, (center / 4) * i, 0, Math.PI * 2);
      ctx.stroke();
    }
    const mapPosition = (position) => ({
      x:
        center +
        ((position.x - this.player.group.position.x) / MINIMAP_RANGE) *
          (center - 9),
      y:
        center +
        ((position.z - this.player.group.position.z) / MINIMAP_RANGE) *
          (center - 9),
    });
    this.enemies.forEach((enemy) => {
      if (enemy.dead) return;
      const point = mapPosition(enemy.group.position);
      ctx.fillStyle =
        enemy.type === "boss"
          ? "#ff6b35"
          : enemy.damageType === "magic"
            ? "#b682ff"
            : enemy.ranged
              ? "#e4bd75"
              : "#b14d38";
      ctx.beginPath();
      ctx.arc(point.x, point.y, enemy.type === "boss" ? 4.5 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    const playerPoint = { x: center, y: center };
    ctx.fillStyle = "#76d8c6";
    ctx.beginPath();
    ctx.moveTo(playerPoint.x, playerPoint.y - 5);
    ctx.lineTo(playerPoint.x + 4, playerPoint.y + 4);
    ctx.lineTo(playerPoint.x - 4, playerPoint.y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  updateAmbient(dt) {
    this.dust.rotation.y += dt * 0.012;
    this.forgeCore.rotation.y += dt * 0.8;
    this.forgeCore.position.y = 0.82 + Math.sin(this.elapsed * 2.4) * 0.08;
    this.emberLight.intensity = 54 + Math.sin(this.elapsed * 4.1) * 5;
    this.flames.forEach((flame, index) => {
      flame.scale.y = 0.82 + Math.sin(this.elapsed * 8 + index) * 0.18;
      flame.rotation.y += dt * (0.8 + index * 0.04);
    });
    this.cursor.rotation.z += dt * 0.75;
    this.cursor.material.opacity = this.state === "running" ? 0.48 + Math.sin(this.elapsed * 4) * 0.18 : 0;
  }

  updateCamera(dt) {
    this.cameraTarget.copy(this.player.group.position);
    this.cameraTarget.y = 0.75;
    const desired = this.cameraTarget.clone().add(this.cameraOffset);
    const alpha = 1 - Math.pow(0.0007, dt);
    this.camera.position.lerp(desired, alpha);
    if (this.cameraShake > 0) {
      const strength = this.cameraShake * 0.18;
      this.camera.position.x += rand(-strength, strength);
      this.camera.position.y += rand(-strength * 0.5, strength * 0.5);
      this.camera.position.z += rand(-strength, strength);
      this.cameraShake = Math.max(0, this.cameraShake - dt * 1.8);
    }
    this.camera.lookAt(this.cameraTarget);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.04);
    this.elapsed += dt;
    this.updateAmbient(dt);
    this.updateCamera(dt);

    if (this.state === "running") {
      this.updatePlayer(dt);
      this.updateEnemies(dt);
      this.updateProjectiles(dt);
      this.updateDrops(dt);
      this.updateEffects(dt);
      this.updateDamageNumbers(dt);
      this.updateCooldowns(dt);
      this.checkWaveState(dt);
      this.updateMinimap();
      if (this.elapsed - this.lastSaveAt > 12) {
        this.lastSaveAt = this.elapsed;
        this.saveGame();
      }
    } else {
      this.updateEffects(dt);
      this.updateDamageNumbers(dt);
    }

    this.renderer.render(this.scene, this.camera);
  }
}

new EmberfallGame();
