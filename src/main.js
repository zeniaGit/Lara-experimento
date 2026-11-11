import Matter from 'matter-js';
import {
  collection,
  addDoc,
  getDocsFromServer,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { soundManager } from './audioManager.js';
import { inject as injectVercelAnalytics } from '@vercel/analytics';
import labubuUrl from './assets/labubu.png';

const labubuImg = new Image();
labubuImg.src = labubuUrl;
let isLabubuLoaded = false;
labubuImg.onload = () => {
  isLabubuLoaded = true;
};

// --- CONFIGURACIÓN & PARÁMETROS FÍSICOS (CRITICAL DAMPING) ---
const CONFIG = {
  fontFamily: 'Cinzel',
  dropDelay: 650, // ms entre caída de cada letra
  linePoints: 80, // resolución de la malla elástica
  springK: 0.075, // rigidez elástica baja: movimiento suave y fluido
  damping: 0.91,  // amortiguación suave: asienta sin rebotes nerviosos
  spread: 0.14,   // propagación gradual de la onda
};

// Gestión de palabras activas y personalizadas
const STORAGE_KEY = 'lara_physics_words';

function loadSavedWords() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error al leer palabras guardadas:', e);
  }
  return [
    { id: 'word-lara', text: 'LARA', active: true },
    { id: 'word-elvira', text: 'ELVIRA', active: false },
  ];
}

let wordsList = loadSavedWords();

function saveWords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wordsList));
  } catch (e) {
    console.warn('Error al guardar palabras:', e);
  }
}

// Canvas Setup
const canvas = document.getElementById('gravity-canvas');
const ctx = canvas.getContext('2d');
let width = (canvas.width = window.innerWidth);
let height = (canvas.height = window.innerHeight);

// Matter.js Modules
const { Engine, World, Bodies, Body } = Matter;

const engine = Engine.create({
  gravity: { x: 0, y: 1.25, scale: 0.001 },
});
const world = engine.world;

// Estado de la línea elástica del suelo (Espacio-Tiempo)
let floorY = height * 0.9;
let lineNodes = [];
const leftDeltas = new Float32Array(CONFIG.linePoints);
const rightDeltas = new Float32Array(CONFIG.linePoints);

function initFloorMesh() {
  floorY = height * 0.9;
  lineNodes = [];
  for (let i = 0; i < CONFIG.linePoints; i++) {
    lineNodes.push({
      x: (width / (CONFIG.linePoints - 1)) * i,
      y: floorY,
      targetY: floorY,
      vy: 0,
    });
  }
}
initFloorMesh();

// Suelo de seguridad invisible muy bajo (solo como red de rescate)
let floorBody = Bodies.rectangle(width / 2, height + 150, width * 2, 50, {
  isStatic: true,
  restitution: 0.1,
  friction: 0.8,
});
let leftWall = Bodies.rectangle(-20, height / 2, 40, height * 2, { isStatic: true });
let rightWall = Bodies.rectangle(width + 20, height / 2, 40, height * 2, { isStatic: true });
World.add(world, [floorBody, leftWall, rightWall]);

let letterBodies = [];
let draggedBody = null;
let dragOffset = { x: 0, y: 0 };
let dragHistory = [];
let dragStartY = 0;



// --- PUNTOS EN PENTÁGONO CON 5 COLORES ---
const COLOR_POINTS = [
  { name: 'morado', color: '#a55eea', r: 165, g: 94, b: 234 },
  { name: 'amarillo', color: '#fed330', r: 254, g: 211, b: 48 },
  { name: 'verde', color: '#26de81', r: 38, g: 222, b: 129 },
  { name: 'azul', color: '#45aaf2', r: 69, g: 170, b: 242 },
  { name: 'rojo', color: '#fc5c65', r: 252, g: 92, b: 101 },
];

const COLOR_MAP = {};
COLOR_POINTS.forEach(c => { COLOR_MAP[c.name] = c; });

let pentagonRotationAngle = Math.random() * Math.PI * 2;
let pentagonNodes = [];

function initPentagonPoints(randomize = false) {
  if (randomize) {
    pentagonRotationAngle = Math.random() * Math.PI * 2;
  }
  pentagonNodes = [];
  const centerX = width / 2;
  const centerY = height * 0.48;
  const radius = Math.min(width, height) * 0.27;

  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + pentagonRotationAngle + (i * 2 * Math.PI) / 5;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    pentagonNodes.push({
      x,
      y,
      color: COLOR_POINTS[i].color,
      r: COLOR_POINTS[i].r,
      g: COLOR_POINTS[i].g,
      b: COLOR_POINTS[i].b,
      name: COLOR_POINTS[i].name,
      radius: 1.7,
    });
  }
}
initPentagonPoints(true);

// Cálculo de distribución y tamaño responsivo de letras
function getLetterLayout() {
  const activeWords = wordsList.filter((w) => w.active);
  const wordsToDrop = (activeWords.length > 0 ? activeWords : [wordsList[0]])
    .map((w) => w.text.trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ]/g, '').split(''))
    .filter((letters) => letters.length > 0);

  const totalLetters = wordsToDrop.reduce((acc, w) => acc + w.length, 0);
  const hasWordGap = wordsToDrop.length > 1;
  const wordGapFraction = 0.75; // separación clara entre palabras
  const totalSlots = (totalLetters - 1) + (hasWordGap ? (wordsToDrop.length - 1) * wordGapFraction : 0);

  // Margen de seguridad horizontal para evitar colisión con paredes laterales
  const availableWidth = width * 0.86;
  const maxLetterWidth = availableWidth / (totalSlots * 1.05 + 0.85);

  let targetSize;
  if (totalLetters > 8) {
    targetSize = Math.min(maxLetterWidth, height * 0.12, 85);
  } else if (totalLetters > 5) {
    targetSize = Math.min(maxLetterWidth, height * 0.15, 115);
  } else {
    targetSize = Math.min(maxLetterWidth, height * 0.18, 145);
  }

  const finalSize = Math.max(22, Math.min(targetSize, maxLetterWidth));
  const spacing = finalSize * 1.05;
  const totalSpan = totalSlots * spacing;
  const startX = (width - totalSpan) / 2;

  const items = [];
  let currentOffset = 0;

  wordsToDrop.forEach((word, wIdx) => {
    word.forEach((char) => {
      items.push({
        char,
        x: startX + currentOffset * spacing,
        size: finalSize,
      });
      currentOffset += 1;
    });
    if (wIdx < wordsToDrop.length - 1) {
      currentOffset += wordGapFraction;
    }
  });

  return items;
}

// Spawner de Letras
function spawnLetter(char, startX, size) {
  const startY = isGyroActive ? -size : getBricksBottom() + size / 2 + 32;

  const body = Bodies.rectangle(startX, startY, size * 0.85, size, {
    restitution: 0.28,
    friction: 0.5,
    density: 0.003,
    angle: (Math.random() - 0.5) * 0.08,
  });

  body.char = char;
  body.size = size;
  body.hasImpacted = false;
  body.color = '#FFFFFF';
  body.currentColorRgb = [255, 255, 255];
  body.colorContactTimes = {
    morado: 0,
    amarillo: 0,
    verde: 0,
    azul: 0,
    rojo: 0,
  };
  body.touchingPoints = {};

  letterBodies.push(body);
  World.add(world, body);
}

// Deformación del espacio-tiempo (Hundimiento elástico)
function perturbLine(impactX, force) {
  const radius = width * 0.25;
  for (let node of lineNodes) {
    const dist = Math.abs(node.x - impactX);
    if (dist < radius) {
      const factor = Math.cos((dist / radius) * (Math.PI / 2));
      node.vy += force * factor;
    }
  }
}

// --- JUEGO TIPO ARKANOID: BLOQUES CON LETRA ---
const POINTS_PER_BRICK = 100;
const WRONG_HIT_PENALTY = 10;
const SECONDS_PER_BRICK = 8;   // tiempo de referencia por bloque: bonus de 10 pts por segundo que sobre
const MAX_THROWS_PER_BRICK = 2; // lanzamientos de referencia por bloque: bonus de 25 pts por cada uno que sobre
const MIN_BREAK_SPEED = 2.5;

// Niveles de dificultad según el número de nombres activos (1 a 4 filas)
const LEVEL_CONFIG = {
  1: { title: 'NIVEL 1 · FÁCIL', desc: '1 fila de ladrillos · Letras grandes' },
  2: { title: 'NIVEL 2 · MEDIO', desc: '2 filas de ladrillos · Mayor reto' },
  3: { title: 'NIVEL 3 · DIFÍCIL', desc: '3 filas de ladrillos · Letras reducidas' },
  4: { title: 'NIVEL 4 · EXPERTO', desc: '4 filas de ladrillos · Máxima precisión' },
};

function getCurrentLevel() {
  const count = wordsList.filter((w) => w.active).length;
  return Math.min(4, Math.max(1, count));
}

let bricks = [];
let shards = [];
let pendingBreaks = [];
let game = { state: 'idle', level: 1, score: 0, startTime: 0, elapsed: 0, throws: 0, bonusTimeSaved: 0, lastRank: null };

// Ladrillo especial multicolor móvil
let specialBrick = null;
let nextSpecialSpawnTime = 0;
let floatingTexts = [];

// Popup toast de dificultad
let diffToastTimeout = null;
function showDifficultyToast() {
  const popup = document.getElementById('difficulty-popup');
  const levelEl = document.getElementById('diff-toast-level');
  const subEl = document.getElementById('diff-toast-sub');
  if (!popup || !levelEl || !subEl) return;

  const lvl = getCurrentLevel();
  const cfg = LEVEL_CONFIG[lvl] || LEVEL_CONFIG[1];
  levelEl.textContent = cfg.title;
  subEl.textContent = cfg.desc;

  popup.removeAttribute('hidden');
  void popup.offsetWidth;
  popup.classList.add('visible');

  if (diffToastTimeout) clearTimeout(diffToastTimeout);
  diffToastTimeout = setTimeout(() => {
    popup.classList.remove('visible');
    setTimeout(() => popup.setAttribute('hidden', ''), 240);
  }, 1600);
}

function toRankingModeKey(level = getCurrentLevel()) {
  if (level === 'pintar' || level === 'relax') return 'pintar';
  if (level === 'mates') return 'mates';
  return String(Math.min(4, Math.max(1, parseInt(level, 10) || 1)));
}

function runWithNetworkTimeout(promise, timeoutMs = 8000) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.reject(new Error('OFFLINE'));
  }
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('OFFLINE')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function loadRanking(level = getCurrentLevel()) {
  const modeKey = toRankingModeKey(level);
  const q = query(
    collection(db, 'rankings', modeKey, 'entries'),
    orderBy('score', 'desc'),
    orderBy('time', 'asc'),
    limit(10)
  );
  const snapshot = await runWithNetworkTimeout(getDocsFromServer(q));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function saveRankingEntry(level, entry) {
  const modeKey = toRankingModeKey(level);
  const cleanName = String(entry.name || '').trim().toUpperCase().slice(0, 10);
  const maxScore = modeKey === 'mates' ? 10 : 1000000;
  const cleanScore = Math.max(0, Math.min(maxScore, Math.round(Number(entry.score) || 0)));
  const cleanTime = Math.max(0, Math.min(86400, Number((Number(entry.time) || 0).toFixed(2))));

  const payload = {
    name: cleanName,
    score: cleanScore,
    time: cleanTime,
    createdAt: serverTimestamp(),
  };

  if (
    typeof entry.avatar === 'string' &&
    entry.avatar.length <= 30000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(entry.avatar)
  ) {
    payload.avatar = entry.avatar;
  }

  const docRef = await runWithNetworkTimeout(
    addDoc(collection(db, 'rankings', modeKey, 'entries'), payload)
  );
  const list = await loadRanking(modeKey).catch(() => [{ id: docRef.id, ...payload }]);
  return { id: docRef.id, list };
}

function setRankingLoadingState(listEl, emptyEl, message) {
  if (listEl) listEl.innerHTML = '';
  if (emptyEl) {
    emptyEl.textContent = message;
    emptyEl.removeAttribute('hidden');
  }
}

async function loadAndRenderRanking({
  listEl,
  emptyEl,
  emptyText,
  level,
  mode = null,
  highlightId = null,
  tokenState,
}) {
  const reqToken = ++tokenState.id;
  setRankingLoadingState(listEl, emptyEl, 'Cargando rankings...');
  try {
    const list = await loadRanking(level);
    if (reqToken !== tokenState.id) return;
    if (emptyEl) emptyEl.textContent = emptyText;
    renderRankingList(listEl, emptyEl, list, highlightId, mode);
  } catch (err) {
    if (reqToken !== tokenState.id) return;
    console.warn('Error al leer ranking de Firestore:', err);
    setRankingLoadingState(listEl, emptyEl, 'Sin conexión para cargar el ranking');
  }
}

function formatRankingScore(entry, mode) {
  if (mode === 'mates') {
    const timeText = Number.isFinite(entry.time) ? ` · ${entry.time.toFixed(1)}s` : '';
    return `${entry.score}/10${timeText}`;
  }
  return entry.score;
}

function renderRankingList(listEl, emptyEl, list, highlightId = null, mode = null) {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (list.length === 0) {
    if (emptyEl) emptyEl.removeAttribute('hidden');
    return;
  }
  if (emptyEl) emptyEl.setAttribute('hidden', '');
  list.slice(0, 10).forEach((entry, i) => {
    const li = document.createElement('li');
    if (entry.id === highlightId) li.className = 'me';
    const pos = document.createElement('span');
    pos.textContent = `${i + 1}.`;

    const player = document.createElement('span');
    player.className = 'rank-player';
    if (typeof entry.avatar === 'string' && entry.avatar.startsWith('data:image/')) {
      const img = document.createElement('img');
      img.className = 'rank-avatar';
      img.src = entry.avatar;
      img.alt = '';
      player.appendChild(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'rank-avatar placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.textContent = '👤';
      player.appendChild(placeholder);
    }
    const name = document.createElement('span');
    name.className = 'rank-player-name';
    name.textContent = entry.name;
    player.appendChild(name);

    const pts = document.createElement('span');
    pts.textContent = formatRankingScore(entry, mode);
    li.append(pos, player, pts);
    listEl.appendChild(li);
  });
}

function getBricksTop() {
  return width <= 640 ? 76 : 76;
}

function getBrickGeometry() {
  const gap = 5;
  const targetW = width <= 640 ? 40 : 60;
  const n = Math.max(4, Math.floor((width - 20 + gap) / (targetW + gap)));
  const rows = Math.min(4, Math.max(1, wordsList.filter((w) => w.active).length));
  const bw = Math.min(targetW * 1.3, (width - 20 - (n - 1) * gap) / n);
  const bh = bw * (rows >= 4 ? 0.44 : (rows >= 3 ? 0.48 : 0.54));
  const startX = (width - (n * bw + (n - 1) * gap)) / 2 + bw / 2;
  const y = getBricksTop() + bh / 2;
  return { n, rows, gap, bw, bh, startX, y };
}

function getBricksBottom() {
  const g = getBrickGeometry();
  return g.y + (g.rows - 1) * (g.bh + g.gap) + g.bh / 2;
}

function getLowestAliveBrickBottom() {
  let maxBottom = 0;
  for (const b of bricks) {
    if (b.alive) {
      maxBottom = Math.max(maxBottom, b.y + b.h / 2);
    }
  }
  return maxBottom > 0 ? maxBottom : getBricksBottom();
}

function placeBrick(brick, g) {
  brick.x = g.startX + brick.col * (g.bw + g.gap);
  brick.y = g.y + brick.row * (g.bh + g.gap);
  brick.w = g.bw;
  brick.h = g.bh;
}

function createBrickBody(brick, g) {
  // Sin cuerpo físico: el impacto se calcula a nivel de píxel en processBrickHits()
  placeBrick(brick, g);
}

function buildBricks() {
  for (const b of bricks) {
    if (b.alive && b.body) World.remove(world, b.body);
  }
  bricks = [];
  shards = [];
  pendingBreaks = [];

  const letters = [...new Set(getLetterLayout().map((i) => i.char))];
  const g = getBrickGeometry();
  const total = g.n * g.rows;

  // Cada letra en juego aparece al menos una vez (si caben); el resto es aleatorio
  const chars = [];
  const pool = [...letters].sort(() => Math.random() - 0.5);
  for (let i = 0; i < total; i++) {
    chars.push(i < pool.length ? pool[i] : letters[Math.floor(Math.random() * letters.length)]);
  }
  chars.sort(() => Math.random() - 0.5);

  chars.forEach((char, index) => {
    const brick = { index, col: index % g.n, row: Math.floor(index / g.n), char, alive: true, body: null };
    createBrickBody(brick, g);
    bricks.push(brick);
  });
}

function relayoutBricks() {
  const g = getBrickGeometry();
  if (g.n * g.rows !== bricks.length) return;
  for (const b of bricks) {
    if (b.alive) createBrickBody(b, g);
    else placeBrick(b, g);
  }
}

function startGame() {
  specialBrick = null;
  floatingTexts = [];
  if (isGyroActive) {
    bricks = [];
    shards = [];
    pendingBreaks = [];
    game = { state: 'idle', level: getCurrentLevel(), score: 0, startTime: 0, elapsed: 0, throws: 0, bonusTimeSaved: 0, lastRank: null };
    closeGameOverModal();
    return;
  }
  buildBricks();
  game = { state: 'playing', level: getCurrentLevel(), score: 0, startTime: performance.now(), elapsed: 0, throws: 0, bonusTimeSaved: 0, lastRank: null };
  nextSpecialSpawnTime = performance.now() + 15000 + Math.random() * 5000;
  closeGameOverModal();
}

// --- IMPACTO PRECISO: máscara de píxeles reales de cada letra ---
const glyphMaskCache = new Map();
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => glyphMaskCache.clear());
}

function getGlyphMask(char, size) {
  const key = `${char}|${Math.round(size)}`;
  let mask = glyphMaskCache.get(key);
  if (mask) return mask;

  const dim = Math.ceil(size * 1.6);
  const off = document.createElement('canvas');
  off.width = dim;
  off.height = dim;
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.font = `900 ${size}px ${CONFIG.fontFamily}`;
  octx.textAlign = 'center';
  octx.textBaseline = 'middle';
  octx.fillStyle = '#fff';
  octx.fillText(char, dim / 2, dim / 2);

  const data = octx.getImageData(0, 0, dim, dim).data;
  const step = size > 90 ? 3 : 2;
  const points = [];
  let top = 0;
  for (let y = 0; y < dim; y += step) {
    for (let x = 0; x < dim; x += step) {
      if (data[(y * dim + x) * 4 + 3] > 128) {
        points.push(x - dim / 2, y - dim / 2);
        top = Math.min(top, y - dim / 2);
      }
    }
  }
  mask = { points: new Float32Array(points), top };
  glyphMaskCache.set(key, mask);
  return mask;
}

function letterTouchesBrick(body, mask, brick) {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  const bx = body.position.x;
  const by = body.position.y;
  const left = brick.x - brick.w / 2;
  const right = brick.x + brick.w / 2;
  const topEdge = brick.y - brick.h / 2;
  const bottomEdge = brick.y + brick.h / 2;
  const pts = mask.points;
  for (let i = 0; i < pts.length; i += 2) {
    const px = pts[i];
    const py = pts[i + 1];
    const wx = bx + px * cos - py * sin;
    const wy = by + px * sin + py * cos;
    if (wx >= left && wx <= right && wy >= topEdge && wy <= bottomEdge) return true;
  }
  return false;
}

function addFloatingText(text, x, y, color = '#66fcf1') {
  floatingTexts.push({ text, x, y, alpha: 1, vy: -1.2, color });
}

function updateAndDrawFloatingTexts(ctx) {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y += ft.vy;
    ft.alpha -= 0.016;
    if (ft.alpha <= 0) {
      floatingTexts.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, ft.alpha);
    ctx.font = `900 15px 'Space Grotesk', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ft.color;
    ctx.shadowColor = ft.color;
    ctx.shadowBlur = 12;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

function updateSpecialBrick(dt, now) {
  if (isGyroActive || game.state !== 'playing') {
    specialBrick = null;
    return;
  }

  // Generar ladrillo especial arbitrario
  if (!specialBrick && now >= nextSpecialSpawnTime) {
    const letters = [...new Set(getLetterLayout().map((i) => i.char))];
    if (letters.length > 0) {
      const g = getBrickGeometry();
      const char = letters[Math.floor(Math.random() * letters.length)];
      const w = g.bw * 1.15;
      const h = g.bh * 1.05;
      const lowestBottom = getLowestAliveBrickBottom();
      const y = lowestBottom + g.gap + h / 2 + 4;
      const fromLeft = Math.random() > 0.5;
      const speed = (width <= 640 ? 2.0 : 2.8) * (0.85 + Math.random() * 0.3);

      specialBrick = {
        char,
        x: fromLeft ? w / 2 + 10 : width - w / 2 - 10,
        y,
        w,
        h,
        vx: fromLeft ? speed : -speed,
        spawnTime: now,
        duration: 10000, // 10 segundos de duración
        alive: true,
      };
    }
  }

  // Desplazar de lado a lado
  if (specialBrick && specialBrick.alive) {
    const age = now - specialBrick.spawnTime;
    if (age >= specialBrick.duration) {
      // Caducó tras 10 segundos
      specialBrick = null;
      nextSpecialSpawnTime = now + 20000 + Math.random() * 5000;
      return;
    }

    specialBrick.x += specialBrick.vx * (dt / 16.6);
    const minX = specialBrick.w / 2 + 10;
    const maxX = width - specialBrick.w / 2 - 10;
    if (specialBrick.x <= minX) {
      specialBrick.x = minX;
      specialBrick.vx = Math.abs(specialBrick.vx);
    } else if (specialBrick.x >= maxX) {
      specialBrick.x = maxX;
      specialBrick.vx = -Math.abs(specialBrick.vx);
    }

    // Mantener un nivel por debajo de la línea inferior que aparezca
    const g = getBrickGeometry();
    const lowestBottom = getLowestAliveBrickBottom();
    specialBrick.y = lowestBottom + g.gap + specialBrick.h / 2 + 4;
  }
}

function processBrickHits() {
  if (isGyroActive || game.state !== 'playing') return;
  const now = performance.now();

  for (const body of letterBodies) {
    if (body === draggedBody) continue;
    const { x, y } = body.position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    for (const brick of bricks) {
      if (!brick.alive) continue;
      const reachX = brick.w / 2 + body.size;
      const reachY = brick.h / 2 + body.size;
      if (Math.abs(x - brick.x) > reachX || Math.abs(y - brick.y) > reachY) continue;

      const mask = getGlyphMask(body.char, body.size);
      if (!letterTouchesBrick(body, mask, brick)) continue;

      const speed = Math.hypot(body.velocity.x, body.velocity.y);

      if (speed >= MIN_BREAK_SPEED && body.char === brick.char) {
        brick.alive = false;
        pendingBreaks.push(brick);
        continue;
      }

      // Rebote contra el ladrillo (eje de menor penetración)
      const nx = (x - brick.x) / reachX;
      const ny = (y - brick.y) / reachY;
      if (Math.abs(ny) >= Math.abs(nx)) {
        const dir = ny >= 0 ? 1 : -1;
        Body.setVelocity(body, { x: body.velocity.x, y: dir * Math.abs(body.velocity.y) * 0.5 });
        Body.setPosition(body, { x, y: y + dir * 2 });
      } else {
        const dir = nx >= 0 ? 1 : -1;
        Body.setVelocity(body, { x: dir * Math.abs(body.velocity.x) * 0.5, y: body.velocity.y });
        Body.setPosition(body, { x: x + dir * 2, y });
      }

      // Penalización por letra equivocada (con enfriamiento para no repetirla cada frame)
      if (speed >= MIN_BREAK_SPEED && body.char !== brick.char) {
        if (!body.lastWrongHit || now - body.lastWrongHit > 400) {
          game.score = Math.max(0, game.score - WRONG_HIT_PENALTY);
        }
        body.lastWrongHit = now;
      }
    }

    // 2. Comprobación contra el ladrillo especial multicolor en movimiento
    if (specialBrick && specialBrick.alive) {
      const sb = specialBrick;
      const reachX = sb.w / 2 + body.size;
      const reachY = sb.h / 2 + body.size;
      if (Math.abs(x - sb.x) <= reachX && Math.abs(y - sb.y) <= reachY) {
        const mask = getGlyphMask(body.char, body.size);
        if (letterTouchesBrick(body, mask, sb)) {
          const speed = Math.hypot(body.velocity.x, body.velocity.y);
          if (speed >= MIN_BREAK_SPEED && body.char === sb.char) {
            // ¡Ladrillo especial roto!
            sb.alive = false;
            spawnShards(sb, true);
            soundManager.playGlassBreak();
            soundManager.playGlitter();

            // Extra: -2seg a descontar del tiempo para valorar la puntuación
            game.bonusTimeSaved = (game.bonusTimeSaved || 0) + 2;
            game.startTime += 2000; // Descuenta 2 segundos netos del tiempo transcurrido
            game.score += 200; // Puntos extra

            addFloatingText('-2s EXTRA!', sb.x, sb.y - 12, '#fed330');
            specialBrick = null;
            nextSpecialSpawnTime = now + 22000 + Math.random() * 5000;
          } else {
            // Rebote contra el ladrillo especial
            const nx = (x - sb.x) / reachX;
            const ny = (y - sb.y) / reachY;
            if (Math.abs(ny) >= Math.abs(nx)) {
              const dir = ny >= 0 ? 1 : -1;
              Body.setVelocity(body, { x: body.velocity.x, y: dir * Math.abs(body.velocity.y) * 0.5 });
              Body.setPosition(body, { x, y: y + dir * 2 });
            } else {
              const dir = nx >= 0 ? 1 : -1;
              Body.setVelocity(body, { x: dir * Math.abs(body.velocity.x) * 0.5, y: body.velocity.y });
              Body.setPosition(body, { x: x + dir * 2, y });
            }

            if (speed >= MIN_BREAK_SPEED && body.char !== sb.char) {
              if (!body.lastWrongHit || now - body.lastWrongHit > 400) {
                game.score = Math.max(0, game.score - WRONG_HIT_PENALTY);
              }
              body.lastWrongHit = now;
            }
          }
        }
      }
    }
  }
}

function spawnShards(brick, isMulticolor = false) {
  const count = isMulticolor ? 24 : 18;
  for (let i = 0; i < count; i++) {
    const px = brick.x + (Math.random() - 0.5) * brick.w;
    const py = brick.y + (Math.random() - 0.5) * brick.h;
    const s = 4 + Math.random() * 9;
    shards.push({
      x: px,
      y: py,
      vx: (px - brick.x) * 0.12 + (Math.random() - 0.5) * 5,
      vy: -2 - Math.random() * 5,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.4,
      pts: [
        { x: 0, y: -s },
        { x: s * (0.5 + Math.random() * 0.5), y: s * 0.6 },
        { x: -s * (0.5 + Math.random() * 0.5), y: s * 0.6 },
      ],
      life: 1,
      color: isMulticolor ? `hsl(${Math.random() * 360}, 100%, 70%)` : null,
    });
  }
}

function processPendingBreaks() {
  if (pendingBreaks.length === 0) return;
  const list = pendingBreaks;
  pendingBreaks = [];
  for (const brick of list) {
    if (brick.body) World.remove(world, brick.body);
    spawnShards(brick);
    soundManager.playGlassBreak();
    game.score += POINTS_PER_BRICK;
  }
  if (game.state === 'playing' && bricks.every((b) => !b.alive)) {
    finishGame();
  }
}

function finishGame() {
  game.state = 'finished';
  specialBrick = null;
  game.elapsed = Math.max(0, (performance.now() - game.startTime) / 1000);
  const timeBonus = Math.max(0, Math.round(bricks.length * SECONDS_PER_BRICK - game.elapsed)) * 10;
  const throwBonus = Math.max(0, bricks.length * MAX_THROWS_PER_BRICK - game.throws) * 25;
  game.score += timeBonus + throwBonus;
  game.timeBonus = timeBonus;
  game.throwBonus = throwBonus;
  soundManager.playVictory();
  setTimeout(openGameOverModal, 1100);
}

function drawGame(ctx) {
  if (isGyroActive) return;
  if (game.state === 'playing') {
    game.elapsed = Math.max(0, (performance.now() - game.startTime) / 1000);
  }

  // 1. Bloques blancos estándar estilo Arkanoid
  for (const b of bricks) {
    if (!b.alive) continue;
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,0.45)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Biseles
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(b.x - b.w / 2 + 2, b.y - b.h / 2 + 2, b.w - 4, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(b.x - b.w / 2 + 2, b.y + b.h / 2 - 4, b.w - 4, 2);
    ctx.fillStyle = '#0b0c10';
    ctx.font = `900 ${Math.round(b.h * 0.7)}px ${CONFIG.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.char, b.x, b.y + 1);
    ctx.restore();
  }

  // 2. Ladrillo especial multicolor en movimiento (un nivel por debajo de la línea inferior)
  if (specialBrick && specialBrick.alive) {
    const sb = specialBrick;
    const elapsed = performance.now() - sb.spawnTime;
    const timeLeftRatio = Math.max(0, 1 - elapsed / sb.duration);

    ctx.save();
    const t = performance.now() * 0.003;
    const grad = ctx.createLinearGradient(sb.x - sb.w / 2, sb.y, sb.x + sb.w / 2, sb.y);
    const h1 = (t * 220) % 360;
    const h2 = (h1 + 90) % 360;
    const h3 = (h1 + 180) % 360;
    const h4 = (h1 + 270) % 360;
    grad.addColorStop(0, `hsl(${h1}, 100%, 65%)`);
    grad.addColorStop(0.33, `hsl(${h2}, 100%, 65%)`);
    grad.addColorStop(0.66, `hsl(${h3}, 100%, 65%)`);
    grad.addColorStop(1, `hsl(${h4}, 100%, 65%)`);

    ctx.shadowColor = `hsl(${h1}, 100%, 70%)`;
    ctx.shadowBlur = 16;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(sb.x - sb.w / 2, sb.y - sb.h / 2, sb.w, sb.h, 4);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Brillo superior e inferior
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(sb.x - sb.w / 2 + 2, sb.y - sb.h / 2 + 2, sb.w - 4, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(sb.x - sb.w / 2 + 2, sb.y + sb.h / 2 - 4, sb.w - 4, 2);

    // Barra de tiempo restante (10 segundos)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(sb.x - sb.w / 2 + 3, sb.y + sb.h / 2 - 2, (sb.w - 6) * timeLeftRatio, 2);

    // Letra
    ctx.fillStyle = '#0b0c10';
    ctx.font = `900 ${Math.round(sb.h * 0.72)}px ${CONFIG.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sb.char, sb.x, sb.y);
    ctx.restore();
  }

  // 3. Fragmentos de cristal
  for (let i = shards.length - 1; i >= 0; i--) {
    const s = shards[i];
    s.vy += 0.35;
    s.x += s.vx;
    s.y += s.vy;
    s.rot += s.vr;
    s.life -= 0.016;
    if (s.life <= 0 || s.y > height + 20) {
      shards.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.globalAlpha = Math.max(0, s.life);
    ctx.fillStyle = s.color || 'rgba(235,248,255,0.9)';
    ctx.strokeStyle = s.color ? '#fff' : 'rgba(255,255,255,1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.pts[0].x, s.pts[0].y);
    ctx.lineTo(s.pts[1].x, s.pts[1].y);
    ctx.lineTo(s.pts[2].x, s.pts[2].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 4. Textos flotantes (-2s EXTRA!)
  updateAndDrawFloatingTexts(ctx);

  // 5. HUD: puntos, tiempo y lanzamientos (colocado con holgura bajo las filas y el bloque especial)
  const bonusTimeText = game.bonusTimeSaved ? ` (-${game.bonusTimeSaved}s)` : '';
  const lowestBottom = getLowestAliveBrickBottom();
  const hudY = Math.max(
    lowestBottom + (width <= 640 ? 32 : 36),
    (specialBrick && specialBrick.alive ? specialBrick.y + specialBrick.h / 2 + 16 : 0)
  );

  ctx.save();
  ctx.font = `500 ${width <= 640 ? 11 : 13}px 'Space Grotesk', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(
    `PUNTOS ${String(game.score).padStart(5, '0')}   ·   TIEMPO ${game.elapsed.toFixed(1)}s${bonusTimeText}   ·   LANZ. ${game.throws}`,
    width / 2,
    hudY
  );
  ctx.restore();
}

// Modal fin de partida + ranking
const modalGameOver = document.getElementById('modal-game-over');
const goTitle = document.getElementById('go-title');
const formScore = document.getElementById('form-score');
const inputPlayerName = document.getElementById('input-player-name');
const goSummary = document.getElementById('go-summary');
const rankingBox = document.getElementById('ranking-box');
const rankingTabs = document.getElementById('ranking-tabs');
const rankingEmpty = document.getElementById('ranking-empty');
const rankingList = document.getElementById('ranking-list');
const btnPlayAgain = document.getElementById('btn-play-again');
const scoreSelfieSlot = document.getElementById('score-selfie-slot');
const mathSelfieSlot = document.getElementById('math-selfie-slot');

const selfieManager = (() => {
  const WORK_SIZE = 56;
  const OUTPUT_SIZE = 96;

  const wrap = document.createElement('div');
  wrap.className = 'selfie-inner';

  const frame = document.createElement('div');
  frame.className = 'selfie-frame';

  const video = document.createElement('video');
  video.className = 'selfie-video';
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.setAttribute('aria-hidden', 'true');

  const previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'selfie-canvas';
  previewCanvas.width = OUTPUT_SIZE;
  previewCanvas.height = OUTPUT_SIZE;
  previewCanvas.hidden = true;
  const previewCtx = previewCanvas.getContext('2d');

  const workCanvas = document.createElement('canvas');
  workCanvas.width = WORK_SIZE;
  workCanvas.height = WORK_SIZE;
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
  const lumBuffer = new Float32Array(WORK_SIZE * WORK_SIZE);

  const fallbackIcon = document.createElement('span');
  fallbackIcon.className = 'selfie-fallback-icon';
  fallbackIcon.setAttribute('aria-hidden', 'true');
  fallbackIcon.textContent = '🎨';

  frame.append(video, previewCanvas, fallbackIcon);

  const meta = document.createElement('div');
  meta.className = 'selfie-meta';

  const statusEl = document.createElement('span');
  statusEl.className = 'selfie-status';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'selfie-toggle-btn';
  toggleBtn.textContent = 'Omitir avatar';

  meta.append(statusEl, toggleBtn);
  wrap.append(frame, meta);

  let stream = null;
  let currentSlot = null;
  let skipped = false;
  let requestToken = 0;
  let previewTimer = null;

  function renderCartoonFrame() {
    if (!workCtx || !previewCtx || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return false;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const crop = Math.min(vw, vh);
    const sx = (vw - crop) / 2;
    const sy = (vh - crop) / 2;

    // 1. Reducir y espejar para suavizar rasgos fotográficos antes de estilizar
    workCtx.save();
    workCtx.imageSmoothingEnabled = true;
    workCtx.clearRect(0, 0, WORK_SIZE, WORK_SIZE);
    workCtx.translate(WORK_SIZE, 0);
    workCtx.scale(-1, 1);
    workCtx.drawImage(video, sx, sy, crop, crop, 0, 0, WORK_SIZE, WORK_SIZE);
    workCtx.restore();

    const imgData = workCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
    const data = imgData.data;

    // 2. Calcular luminancia para detección de bordes + cuantización cel-shading
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lumBuffer[p] = lum;

      // Realzar color y reducir a tonos planos de dibujo animado
      const sat = 1.35;
      const sr = Math.max(0, Math.min(255, lum + (r - lum) * sat));
      const sg = Math.max(0, Math.min(255, lum + (g - lum) * sat));
      const sb = Math.max(0, Math.min(255, lum + (b - lum) * sat));

      data[i] = Math.min(255, Math.floor(sr / 52) * 52 + 24);
      data[i + 1] = Math.min(255, Math.floor(sg / 52) * 52 + 24);
      data[i + 2] = Math.min(255, Math.floor(sb / 52) * 52 + 24);
    }

    // 3. Trazos de contorno tipo cómic sobre los bordes de contraste
    for (let y = 1; y < WORK_SIZE - 1; y++) {
      for (let x = 1; x < WORK_SIZE - 1; x++) {
        const p = y * WORK_SIZE + x;
        const gx = lumBuffer[p + 1] - lumBuffer[p - 1];
        const gy = lumBuffer[p + WORK_SIZE] - lumBuffer[p - WORK_SIZE];
        const edge = Math.hypot(gx, gy);
        if (edge > 26) {
          const idx = p * 4;
          const ink = Math.min(0.88, (edge - 26) / 60);
          data[idx] = Math.round(data[idx] * (1 - ink) + 20 * ink);
          data[idx + 1] = Math.round(data[idx + 1] * (1 - ink) + 24 * ink);
          data[idx + 2] = Math.round(data[idx + 2] * (1 - ink) + 36 * ink);
        }
      }
    }

    workCtx.putImageData(imgData, 0, 0);

    previewCtx.imageSmoothingEnabled = true;
    previewCtx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    previewCtx.drawImage(workCanvas, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    return true;
  }

  function stopPreviewLoop() {
    if (previewTimer) {
      clearInterval(previewTimer);
      previewTimer = null;
    }
  }

  function startPreviewLoop() {
    stopPreviewLoop();
    renderCartoonFrame();
    previewTimer = setInterval(renderCartoonFrame, 70);
  }

  function stopStream() {
    stopPreviewLoop();
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
    previewCanvas.hidden = true;
    fallbackIcon.hidden = false;
  }

  function setStatus(text, showToggle, toggleText = 'Omitir avatar') {
    statusEl.textContent = text;
    toggleBtn.hidden = !showToggle;
    toggleBtn.textContent = toggleText;
  }

  async function requestCamera(slotEl) {
    if (!slotEl) return;
    currentSlot = slotEl;
    if (wrap.parentElement !== slotEl) {
      slotEl.replaceChildren(wrap);
    }
    skipped = false;
    stopStream();

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setStatus('Cámara no disponible (puedes guardar igual)', false);
      return;
    }

    const token = ++requestToken;
    setStatus('Solicitando permiso de cámara...', true, 'Omitir avatar');

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 240 }, height: { ideal: 240 } },
        audio: false,
      });

      if (token !== requestToken || skipped) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }

      stream = mediaStream;
      video.srcObject = mediaStream;
      await video.play().catch(() => {});
      previewCanvas.hidden = false;
      fallbackIcon.hidden = true;
      startPreviewLoop();
      setStatus('🎨 Se guardará en modo avatar animado', true, 'Omitir avatar');
    } catch {
      if (token !== requestToken) return;
      stopStream();
      setStatus('Sin permiso de cámara (puedes guardar igual)', true, 'Reintentar');
    }
  }

  toggleBtn.addEventListener('click', () => {
    if (!skipped && stream) {
      skipped = true;
      requestToken += 1;
      stopStream();
      setStatus('Sin avatar para esta partida', true, 'Activar cámara');
      return;
    }
    if (currentSlot) {
      requestCamera(currentSlot);
    }
  });

  function capture() {
    if (skipped || !stream || !renderCartoonFrame()) {
      return null;
    }
    return previewCanvas.toDataURL('image/jpeg', 0.72);
  }

  function captureAndStop() {
    const dataUrl = capture();
    stop();
    return dataUrl;
  }

  function stop() {
    requestToken += 1;
    stopStream();
  }

  return { start: requestCamera, capture, captureAndStop, stop };
})();

const scoreSaveError = document.getElementById('score-save-error');
const mathSaveError = document.getElementById('math-save-error');
const gameOverRankingToken = { id: 0 };
const homeRankingToken = { id: 0 };
const mathRankingToken = { id: 0 };
let pendingScoreAvatar = null;
let pendingMathAvatar = null;
let currentRankingTab = 1;

function showFormError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearFormError(errorEl) {
  if (!errorEl) return;
  errorEl.textContent = '';
  errorEl.hidden = true;
}

function updateRankingTabsUI(selectedLevel) {
  if (!rankingTabs) return;
  const tabButtons = rankingTabs.querySelectorAll('.rank-tab-btn');
  tabButtons.forEach((btn) => {
    const lvlAttr = btn.getAttribute('data-level');
    const lvl = lvlAttr === 'pintar' ? 'pintar' : parseInt(lvlAttr, 10);
    btn.classList.toggle('active', String(lvl) === String(selectedLevel));
  });
}

function openGameOverModal() {
  if (isGyroActive && relaxChallenge.state === 'won') {
    if (goTitle) goTitle.textContent = '¡RETO DE PINTAR SUPERADO!';
    const t1 = relaxChallenge.stepTimes[0].toFixed(1);
    const t2 = relaxChallenge.stepTimes[1].toFixed(1);
    const t3 = relaxChallenge.stepTimes[2].toFixed(1);
    const totalT = (relaxChallenge.stepTimes[0] + relaxChallenge.stepTimes[1] + relaxChallenge.stepTimes[2]).toFixed(1);
    goSummary.textContent = `${relaxChallenge.score} puntos · Total ${totalT}s (Reto 1: ${t1}s · Reto 2: ${t2}s · Reto 3: ${t3}s)`;
    pendingScoreAvatar = null;
    clearFormError(scoreSaveError);
    formScore.hidden = false;
    rankingBox.hidden = true;
    inputPlayerName.value = '';
    modalGameOver.removeAttribute('hidden');
    selfieManager.start(scoreSelfieSlot);
    setTimeout(() => inputPlayerName.focus(), 60);
    return;
  }

  if (game.state !== 'finished') return;
  const lvl = game.level || getCurrentLevel();
  if (goTitle) goTitle.textContent = `¡NIVEL ${lvl} COMPLETADO!`;
  const extraSaved = game.bonusTimeSaved ? `, extra -${game.bonusTimeSaved}s` : '';
  goSummary.textContent = `${game.score} puntos · ${game.elapsed.toFixed(1)}s · ${game.throws} lanzamientos (bonus tiempo +${game.timeBonus || 0}${extraSaved}, bonus lanzamientos +${game.throwBonus || 0})`;
  pendingScoreAvatar = null;
  clearFormError(scoreSaveError);
  formScore.hidden = false;
  rankingBox.hidden = true;
  inputPlayerName.value = '';
  modalGameOver.removeAttribute('hidden');
  selfieManager.start(scoreSelfieSlot);
  setTimeout(() => inputPlayerName.focus(), 60);
}

function closeGameOverModal() {
  selfieManager.stop();
  pendingScoreAvatar = null;
  clearFormError(scoreSaveError);
  if (!modalGameOver) return;
  modalGameOver.setAttribute('hidden', '');
  inputPlayerName.blur();
}

function renderRanking(list, highlightId, selectedLevel = currentRankingTab) {
  currentRankingTab = selectedLevel;
  updateRankingTabsUI(selectedLevel);
  if (rankingEmpty) rankingEmpty.textContent = 'Sin puntuaciones aún en este nivel';
  renderRankingList(rankingList, rankingEmpty, list, highlightId, selectedLevel);
}

if (rankingTabs) {
  rankingTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.rank-tab-btn');
    if (!btn) return;
    const lvlAttr = btn.getAttribute('data-level');
    const lvl = lvlAttr === 'pintar' ? 'pintar' : parseInt(lvlAttr, 10);
    if (!lvl) return;
    currentRankingTab = lvl;
    updateRankingTabsUI(lvl);
    loadAndRenderRanking({
      listEl: rankingList,
      emptyEl: rankingEmpty,
      emptyText: 'Sin puntuaciones aún en este nivel',
      level: lvl,
      mode: lvl,
      tokenState: gameOverRankingToken,
    });
  });
}

formScore.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = inputPlayerName.value.trim().toUpperCase();
  if (!name) return;

  const isPaint = isGyroActive && relaxChallenge.state === 'won';
  if (!isPaint && game.state !== 'finished') return;

  clearFormError(scoreSaveError);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showFormError(scoreSaveError, 'No puedo guardar sin conexión!');
    return;
  }

  if (!pendingScoreAvatar) {
    pendingScoreAvatar = selfieManager.capture();
  }

  const lvl = isPaint ? 'pintar' : (game.level || getCurrentLevel());
  const score = isPaint ? relaxChallenge.score : game.score;
  const time = isPaint
    ? relaxChallenge.stepTimes[0] + relaxChallenge.stepTimes[1] + relaxChallenge.stepTimes[2]
    : game.elapsed;

  const submitBtn = formScore.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';
  }

  try {
    const { id, list } = await saveRankingEntry(lvl, {
      name,
      score,
      time,
      avatar: pendingScoreAvatar,
    });
    selfieManager.stop();
    pendingScoreAvatar = null;
    formScore.hidden = true;
    renderRanking(list, id, lvl);
    rankingBox.hidden = false;
  } catch (err) {
    console.warn('Error al guardar en Firestore:', err);
    showFormError(scoreSaveError, 'No puedo guardar sin conexión!');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar';
    }
  }
});

btnPlayAgain.addEventListener('click', () => {
  closeGameOverModal();
  if (isGyroActive) {
    startRelaxChallenge();
  } else {
    startFallingSequence();
  }
});

// Cancelar: cerrar la pantalla sin inscribir la puntuación en el ranking
document.getElementById('btn-skip-score').addEventListener('click', closeGameOverModal);
document.getElementById('btn-close-ranking').addEventListener('click', closeGameOverModal);

// Toggle de sonido: 0 = solo efectos, 1 = efectos + música (Tetris), 2 = sin sonido
const toggleMusic = document.getElementById('toggle-music');
const SOUND_MODES = [
  {
    text: 'SOLO EFECTOS',
    title: 'Solo efectos especiales',
    icon: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  },
  {
    text: 'EFECTOS + MÚSICA',
    title: 'Efectos + música',
    icon: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/>',
  },
  {
    text: 'SIN SONIDO',
    title: 'Sin sonido',
    icon: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  },
];
let soundMode = 0;

function applySoundMode() {
  const mode = SOUND_MODES[soundMode];
  soundManager.fxEnabled = soundMode !== 2;
  if (soundMode === 1) soundManager.startMusic();
  else soundManager.stopMusic();

  toggleMusic.classList.toggle('active', soundMode !== 2);
  toggleMusic.title = mode.title;
  toggleMusic.setAttribute('aria-label', mode.title);
  toggleMusic.innerHTML =
    `<span class="icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${mode.icon}</svg></span>` +
    `<span class="sound-ticker"><span class="sound-ticker-track"><span>${mode.text}&nbsp;&nbsp;•&nbsp;&nbsp;</span><span>${mode.text}&nbsp;&nbsp;•&nbsp;&nbsp;</span></span></span>`;
}

toggleMusic.addEventListener('click', () => {
  soundMode = (soundMode + 1) % SOUND_MODES.length;
  applySoundMode();
});
applySoundMode();

// Secuencia de Caída
let dropTimeouts = [];

function clearDropTimeouts() {
  dropTimeouts.forEach((t) => clearTimeout(t));
  dropTimeouts = [];
}

function startFallingSequence() {
  clearDropTimeouts();
  draggedBody = null;
  dragHistory = [];

  initPentagonPoints(true);
  for (let b of letterBodies) {
    World.remove(world, b);
  }
  letterBodies = [];
  startGame();

  const items = getLetterLayout();
  const delay = items.length > 6 ? 380 : (items.length > 4 ? 480 : CONFIG.dropDelay);

  items.forEach((item, i) => {
    const t = setTimeout(() => {
      spawnLetter(item.char, item.x, item.size);
    }, i * delay);
    dropTimeouts.push(t);
  });
}

// Mantener las letras siempre dentro del espacio visual de juego (rebote elástico de caja en modo relax)
function containLetters() {
  const heightScale = Math.max(1, height / 650);
  const maxSpeed = isGyroActive ? 42 : Math.round(28 * heightScale);
  const wallBounce = isGyroActive ? 0.78 : 0.5;
  let maxImpactSpeed = 0;

  for (const body of letterBodies) {
    if (body === draggedBody) continue;
    let { x, y } = body.position;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    let { x: vx, y: vy } = body.velocity;
    const half = body.size * 0.45;
    let moved = false;
    let hitSpeed = 0;

    if (x < half) {
      x = half;
      hitSpeed = Math.abs(vx);
      vx = hitSpeed * wallBounce;
      moved = true;
    } else if (x > width - half) {
      x = width - half;
      hitSpeed = Math.abs(vx);
      vx = -hitSpeed * wallBounce;
      moved = true;
    }

    if (y < half) {
      y = half;
      hitSpeed = Math.max(hitSpeed, Math.abs(vy));
      vy = hitSpeed * wallBounce;
      moved = true;
    } else if (y > height - half) {
      y = height - half;
      hitSpeed = Math.max(hitSpeed, Math.abs(vy));
      vy = -hitSpeed * wallBounce;
      moved = true;
    }

    const speed = Math.hypot(vx, vy);
    if (speed > maxSpeed) {
      vx = (vx / speed) * maxSpeed;
      vy = (vy / speed) * maxSpeed;
      moved = true;
    }

    if (moved) {
      Body.setPosition(body, { x, y });
      Body.setVelocity(body, { x: vx, y: vy });
      if (hitSpeed > maxImpactSpeed) {
        maxImpactSpeed = hitSpeed;
      }
    }
  }

  // Sonido de canica de cristal chocando con la caja de madera
  if (isGyroActive && maxImpactSpeed > 2.0) {
    soundManager.playWoodGlassHit(maxImpactSpeed / 16);
  }
}

// Detección e interacción elástica firme (Solver de impacto & contacto estricto)
function updateTrampolinePhysics() {
  const lineSpacing = width / (CONFIG.linePoints - 1);

  for (let body of letterBodies) {
    if (body === draggedBody) continue;

    // Altura visual real de la letra: radio exacto a la base tangencial (Cinzel Serif baseline: 0.38 * size)
    const baseContactRadius = body.size * 0.38;
    const letterFootY = body.position.y + baseContactRadius;
    const bodyX = body.position.x;
    if (!Number.isFinite(bodyX) || !Number.isFinite(body.position.y)) {
      Body.setPosition(body, { x: width / 2, y: 120 });
      Body.setVelocity(body, { x: 0, y: 0 });
      continue;
    }

    const nodeIndex = Math.min(
      Math.max(0, Math.round(bodyX / lineSpacing) || 0),
      lineNodes.length - 1
    );
    const node = lineNodes[nodeIndex];
    if (!node) continue;

    // Contacto físico tangencial estricto con la cuerda
    if (letterFootY >= node.y) {
      const penetration = letterFootY - node.y;

      // Fase de Impacto dinámico
      if (body.velocity.y > 1.2) {
        perturbLine(bodyX, Math.min(body.velocity.y * 0.9 + penetration * 0.15, 20));

        // Rebote elástico
        const bounceFactor = isGyroActive ? 0.82 : 0.55;
        Body.setVelocity(body, {
          x: body.velocity.x * (isGyroActive ? 0.98 : 0.9),
          y: -Math.min(body.velocity.y * bounceFactor, isGyroActive ? 20 : 12),
        });
        if (isGyroActive && body.velocity.y > 2.2) {
          soundManager.playWoodGlassHit(Math.min(body.velocity.y / 14, 1.0));
        }
      } else if (!isGyroActive) {
        // En reposo estándar: solo fijar si el giroscopio no está activo
        if (body.velocity.y >= 0) {
          Body.setPosition(body, {
            x: body.position.x,
            y: node.y - baseContactRadius,
          });

          Body.setAngle(body, body.angle * 0.85);
          Body.setAngularVelocity(body, 0);

          if (!isGyroActive && Math.abs(body.velocity.y) < 1.2) {
            Body.setVelocity(body, {
              x: body.velocity.x * 0.92,
              y: 0,
            });
          }
        }
      } else {
        // En modo giroscopio/relax: rodamiento fluido sobre la base sin saltos parásitos
        Body.setPosition(body, {
          x: body.position.x,
          y: node.y - baseContactRadius,
        });
        Body.setVelocity(body, {
          x: body.velocity.x * 0.992,
          y: Math.min(0, body.velocity.y),
        });
      }
    }

    // Límite superior: evitar desbordamiento
    const topY = body.position.y - baseContactRadius;
    if (topY <= 0 && body.hasImpacted) {
      Body.setPosition(body, {
        x: body.position.x,
        y: baseContactRadius,
      });
      if (body.velocity.y < 0) {
        Body.setVelocity(body, {
          x: body.velocity.x * 0.9,
          y: -body.velocity.y * 0.5,
        });
      }
    } else if (body.position.y > 50) {
      body.hasImpacted = true;
    }
  }
}

// Update de la Cuerda Elástica (Ecuación de onda suavizada y normalizada por dt)
function updateFloorMesh(dt = 16.6) {
  const dtNorm = Math.min(2.0, Math.max(0.5, dt / 16.6));
  const dampingFactor = Math.pow(CONFIG.damping, dtNorm);
  let hasEnergy = false;

  for (let node of lineNodes) {
    const dy = node.targetY - node.y;

    // Corte estricto de reposo: si la oscilación es minúscula, bloquear a 0
    if (Math.abs(dy) < 0.25 && Math.abs(node.vy) < 0.1) {
      node.y = node.targetY;
      node.vy = 0;
      continue;
    }

    hasEnergy = true;
    const springForce = dy * CONFIG.springK * dtNorm;
    node.vy += springForce;
    node.vy *= dampingFactor;
    node.y += node.vy * dtNorm;
  }

  // Si no hay perturbaciones activas, reposo total: cero vibración parásita
  if (!hasEnergy) return;

  leftDeltas.fill(0);
  rightDeltas.fill(0);

  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < lineNodes.length; i++) {
      if (i > 0) {
        leftDeltas[i] = CONFIG.spread * (lineNodes[i].y - lineNodes[i - 1].y);
        lineNodes[i - 1].vy += leftDeltas[i] * dtNorm;
      }
      if (i < lineNodes.length - 1) {
        rightDeltas[i] = CONFIG.spread * (lineNodes[i].y - lineNodes[i + 1].y);
        lineNodes[i + 1].vy += rightDeltas[i] * dtNorm;
      }
    }
    for (let i = 0; i < lineNodes.length; i++) {
      if (i > 0) lineNodes[i - 1].y += leftDeltas[i] * dtNorm;
      if (i < lineNodes.length - 1) lineNodes[i + 1].y += rightDeltas[i] * dtNorm;
    }
  }
}

// --- BOSQUEJO MINIMALISTA DE LABUBU (FONDO DESDE IMAGEN EN TRAZO BLANCO) ---
function drawLabubuSketch(ctx, cx, cy) {
  if (!isLabubuLoaded) return;

  const aspectRatio = 704 / 940; // proporción de la ilustración
  const maxH = Math.min(height * 0.60, 560);
  const maxW = Math.min(width * 0.86, 440);

  let drawH = maxH;
  let drawW = drawH * aspectRatio;

  if (drawW > maxW) {
    drawW = maxW;
    drawH = drawW / aspectRatio;
  }

  const drawX = cx - drawW / 2;
  const drawY = cy - drawH / 2;

  ctx.save();
  ctx.globalAlpha = 0.28; // Trazo blanco nítido y elegante de fondo
  ctx.drawImage(labubuImg, drawX, drawY, drawW, drawH);
  ctx.restore();
}

let lastRenderTime = performance.now();

// LOOP DE RENDERIZADO
function render(currentTime = performance.now()) {
  try {
    const dt = Math.min(Math.max(currentTime - lastRenderTime, 8), 33);
    lastRenderTime = currentTime;

    Engine.update(engine, dt);
    containLetters();
    if (isGyroActive) {
      updateRelaxMarblesPhysics(dt);
      updateRelaxChallengeFrame();
    }
    updateSpecialBrick(dt, currentTime);
    processBrickHits();
    processPendingBreaks();
    updateTrampolinePhysics();
    updateFloorMesh(dt);

    // Limpiar Canvas
    ctx.clearRect(0, 0, width, height);

    // 1. Dibujar Cuadrícula de Fondo
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridStep = 60;
    for (let x = 0; x < width; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 1.5. Bosquejo Minimalista de Labubu (fondo detrás de las bolitas de colores)
    drawLabubuSketch(ctx, width / 2, height * 0.48);

    // 2. Dibujar Suelo Deformable (Espacio-Tiempo)
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(lineNodes[0].x, lineNodes[0].y);
    for (let i = 1; i < lineNodes.length; i++) {
      const prev = lineNodes[i - 1];
      const curr = lineNodes[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.lineTo(lineNodes[lineNodes.length - 1].x, lineNodes[lineNodes.length - 1].y);
    ctx.lineTo(width, height);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, floorY, 0, height);
    grad.addColorStop(0, 'rgba(102, 252, 241, 0.08)');
    grad.addColorStop(1, 'rgba(11, 12, 16, 0.8)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(lineNodes[0].x, lineNodes[0].y);
    for (let i = 1; i < lineNodes.length; i++) {
      const prev = lineNodes[i - 1];
      const curr = lineNodes[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.strokeStyle = '#66fcf1';
    ctx.shadowColor = '#66fcf1';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 3. Dibujar Puntos de Color en Pentágono (~3.2px diámetro)
    for (let pt of pentagonNodes) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${pt.r}, ${pt.g}, ${pt.b}, 0.28)`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Comprobar contacto entre cada letra y cada punto del pentágono
    for (let body of letterBodies) {
      if (!body.touchingPoints) body.touchingPoints = {};

      if (body.isColorLocked) {
        continue;
      }

      for (let pt of pentagonNodes) {
        const isTouching = Matter.Bounds.contains(body.bounds, { x: pt.x, y: pt.y });
        if (isTouching) {
          body.colorContactTimes[pt.name] = (body.colorContactTimes[pt.name] || 0) + 1;
          if (!body.touchingPoints[pt.name]) {
            body.touchingPoints[pt.name] = true;
            soundManager.playGlitter();
          }
        } else {
          body.touchingPoints[pt.name] = false;
        }
      }

      let maxTime = 0;
      let dominantColorName = null;
      for (let cName in body.colorContactTimes) {
        if (body.colorContactTimes[cName] > maxTime) {
          maxTime = body.colorContactTimes[cName];
          dominantColorName = cName;
        }
      }

      if (dominantColorName && maxTime > 0) {
        const targetColor = COLOR_MAP[dominantColorName];
        if (targetColor) {
          const lerpFactor = 0.08;
          body.currentColorRgb[0] += (targetColor.r - body.currentColorRgb[0]) * lerpFactor;
          body.currentColorRgb[1] += (targetColor.g - body.currentColorRgb[1]) * lerpFactor;
          body.currentColorRgb[2] += (targetColor.b - body.currentColorRgb[2]) * lerpFactor;
        }
      }
    }

    drawGame(ctx);
    drawRelaxChallengeHUD(ctx);

    // 4. Dibujar Letras Físicas
    for (let body of letterBodies) {
      const { x, y } = body.position;
      const angle = body.angle;
      const size = body.size;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);

      ctx.font = `900 ${size}px ${CONFIG.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillText(body.char, 4, 4);

      const cr = Math.round(body.currentColorRgb[0]);
      const cg = Math.round(body.currentColorRgb[1]);
      const cb = Math.round(body.currentColorRgb[2]);
      ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;

      if (cr !== 255 || cg !== 255 || cb !== 255) {
        ctx.shadowColor = `rgb(${cr}, ${cg}, ${cb})`;
        ctx.shadowBlur = 14;
      }
      ctx.fillText(body.char, 0, 0);

      ctx.restore();
    }
  } catch (err) {
    console.error('Frame render safe guard:', err);
  }

  requestAnimationFrame(render);
}

// INTERACCIÓN: ARRASTRE Y LANZAMIENTO (Mouse & Touch)

function getPointerPos(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function onPointerDown(e) {
  const pos = getPointerPos(e);
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;

  // En modo juego (!isGyroActive), el lanzamiento debe realizarse desde la zona inferior
  const launchZoneTop = height * 0.55;
  if (!isGyroActive && pos.y < launchZoneTop) {
    return;
  }

  let touchedLetter = false;
  for (let body of letterBodies) {
    if (Matter.Bounds.contains(body.bounds, pos)) {
      draggedBody = body;
      dragStartY = pos.y;
      dragOffset = { x: pos.x - body.position.x, y: pos.y - body.position.y };
      dragHistory = [{ x: pos.x, y: pos.y, t: performance.now() }];
      Body.setVelocity(draggedBody, { x: 0, y: 0 });
      Body.setAngularVelocity(draggedBody, 0);
      if (e.cancelable && e.type && e.type.startsWith('touch')) {
        e.preventDefault();
      }
      touchedLetter = true;
      break;
    }
  }

  // Si estamos en modo relax y no se tocó una letra, permitir inclinar la caja deslizando la pantalla
  if (isGyroActive && !touchedLetter) {
    isVirtualTilting = true;
    virtualTiltStart = { x: pos.x, y: pos.y };
    if (e.cancelable && e.type && e.type.startsWith('touch')) {
      e.preventDefault();
    }
  }
}

function onPointerMove(e) {
  const pos = getPointerPos(e);
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;

  if (draggedBody) {
    if (e.cancelable && e.type && e.type.startsWith('touch')) {
      e.preventDefault();
    }

    const now = performance.now();
    const halfH = draggedBody.size / 2;
    const rawX = pos.x - dragOffset.x;
    const rawY = pos.y - dragOffset.y;

    // Registrar trayectoria para inercia de lanzamiento
    dragHistory.push({ x: rawX, y: rawY, t: now });
    if (dragHistory.length > 5) dragHistory.shift();

    // Si se intenta arrastrar la letra hacia arriba desde la zona de lanzamiento,
    // pierde el agarre al superar la distancia de aceleración para que los papirotes cojan velocidad sin subir pegada al ladrillo.
    // En móviles son 50px, en tablets/iPad escala proporcionalmente (hasta 85px) para dar recorrido al dedo.
    const releaseDistance = Math.max(50, Math.min(85, height * 0.08));
    if (!isGyroActive && (dragStartY - pos.y) >= releaseDistance) {
      onPointerUp();
      return;
    }

    const targetX = Math.max(30, Math.min(width - 30, rawX));
    const glyphTop = -getGlyphMask(draggedBody.char, draggedBody.size).top;
    const minY = (!isGyroActive && bricks.some((b) => b.alive)) ? getBricksBottom() + glyphTop + 3 : halfH;
    const targetY = Math.max(minY, Math.min(height - halfH, rawY));

    const vx = (targetX - draggedBody.position.x) * 0.45;
    const vy = (targetY - draggedBody.position.y) * 0.45;

    Body.setPosition(draggedBody, { x: targetX, y: targetY });
    Body.setVelocity(draggedBody, { x: vx, y: vy });
    Body.setAngularVelocity(draggedBody, 0);
    return;
  }

  // Inclinación virtual deslizando el dedo o ratón en modo relax
  if (isGyroActive && isVirtualTilting) {
    if (e.cancelable && e.type && e.type.startsWith('touch')) {
      e.preventDefault();
    }
    const dx = (pos.x - virtualTiltStart.x) / (width * 0.28);
    const dy = (pos.y - virtualTiltStart.y) / (height * 0.28);
    targetTilt.x = Math.max(-1.2, Math.min(1.2, dx));
    targetTilt.y = Math.max(-1.2, Math.min(1.2, dy));
  }
}

function onPointerUp() {
  isVirtualTilting = false;
  if (draggedBody) {
    let vx = 0;
    let vy = 0;
    const heightScale = Math.max(1, height / 650);
    const impulseMult = 1.35 * Math.min(1.6, heightScale);

    if (dragHistory.length >= 2) {
      const first = dragHistory[0];
      const last = dragHistory[dragHistory.length - 1];
      const dt = Math.max(last.t - first.t, 16);
      vx = ((last.x - first.x) / dt) * 16 * impulseMult;
      vy = ((last.y - first.y) / dt) * 16 * impulseMult;
    }

    const maxSpeed = Math.round(24 * heightScale);
    vx = Math.max(-maxSpeed, Math.min(maxSpeed, vx));
    vy = Math.max(-maxSpeed, Math.min(maxSpeed, vy));

    if (!isGyroActive && game.state === 'playing' && Math.hypot(vx, vy) >= MIN_BREAK_SPEED) {
      game.throws += 1;
    }

    Body.setVelocity(draggedBody, { x: vx, y: vy });
    draggedBody = null;
    dragHistory = [];
  }
}

canvas.addEventListener('mousedown', onPointerDown);
window.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);

canvas.addEventListener('touchstart', onPointerDown, { passive: false });
window.addEventListener('touchmove', onPointerMove, { passive: false });
window.addEventListener('touchend', onPointerUp);

// --- GESTIÓN DE TOGGLE: MODO PINTAR (GIROSCOPIO) O ROMPER (BREAKOUT) ---
const toggleGyro = document.getElementById('toggle-gyro');

let isGyroActive = false;
let targetTilt = { x: 0, y: 0.9 };
let currentTilt = { x: 0, y: 0.9 };
let lastBeta = null;
let lastGamma = null;
let lastOrientTime = 0;
let lastMotionSample = null;
let isVirtualTilting = false;
let virtualTiltStart = { x: 0, y: 0 };
let relaxToastTimeout = null;

// RETO DE PINTAR EN MODO GIROSCOPIO (3 RETOS CONTRARRELOJ)
let relaxChallenge = {
  active: false,
  state: 'idle', // 'idle', 'playing', 'won'
  step: 1, // 1, 2, 3
  targetBody: null,
  targetChar: '',
  targetColor: null, // { name, color, r, g, b }
  stepStartTime: 0,
  stepTimeLimit: 0,
  stepTimes: [0, 0, 0],
  lockedBodies: [],
  score: 0,
};

function showRelaxToast(title, desc) {
  const popup = document.getElementById('relax-popup');
  if (!popup) return;
  const titleEl = popup.querySelector('.diff-level');
  const descEl = popup.querySelector('.diff-sub');
  if (title && titleEl) titleEl.textContent = title;
  if (desc && descEl) descEl.textContent = desc;

  if (relaxToastTimeout) clearTimeout(relaxToastTimeout);
  popup.hidden = false;
  requestAnimationFrame(() => {
    popup.classList.add('visible');
  });
  relaxToastTimeout = setTimeout(() => {
    popup.classList.remove('visible');
    setTimeout(() => {
      popup.hidden = true;
    }, 250);
  }, 3500);
}

function updateFooterHint() {
  const hintEl = document.querySelector('.hint');
  const tickerText = document.querySelector('.ticker-text');
  if (!hintEl) return;
  if (isGyroActive) {
    hintEl.innerHTML = '🎨 <strong>Modo Pintar:</strong> ¡Inclina la pantalla con pulso para pintar las 3 letras!';
    if (tickerText) tickerText.textContent = '✦ RETO PINTAR: INCLINA EL MÓVIL Y LLEVA LA LETRA AL COLOR ✦';
  } else {
    hintEl.textContent = '¡Lanza usando los Papirotes!';
    if (tickerText) tickerText.textContent = '✦ JUEGA HASTA QUE TU MAMI O PAPI TE DEJE ✦';
  }
}

function wakeAllLetters() {
  letterBodies.forEach(b => {
    Matter.Sleeping.set(b, false);
    b.frictionAir = 0.0006;
    b.restitution = 0.86;
    b.friction = 0.018;
    Body.setVelocity(b, {
      x: (Math.random() - 0.5) * 8,
      y: -6 - Math.random() * 4,
    });
  });
}

function startRelaxChallenge() {
  relaxChallenge.active = true;
  relaxChallenge.state = 'playing';
  relaxChallenge.step = 1;
  relaxChallenge.stepTimes = [0, 0, 0];
  relaxChallenge.lockedBodies = [];
  relaxChallenge.score = 0;

  letterBodies.forEach(b => {
    b.isColorLocked = false;
    b.colorContactTimes = { morado: 0, amarillo: 0, verde: 0, azul: 0, rojo: 0 };
    b.currentColorRgb = [255, 255, 255];
  });

  wakeAllLetters();
  startRelaxStep(1);
}

function startRelaxStep(step) {
  relaxChallenge.step = step;

  // Letras disponibles que no hayan sido bloqueadas todavía
  const candidates = letterBodies.filter(b => !relaxChallenge.lockedBodies.includes(b));
  const targetBody = candidates.length > 0
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : letterBodies[Math.floor(Math.random() * letterBodies.length)];

  // Color objetivo de las 5 esferas del pentágono
  const targetColor = COLOR_POINTS[Math.floor(Math.random() * COLOR_POINTS.length)];

  relaxChallenge.targetBody = targetBody;
  relaxChallenge.targetChar = targetBody ? targetBody.char : 'A';
  relaxChallenge.targetColor = targetColor;
  relaxChallenge.stepStartTime = performance.now();

  if (step === 1) {
    relaxChallenge.stepTimeLimit = 0;
    showRelaxToast(
      '🎨 RETO 1 DE 3 · PINTAR',
      `Mueve con cuidado: ¡Pinta la letra "${relaxChallenge.targetChar}" de color ${targetColor.name.toUpperCase()}!`
    );
  } else if (step === 2) {
    relaxChallenge.stepTimeLimit = relaxChallenge.stepTimes[0];
    showRelaxToast(
      '⚡ RETO 2 DE 3 · CONTRARRELOJ',
      `¡Pinta la letra "${relaxChallenge.targetChar}" en ${targetColor.name.toUpperCase()} en menos de ${relaxChallenge.stepTimeLimit.toFixed(1)}s!`
    );
  } else if (step === 3) {
    relaxChallenge.stepTimeLimit = relaxChallenge.stepTimes[1];
    showRelaxToast(
      '🔥 RETO 3 DE 3 · ¡MÁXIMA PRECISIÓN!',
      `¡Pinta la letra "${relaxChallenge.targetChar}" en ${targetColor.name.toUpperCase()} en menos de ${relaxChallenge.stepTimeLimit.toFixed(1)}s!`
    );
  }
}

function updateRelaxChallengeFrame() {
  if (!relaxChallenge.active || relaxChallenge.state !== 'playing') return;
  const now = performance.now();
  const elapsed = (now - relaxChallenge.stepStartTime) / 1000;

  // Opción A: si supera el tiempo en reto 2 o 3, avisar y reiniciar intento de ese reto
  if (relaxChallenge.stepTimeLimit > 0 && elapsed > relaxChallenge.stepTimeLimit) {
    soundManager.playWoodGlassHit(0.6);
    showRelaxToast(
      '⏰ ¡TIEMPO AGOTADO!',
      `Tardaste más de ${relaxChallenge.stepTimeLimit.toFixed(1)}s. ¡Inténtalo de nuevo más rápido!`
    );
    relaxChallenge.stepStartTime = performance.now();
    return;
  }

  // Comprobar si la letra objetivo toca la esfera de color requerida
  if (relaxChallenge.targetBody && relaxChallenge.targetColor) {
    const targetPt = pentagonNodes.find(p => p.name === relaxChallenge.targetColor.name);
    if (targetPt && Matter.Bounds.contains(relaxChallenge.targetBody.bounds, { x: targetPt.x, y: targetPt.y })) {
      onRelaxStepSuccess(elapsed);
    }
  }
}

function onRelaxStepSuccess(elapsed) {
  soundManager.playGlitter();
  const body = relaxChallenge.targetBody;
  const col = relaxChallenge.targetColor;

  if (body) {
    body.isColorLocked = true;
    body.currentColorRgb = [col.r, col.g, col.b];
    if (!relaxChallenge.lockedBodies.includes(body)) {
      relaxChallenge.lockedBodies.push(body);
    }
  }

  const currentStep = relaxChallenge.step;
  relaxChallenge.stepTimes[currentStep - 1] = Math.max(0.1, elapsed);

  if (currentStep < 3) {
    startRelaxStep(currentStep + 1);
  } else {
    // Reto de los 3 bolines superado
    relaxChallenge.state = 'won';
    const t1 = relaxChallenge.stepTimes[0];
    const t2 = relaxChallenge.stepTimes[1];
    const t3 = relaxChallenge.stepTimes[2];
    const totalTime = t1 + t2 + t3;

    const speedBonus = Math.max(0, Math.round((30 - totalTime) * 60));
    const step2Bonus = Math.max(0, Math.round((t1 - t2) * 120));
    const step3Bonus = Math.max(0, Math.round((t2 - t3) * 180));
    relaxChallenge.score = 1200 + speedBonus + step2Bonus + step3Bonus;

    soundManager.playVictory();
    setTimeout(openGameOverModal, 1100);
  }
}

function drawRelaxChallengeHUD(ctx) {
  if (!isGyroActive || !relaxChallenge.active) return;
  const now = performance.now();
  const elapsed = relaxChallenge.state === 'playing' ? Math.max(0, (now - relaxChallenge.stepStartTime) / 1000) : 0;

  ctx.save();
  const hudY = Math.max(105, height * 0.13);

  const col = relaxChallenge.targetColor;
  const colHex = col ? col.color : '#66fcf1';
  const targetChar = relaxChallenge.targetChar || '';
  const step = relaxChallenge.step;

  let timeText = `TIEMPO ${elapsed.toFixed(1)}s`;
  if (relaxChallenge.stepTimeLimit > 0) {
    const remaining = Math.max(0, relaxChallenge.stepTimeLimit - elapsed);
    timeText = `TIEMPO ${elapsed.toFixed(1)}s   ·   LÍMITE ${relaxChallenge.stepTimeLimit.toFixed(1)}s (${remaining.toFixed(1)}s rest.)`;
  }

  // Texto del reto
  ctx.font = `700 ${width <= 640 ? 11 : 13}px 'Space Grotesk', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText(`RETO ${step}/3: PINTA '${targetChar}' EN `, width / 2 - 42, hudY);

  ctx.fillStyle = colHex;
  ctx.shadowColor = colHex;
  ctx.shadowBlur = 8;
  const colorNameUpper = (col ? col.name : '').toUpperCase();
  ctx.fillText(colorNameUpper, width / 2 + 55, hudY);
  ctx.shadowBlur = 0;

  ctx.font = `500 ${width <= 640 ? 10 : 12}px 'Space Grotesk', sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fillText(timeText, width / 2, hudY + 18);

  ctx.restore();

  // Halo sutil pulsante en la letra objetivo
  if (relaxChallenge.targetBody && relaxChallenge.state === 'playing') {
    const tb = relaxChallenge.targetBody;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
    ctx.save();
    ctx.beginPath();
    ctx.arc(tb.position.x, tb.position.y, tb.size * (0.62 + pulse * 0.16), 0, Math.PI * 2);
    ctx.strokeStyle = colHex;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = colHex;
    ctx.shadowBlur = 12 * pulse;
    ctx.stroke();
    ctx.restore();
  }
}

// FÓRMULA DE BOLINES: Aceleración continua por fotograma de plano inclinado + rodamiento angular
function updateRelaxMarblesPhysics(dt) {
  if (!isGyroActive) return;

  const dtNorm = Math.min(2.5, Math.max(0.5, dt / 16.6));
  const lerpFactor = Math.min(1, 0.08 * dtNorm);
  currentTilt.x += (targetTilt.x - currentTilt.x) * lerpFactor;
  currentTilt.y += (targetTilt.y - currentTilt.y) * lerpFactor;

  // Aceleración continua en px/frame: suave y controlable según la inclinación
  const accelPower = 0.30 * dtNorm;
  const maxSpeed = 22;

  for (const b of letterBodies) {
    if (b === draggedBody) continue;
    Matter.Sleeping.set(b, false);

    b.frictionAir = 0.008;
    b.restitution = 0.78;
    b.friction = 0.025;

    let vx = b.velocity.x + currentTilt.x * accelPower;
    let vy = b.velocity.y + currentTilt.y * accelPower;

    const speed = Math.hypot(vx, vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      vx *= scale;
      vy *= scale;
    }

    Body.setVelocity(b, { x: vx, y: vy });

    // Rodamiento angular realista: las bolas giran al rodar
    const radius = Math.max(12, b.size * 0.42);
    Body.setAngularVelocity(b, (vx / radius) * 0.32);
  }
}

function applyTiltDeadzone(value, deadzone = 0.04) {
  return Math.abs(value) < deadzone ? 0 : value;
}

function handleOrientation(e) {
  if (!isGyroActive) return;
  const gamma = e.gamma; // inclinación lateral (-90 a 90)
  const beta = e.beta;   // inclinación adelante/atrás (-180 a 180)
  if (gamma === null || beta === null) return;

  const radGamma = (gamma * Math.PI) / 180;
  const radBeta = (beta * Math.PI) / 180;

  const tx = applyTiltDeadzone(Math.max(-1.0, Math.min(1.0, Math.sin(radGamma) * 1.0)));
  const isFlat = Math.abs(beta) < 20 && Math.abs(gamma) < 70;
  const rawTy = isFlat
    ? Math.sin(radBeta) * 1.0
    : Math.sin(((beta - 32) * Math.PI) / 90) * 1.0;
  const ty = applyTiltDeadzone(Math.max(-1.0, Math.min(1.0, rawTy)));

  targetTilt.x = tx;
  targetTilt.y = ty;

  // Sacudida rápida por giro angular (umbral suavizado para evitar saltos al inclinar despacio)
  const now = performance.now();
  if (lastOrientTime > 0 && lastBeta !== null && lastGamma !== null) {
    const dt = Math.max((now - lastOrientTime) / 1000, 0.012);
    const speedGamma = (gamma - lastGamma) / dt;
    const speedBeta = (beta - lastBeta) / dt;
    const shakeSpeed = Math.hypot(speedGamma, speedBeta);
    if (shakeSpeed > 180) {
      const impulse = Math.min((shakeSpeed - 180) * 0.025, 14);
      const dirX = speedGamma / shakeSpeed;
      const dirY = speedBeta / shakeSpeed;
      letterBodies.forEach(b => {
        if (b === draggedBody) return;
        Body.setVelocity(b, {
          x: b.velocity.x + dirX * impulse * (0.85 + Math.random() * 0.3),
          y: b.velocity.y + dirY * impulse * (0.85 + Math.random() * 0.3),
        });
      });
    }
  }
  lastBeta = beta;
  lastGamma = gamma;
  lastOrientTime = now;
}

// Acelerómetro: detecta sacudidas reales por variación (delta) sin dispararse por la gravedad estática
function handleMotion(e) {
  if (!isGyroActive) return;
  const linearAcc = e.acceleration;
  const fallbackAcc = e.accelerationIncludingGravity;
  const acc = linearAcc || fallbackAcc;
  if (!acc) return;

  const ax = acc.x ?? 0;
  const ay = acc.y ?? 0;
  const az = acc.z ?? 0;

  let dx = ax;
  let dy = ay;
  if (!linearAcc) {
    if (!lastMotionSample) {
      lastMotionSample = { x: ax, y: ay, z: az };
      return;
    }
    dx = ax - lastMotionSample.x;
    dy = ay - lastMotionSample.y;
    lastMotionSample = { x: ax, y: ay, z: az };
  }

  const mag = Math.hypot(dx, dy);
  if (mag > 6.5) {
    const shakePower = Math.min((mag - 6.5) * 0.9, 16);
    const dirX = -dx / (mag || 1);
    const dirY = dy / (mag || 1);
    letterBodies.forEach(b => {
      if (b === draggedBody) return;
      Matter.Sleeping.set(b, false);
      Body.setVelocity(b, {
        x: b.velocity.x + dirX * shakePower * (0.85 + Math.random() * 0.3),
        y: b.velocity.y + dirY * shakePower * (0.85 + Math.random() * 0.3),
      });
    });
  }
}

// Fallback para escritorio: inclina la caja según la posición del ratón
function handleDesktopMouseTilt(e) {
  if (!isGyroActive) return;
  targetTilt.x = (e.clientX / width - 0.5) * 2;
  targetTilt.y = (e.clientY / height - 0.5) * 2;
}

// Sonido al chocar las canicas entre sí en modo relax
Matter.Events.on(engine, 'collisionStart', (event) => {
  if (!isGyroActive) return;
  for (const pair of event.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (a && b && a.char && b.char) {
      const relSpeed = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (relSpeed > 2.0) {
        soundManager.playWoodGlassHit(relSpeed / 16);
        break;
      }
    }
  }
});

async function enableGyro() {
  const onGranted = () => {
    isGyroActive = true;
    targetTilt = { x: 0, y: 0.9 };
    currentTilt = { x: 0, y: 0.9 };
    lastBeta = null;
    lastGamma = null;
    lastOrientTime = 0;
    lastMotionSample = null;
    toggleGyro.classList.add('active');
    toggleGyro.title = 'Modo actual: Pintar (clic para cambiar a Romper)';
    toggleGyro.setAttribute('aria-label', 'Modo actual: Pintar');
    // Modo relax / pintar: quitar ladrillos, suspender juego y cerrar modal de ranking
    bricks = [];
    shards = [];
    pendingBreaks = [];
    game = { state: 'idle', score: 0, startTime: 0, elapsed: 0, throws: 0, lastRank: null };
    closeGameOverModal();

    window.addEventListener('deviceorientation', handleOrientation, true);
    window.addEventListener('devicemotion', handleMotion, true);
    window.addEventListener('mousemove', handleDesktopMouseTilt, true);

    updateFooterHint();
    startRelaxChallenge();
  };

  // En iOS 13+ solicitamos permiso de orientación
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      await DeviceOrientationEvent.requestPermission();
      onGranted();
    } catch (e) {
      console.warn('Permiso giroscopio:', e);
      onGranted();
    }
  } else {
    onGranted();
  }
}

function disableGyro() {
  isGyroActive = false;
  isVirtualTilting = false;
  lastBeta = null;
  lastGamma = null;
  lastOrientTime = 0;
  lastMotionSample = null;
  relaxChallenge.active = false;
  relaxChallenge.state = 'idle';
  window.removeEventListener('deviceorientation', handleOrientation, true);
  window.removeEventListener('devicemotion', handleMotion, true);
  window.removeEventListener('mousemove', handleDesktopMouseTilt, true);
  toggleGyro.classList.remove('active');
  toggleGyro.title = 'Modo actual: Romper (clic para cambiar a Pintar)';
  toggleGyro.setAttribute('aria-label', 'Modo actual: Romper');
  engine.gravity.x = 0;
  engine.gravity.y = 1.25;
  targetTilt = { x: 0, y: 0.9 };
  currentTilt = { x: 0, y: 0.9 };
  letterBodies.forEach(b => {
    b.frictionAir = 0.01;
    b.restitution = 0.28;
    b.friction = 0.5;
    b.isColorLocked = false;
  });
  updateFooterHint();
  startGame(); // Restaura los ladrillos y el juego al salir del modo giroscopio
}

toggleGyro.addEventListener('click', (e) => {
  e.preventDefault();
  if (isGyroActive) {
    disableGyro();
  } else {
    enableGyro();
  }
});

// Modal de Selección Inicial: Pintar o Romper
const modalSelectMode = document.getElementById('modal-select-mode');
const btnChoosePaint = document.getElementById('btn-choose-paint');
const btnChooseBreak = document.getElementById('btn-choose-break');

if (btnChoosePaint) {
  btnChoosePaint.addEventListener('click', () => {
    if (modalSelectMode) modalSelectMode.setAttribute('hidden', '');
    enableGyro();
  });
}

if (btnChooseBreak) {
  btnChooseBreak.addEventListener('click', () => {
    if (modalSelectMode) modalSelectMode.setAttribute('hidden', '');
    disableGyro();
  });
}

// Modal de Rankings desde el selector inicial
const modalRankings = document.getElementById('modal-rankings');
const btnOpenRankings = document.getElementById('btn-open-rankings');
const btnRankingsBack = document.getElementById('btn-rankings-back');
const homeRankingTabs = document.getElementById('home-ranking-tabs');
const homeRankingsPanel = document.getElementById('home-rankings-panel');
const homeRomperLevels = document.getElementById('home-romper-levels');
const homeRankingEmpty = document.getElementById('home-ranking-empty');
const homeRankingList = document.getElementById('home-ranking-list');

let homeRankingGame = 'pintar';
let homeRankingLevel = 1;

function renderHomeRanking(gameMode = homeRankingGame, romperLevel = homeRankingLevel) {
  homeRankingGame = gameMode;
  homeRankingLevel = romperLevel;

  if (homeRankingTabs) {
    homeRankingTabs.querySelectorAll('[role="tab"]').forEach((tab) => {
      const isSelected = tab.dataset.game === gameMode;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
      if (isSelected && homeRankingsPanel) {
        homeRankingsPanel.setAttribute('aria-labelledby', tab.id);
        tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }

  if (homeRomperLevels) {
    homeRomperLevels.hidden = gameMode !== 'romper';
    homeRomperLevels.querySelectorAll('.rank-subtab-btn').forEach((btn) => {
      const isPressed = Number(btn.dataset.level) === romperLevel;
      btn.setAttribute('aria-pressed', String(isPressed));
    });
  }

  const key = gameMode === 'romper' ? romperLevel : gameMode;
  loadAndRenderRanking({
    listEl: homeRankingList,
    emptyEl: homeRankingEmpty,
    emptyText: 'Sin puntuaciones aún en este modo',
    level: key,
    mode: gameMode,
    tokenState: homeRankingToken,
  });
}

function openHomeRankingsModal() {
  if (!modalRankings) return;
  modalSelectMode?.setAttribute('hidden', '');
  modalRankings.removeAttribute('hidden');
  renderHomeRanking();
  const activeTab = homeRankingTabs?.querySelector('[aria-selected="true"]');
  setTimeout(() => activeTab?.focus(), 30);
}

function closeHomeRankingsModal() {
  if (!modalRankings || modalRankings.hasAttribute('hidden')) return;
  modalRankings.setAttribute('hidden', '');
  modalSelectMode?.removeAttribute('hidden');
  btnOpenRankings?.focus();
}

btnOpenRankings?.addEventListener('click', openHomeRankingsModal);
btnRankingsBack?.addEventListener('click', closeHomeRankingsModal);

homeRankingTabs?.addEventListener('click', (e) => {
  const tab = e.target.closest('[role="tab"]');
  if (!tab || !tab.dataset.game) return;
  renderHomeRanking(tab.dataset.game, homeRankingLevel);
});

homeRankingTabs?.addEventListener('keydown', (e) => {
  const tabs = [...homeRankingTabs.querySelectorAll('[role="tab"]')];
  const idx = tabs.indexOf(document.activeElement);
  if (idx === -1) return;

  let nextIdx = -1;
  if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') nextIdx = 0;
  else if (e.key === 'End') nextIdx = tabs.length - 1;
  if (nextIdx === -1) return;

  e.preventDefault();
  const nextTab = tabs[nextIdx];
  renderHomeRanking(nextTab.dataset.game, homeRankingLevel);
  nextTab.focus();
});

homeRomperLevels?.addEventListener('click', (e) => {
  const btn = e.target.closest('.rank-subtab-btn');
  if (!btn) return;
  const lvl = parseInt(btn.dataset.level, 10);
  if (!lvl) return;
  renderHomeRanking('romper', lvl);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalRankings && !modalRankings.hasAttribute('hidden')) {
    e.preventDefault();
    closeHomeRankingsModal();
  }
});

// Reto de cálculo mental: 10 preguntas con cuatro opciones cada una.
const mathModal = document.getElementById('modal-math-game');
const mathProgress = document.getElementById('math-progress');
const mathRecord = document.getElementById('math-record');
const mathQuestion = document.getElementById('math-question');
const mathAnswers = document.getElementById('math-answers');
const mathFeedback = document.getElementById('math-feedback');
const mathNext = document.getElementById('btn-math-next');
const mathFinish = document.getElementById('btn-math-finish');
const btnMathBack = document.getElementById('btn-math-back');
const formMathScore = document.getElementById('form-math-score');
const inputMathPlayerName = document.getElementById('input-math-player-name');
const btnMathSkipScore = document.getElementById('btn-math-skip-score');
const mathRankingBox = document.getElementById('math-ranking-box');
const mathRankingEmpty = document.getElementById('math-ranking-empty');
const mathRankingList = document.getElementById('math-ranking-list');
let mathRound = 0;
let mathScore = 0;
let mathCurrentAnswer = 0;
let mathStartedAt = 0;
let mathLastElapsed = 0;
let mathBest = loadMathBest();
const MATH_BEST_KEY = 'lara_math_best_v1';

function loadMathBest() {
  try {
    const saved = JSON.parse(localStorage.getItem('lara_math_best_v1'));
    return saved && Number.isFinite(saved.score) && Number.isFinite(saved.time) ? saved : null;
  } catch { return null; }
}

function renderMathBest() {
  mathRecord.textContent = mathBest
    ? `Tu mejor marca: ${mathBest.score}/10 · ${mathBest.time.toFixed(1)} s`
    : 'Aún no tienes marca. ¡Esta partida será tu primera aventura!';
}

function makeMathQuestion() {
  // Contenidos habituales de 2.º de Primaria: sumas, restas, series y problemas sencillos.
  const kind = Math.floor(Math.random() * 4);
  if (kind === 2) {
    const start = 2 + Math.floor(Math.random() * 8);
    const step = 2 + Math.floor(Math.random() * 4);
    return { text: `¿Qué número sigue? ${start}, ${start + step}, ${start + step * 2}, ___`, answer: start + step * 3 };
  }
  if (kind === 3) {
    const apples = 8 + Math.floor(Math.random() * 13);
    const given = 2 + Math.floor(Math.random() * Math.min(6, apples - 1));
    return { text: `Hay ${apples} manzanas y regalas ${given}. ¿Cuántas quedan?`, answer: apples - given };
  }
  const operations = ['+', '−'];
  const op = operations[Math.floor(Math.random() * operations.length)];
  let a = 1 + Math.floor(Math.random() * 50);
  let b = 1 + Math.floor(Math.random() * 50);
  if (Math.random() < 0.5) { a = 10 + Math.floor(Math.random() * 80); b = 1 + Math.floor(Math.random() * 9); }
  if (op === '−' && b > a) [a, b] = [b, a];
  const answer = op === '+' ? a + b : op === '−' ? a - b : a * b;
  return { text: `${a} ${op} ${b} = ?`, answer };
}

function showMathQuestion() {
  soundManager.startMathClock();
  mathRound += 1;
  const question = makeMathQuestion();
  mathCurrentAnswer = question.answer;
  mathProgress.textContent = `Pregunta ${mathRound} de 10 · Aciertos: ${mathScore}`;
  mathQuestion.textContent = question.text;
  mathFeedback.textContent = '';
  mathAnswers.replaceChildren();
  const choices = new Set([question.answer]);
  while (choices.size < 4) choices.add(Math.max(0, question.answer + Math.floor(Math.random() * 11) - 5));
  [...choices].sort(() => Math.random() - 0.5).forEach((value) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'math-answer';
    button.textContent = value;
    button.addEventListener('click', () => {
      soundManager.stopMathClock();
      mathAnswers.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      if (value === mathCurrentAnswer) {
        mathScore += 1;
        button.classList.add('correct');
        mathFeedback.textContent = '¡Correcto!';
      } else {
        button.classList.add('incorrect');
        mathFeedback.textContent = `Casi: la respuesta era ${mathCurrentAnswer}.`;
        mathAnswers.querySelectorAll('button').forEach((item) => {
          if (Number(item.textContent) === mathCurrentAnswer) item.classList.add('correct');
        });
      }
      mathProgress.textContent = `Pregunta ${mathRound} de 10 · Aciertos: ${mathScore}`;
      mathNext.hidden = mathRound >= 10;
      if (mathRound >= 10) {
        const elapsed = (performance.now() - mathStartedAt) / 1000;
        mathLastElapsed = elapsed;
        const beatScore = !mathBest || mathScore > mathBest.score;
        const beatTime = mathBest && mathScore >= mathBest.score && elapsed < mathBest.time;
        const newRecord = beatScore || beatTime;
        if (newRecord) {
          mathBest = beatScore
            ? { score: mathScore, time: elapsed }
            : { score: mathBest.score, time: elapsed };
          try { localStorage.setItem(MATH_BEST_KEY, JSON.stringify(mathBest)); } catch { /* El juego sigue aunque el almacenamiento esté desactivado. */ }
        }
        mathProgress.textContent = 'Reto terminado';
        mathQuestion.textContent = `¡Has acertado ${mathScore} de 10!`;
        mathFeedback.textContent = newRecord
          ? '🏅 ¡Has superado tu propia marca! ¡Medalla conseguida!'
          : mathScore === 10 ? '¡Perfecto! ¡Diez respuestas correctas!' : '¡Buen trabajo! Cada partida te ayuda a aprender.';
        mathRecord.textContent = `Tiempo: ${elapsed.toFixed(1)} s · ${mathBest.score}/10 · mejor tiempo ${mathBest.time.toFixed(1)} s`;
        mathAnswers.replaceChildren();
        mathFinish.hidden = true;
        if (btnMathBack) btnMathBack.hidden = true;
        if (mathRankingBox) mathRankingBox.hidden = true;
        if (formMathScore) {
          pendingMathAvatar = null;
          clearFormError(mathSaveError);
          formMathScore.hidden = false;
          selfieManager.start(mathSelfieSlot);
          if (inputMathPlayerName) {
            inputMathPlayerName.value = '';
            setTimeout(() => inputMathPlayerName.focus(), 60);
          }
        } else {
          mathFinish.hidden = false;
          if (btnMathBack) btnMathBack.hidden = false;
        }
      }
    });
    mathAnswers.appendChild(button);
  });
  mathNext.hidden = true;
  mathFinish.hidden = true;
}

function startMathChallenge() {
  selfieManager.stop();
  pendingMathAvatar = null;
  clearFormError(mathSaveError);
  mathRound = 0;
  mathScore = 0;
  mathLastElapsed = 0;
  mathStartedAt = performance.now();
  if (formMathScore) formMathScore.hidden = true;
  if (mathRankingBox) mathRankingBox.hidden = true;
  if (btnMathBack) btnMathBack.hidden = false;
  renderMathBest();
  showMathQuestion();
}

function showMathRanking(highlightId = null, preloadedList = null) {
  selfieManager.stop();
  pendingMathAvatar = null;
  clearFormError(mathSaveError);
  if (formMathScore) formMathScore.hidden = true;
  if (mathRankingBox) mathRankingBox.hidden = false;
  if (btnMathBack) btnMathBack.hidden = false;
  mathFinish.hidden = false;
  if (preloadedList) {
    if (mathRankingEmpty) mathRankingEmpty.textContent = 'Sin puntuaciones aún en Mates';
    renderRankingList(mathRankingList, mathRankingEmpty, preloadedList, highlightId, 'mates');
    return;
  }
  loadAndRenderRanking({
    listEl: mathRankingList,
    emptyEl: mathRankingEmpty,
    emptyText: 'Sin puntuaciones aún en Mates',
    level: 'mates',
    mode: 'mates',
    highlightId,
    tokenState: mathRankingToken,
  });
}

formMathScore?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = inputMathPlayerName?.value.trim().toUpperCase();
  if (!name) return;

  clearFormError(mathSaveError);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    showFormError(mathSaveError, 'No puedo guardar sin conexión!');
    return;
  }

  if (!pendingMathAvatar) {
    pendingMathAvatar = selfieManager.capture();
  }

  const submitBtn = formMathScore.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';
  }

  try {
    const { id, list } = await saveRankingEntry('mates', {
      name,
      score: mathScore,
      time: mathLastElapsed,
      avatar: pendingMathAvatar,
    });
    showMathRanking(id, list);
  } catch (err) {
    console.warn('Error al guardar en Firestore (Mates):', err);
    showFormError(mathSaveError, 'No puedo guardar sin conexión!');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar';
    }
  }
});

btnMathSkipScore?.addEventListener('click', () => {
  showMathRanking(null);
});

document.getElementById('btn-choose-math')?.addEventListener('click', () => {
  modalSelectMode?.setAttribute('hidden', '');
  mathModal?.removeAttribute('hidden');
  startMathChallenge();
});
mathNext?.addEventListener('click', showMathQuestion);
mathFinish?.addEventListener('click', startMathChallenge);
btnMathBack?.addEventListener('click', () => {
  selfieManager.stop();
  pendingMathAvatar = null;
  clearFormError(mathSaveError);
  soundManager.stopMathClock();
  mathModal?.setAttribute('hidden', '');
  modalSelectMode?.removeAttribute('hidden');
});

// Renderizado y control dinámico de botones de palabras
const wordsCluster = document.getElementById('words-cluster');

function renderWordButtons() {
  if (!wordsCluster) return;
  wordsCluster.innerHTML = '';
  wordsList.forEach((wordItem) => {
    const btn = document.createElement('button');
    btn.className = `word-toggle-btn ${wordItem.active ? 'active' : ''}`;
    btn.textContent = wordItem.text;
    btn.title = `Activar / desactivar ${wordItem.text}`;
    btn.setAttribute('aria-label', `Letras ${wordItem.text}`);
    btn.addEventListener('click', () => {
      toggleWord(wordItem.id);
    });
    wordsCluster.appendChild(btn);
  });
}

function toggleWord(wordId) {
  const target = wordsList.find((w) => w.id === wordId);
  if (!target) return;

  if (target.active) {
    const otherActive = wordsList.some((w) => w.id !== wordId && w.active);
    if (otherActive) {
      target.active = false;
    }
  } else {
    target.active = true;
  }

  saveWords();
  renderWordButtons();
  showDifficultyToast();
  startFallingSequence();
}

function addNewWord(name) {
  const cleanName = name.trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
  if (!cleanName) return;

  const existing = wordsList.find((w) => w.text === cleanName);
  if (existing) {
    existing.active = true;
  } else {
    wordsList.push({
      id: `word-${Date.now()}`,
      text: cleanName,
      active: true,
    });
  }

  saveWords();
  renderWordButtons();
  showDifficultyToast();
  startFallingSequence();
}

// Modal para crear nuevo nombre
const modalAddWord = document.getElementById('modal-add-word');
const btnAddWord = document.getElementById('btn-add-word');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');
const formAddWord = document.getElementById('form-add-word');
const inputWordName = document.getElementById('input-word-name');

function openAddWordModal() {
  if (!modalAddWord) return;
  modalAddWord.removeAttribute('hidden');
  inputWordName.value = '';
  setTimeout(() => inputWordName.focus(), 60);
}

function closeAddWordModal() {
  if (!modalAddWord) return;
  modalAddWord.setAttribute('hidden', '');
  inputWordName.blur();
}

if (btnAddWord) btnAddWord.addEventListener('click', openAddWordModal);
if (btnCloseModal) btnCloseModal.addEventListener('click', closeAddWordModal);
if (btnCancelModal) btnCancelModal.addEventListener('click', closeAddWordModal);

if (modalAddWord) {
  modalAddWord.addEventListener('click', (e) => {
    if (e.target === modalAddWord) {
      closeAddWordModal();
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalAddWord && !modalAddWord.hasAttribute('hidden')) {
    closeAddWordModal();
  }
});

if (formAddWord) {
  formAddWord.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = inputWordName.value;
    if (val && val.trim()) {
      addNewWord(val);
      closeAddWordModal();
    }
  });
}

// Inicializar botones en cabecera
renderWordButtons();
if (import.meta.env.PROD) injectVercelAnalytics({ mode: 'production' });

// Botón Replay
document.getElementById('btn-replay').addEventListener('click', () => {
  if (isGyroActive) {
    startRelaxChallenge();
  } else {
    startFallingSequence();
  }
});

// Resize responsivo
window.addEventListener('resize', () => {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
  initFloorMesh();
  initPentagonPoints(false);
  Body.setPosition(floorBody, { x: width / 2, y: height + 150 });
  Body.setPosition(rightWall, { x: width + 20, y: height / 2 });
  relayoutBricks();
});

// Inicio
startFallingSequence();
render();
