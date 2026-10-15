import Matter from 'matter-js';
import { soundManager } from './audioManager.js';
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
  springK: 0.15,  // rigidez elástica más suave: la cuerda se hunde y rebota más
  damping: 0.87,  // menor amortiguación: oscila varias veces antes de asentarse
  spread: 0.16,   // propagación localizada
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
  const radius = width * 0.18;
  for (let node of lineNodes) {
    const dist = Math.abs(node.x - impactX);
    if (dist < radius) {
      const factor = Math.cos((dist / radius) * (Math.PI / 2));
      node.vy += force * factor;
    }
  }
}

// --- JUEGO TIPO ARKANOID: BLOQUES CON LETRA ---
const RANKING_BASE_KEY = 'lara_arkanoid_ranking';
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

function getRankingKey(level = getCurrentLevel()) {
  return `${RANKING_BASE_KEY}_lvl_${level}`;
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

function loadRanking(level = getCurrentLevel()) {
  try {
    const key = getRankingKey(level);
    const parsed = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(parsed)) return parsed;
    // Migración retrocompatible si nivel 1
    if (level === 1) {
      const legacy = JSON.parse(localStorage.getItem(RANKING_BASE_KEY));
      if (Array.isArray(legacy)) return legacy;
    }
  } catch (e) {
    console.warn('Error al leer ranking:', e);
  }
  return [];
}

function saveRanking(list, level = getCurrentLevel()) {
  try {
    localStorage.setItem(getRankingKey(level), JSON.stringify(list));
  } catch (e) {
    console.warn('Error al guardar ranking:', e);
  }
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

let currentRankingTab = 1;

function updateRankingTabsUI(selectedLevel) {
  if (!rankingTabs) return;
  const tabButtons = rankingTabs.querySelectorAll('.rank-tab-btn');
  tabButtons.forEach((btn) => {
    const lvl = parseInt(btn.getAttribute('data-level'), 10);
    btn.classList.toggle('active', lvl === selectedLevel);
  });
}

function openGameOverModal() {
  if (game.state !== 'finished') return;
  const lvl = game.level || getCurrentLevel();
  if (goTitle) goTitle.textContent = `¡NIVEL ${lvl} COMPLETADO!`;
  const extraSaved = game.bonusTimeSaved ? `, extra -${game.bonusTimeSaved}s` : '';
  goSummary.textContent = `${game.score} puntos · ${game.elapsed.toFixed(1)}s · ${game.throws} lanzamientos (bonus tiempo +${game.timeBonus || 0}${extraSaved}, bonus lanzamientos +${game.throwBonus || 0})`;
  formScore.hidden = false;
  rankingBox.hidden = true;
  inputPlayerName.value = '';
  modalGameOver.removeAttribute('hidden');
  setTimeout(() => inputPlayerName.focus(), 60);
}

function closeGameOverModal() {
  if (!modalGameOver) return;
  modalGameOver.setAttribute('hidden', '');
  inputPlayerName.blur();
}

function renderRanking(list, highlightId, selectedLevel = currentRankingTab) {
  currentRankingTab = selectedLevel;
  updateRankingTabsUI(selectedLevel);
  rankingList.innerHTML = '';
  if (list.length === 0) {
    if (rankingEmpty) rankingEmpty.removeAttribute('hidden');
  } else {
    if (rankingEmpty) rankingEmpty.setAttribute('hidden', '');
    list.slice(0, 10).forEach((entry, i) => {
      const li = document.createElement('li');
      if (entry.id === highlightId) li.className = 'me';
      const pos = document.createElement('span');
      pos.textContent = `${i + 1}.`;
      const name = document.createElement('span');
      name.textContent = entry.name;
      const pts = document.createElement('span');
      pts.textContent = entry.score;
      li.append(pos, name, pts);
      rankingList.appendChild(li);
    });
  }
}

if (rankingTabs) {
  rankingTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.rank-tab-btn');
    if (!btn) return;
    const lvl = parseInt(btn.getAttribute('data-level'), 10);
    if (!lvl) return;
    const list = loadRanking(lvl);
    renderRanking(list, null, lvl);
  });
}

formScore.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = inputPlayerName.value.trim().toUpperCase();
  if (!name || game.state !== 'finished') return;

  const lvl = game.level || getCurrentLevel();
  const entry = { id: `s-${Date.now()}`, name, score: game.score, time: game.elapsed };
  const list = loadRanking(lvl);
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.time - b.time);
  const trimmed = list.slice(0, 50);
  saveRanking(trimmed, lvl);

  formScore.hidden = true;
  renderRanking(trimmed, entry.id, lvl);
  rankingBox.hidden = false;
});

btnPlayAgain.addEventListener('click', () => {
  startFallingSequence();
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
  const maxSpeed = isGyroActive ? 42 : 28;
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
        perturbLine(bodyX, Math.min(body.velocity.y * 1.4 + penetration * 0.2, 34));

        // Rebote elástico
        Body.setVelocity(body, {
          x: body.velocity.x * 0.9,
          y: -Math.min(body.velocity.y * 0.55, 12),
        });
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

// Update de la Cuerda Elástica (Ecuación de onda con amortiguación crítica y reposo inamovible)
function updateFloorMesh() {
  let hasEnergy = false;

  for (let node of lineNodes) {
    const dy = node.targetY - node.y;

    // Corte estricto de reposo: si la oscilación es minúscula, bloquear a 0
    if (Math.abs(dy) < 0.35 && Math.abs(node.vy) < 0.15) {
      node.y = node.targetY;
      node.vy = 0;
      continue;
    }

    hasEnergy = true;
    const springForce = dy * CONFIG.springK;
    node.vy += springForce;
    node.vy *= CONFIG.damping;
    node.y += node.vy;
  }

  // Si no hay perturbaciones activas, reposo total: cero vibración parásita
  if (!hasEnergy) return;

  leftDeltas.fill(0);
  rightDeltas.fill(0);

  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < lineNodes.length; i++) {
      if (i > 0) {
        leftDeltas[i] = CONFIG.spread * (lineNodes[i].y - lineNodes[i - 1].y);
        lineNodes[i - 1].vy += leftDeltas[i];
      }
      if (i < lineNodes.length - 1) {
        rightDeltas[i] = CONFIG.spread * (lineNodes[i].y - lineNodes[i + 1].y);
        lineNodes[i + 1].vy += rightDeltas[i];
      }
    }
    for (let i = 0; i < lineNodes.length; i++) {
      if (i > 0) lineNodes[i - 1].y += leftDeltas[i];
      if (i < lineNodes.length - 1) lineNodes[i + 1].y += rightDeltas[i];
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
    updateSpecialBrick(dt, currentTime);
    processBrickHits();
    processPendingBreaks();
    processAcousticVibrations();
    updateTrampolinePhysics();
    updateFloorMesh();

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
      break;
    }
  }
}

function onPointerMove(e) {
  if (!draggedBody) return;
  if (e.cancelable && e.type && e.type.startsWith('touch')) {
    e.preventDefault();
  }

  const pos = getPointerPos(e);
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;

  const now = performance.now();
  const halfH = draggedBody.size / 2;
  const rawX = pos.x - dragOffset.x;
  const rawY = pos.y - dragOffset.y;

  // Registrar trayectoria para inercia de lanzamiento
  dragHistory.push({ x: rawX, y: rawY, t: now });
  if (dragHistory.length > 5) dragHistory.shift();

  // Si se intenta arrastrar la letra hacia arriba desde la zona de lanzamiento,
  // pierde el agarre a los 50px de subida para que los papirotes cojan velocidad sin subir pegada al ladrillo
  if (!isGyroActive && (dragStartY - pos.y) >= 50) {
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
}

function onPointerUp() {
  if (draggedBody) {
    let vx = 0;
    let vy = 0;
    if (dragHistory.length >= 2) {
      const first = dragHistory[0];
      const last = dragHistory[dragHistory.length - 1];
      const dt = Math.max(last.t - first.t, 16);
      vx = ((last.x - first.x) / dt) * 16;
      vy = ((last.y - first.y) / dt) * 16;
    }

    const maxSpeed = 24;
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

// --- GESTIÓN DE TOGGLES: GIROSCOPIO Y MICRÓFONO ---
const toggleGyro = document.getElementById('toggle-gyro');
const toggleMic = document.getElementById('toggle-mic');

let isGyroActive = false;
let isMicActive = false;

// 1. LÓGICA TOGGLE GIROSCOPIO: MODO CAJA DE BOLAS (RELAX & FÍSICA VIVA)
let lastBeta = null;
let lastGamma = null;
let lastOrientTime = 0;

function wakeAllLetters() {
  letterBodies.forEach(b => {
    Matter.Sleeping.set(b, false);
    b.frictionAir = 0.0012; // Mínima resistencia: se mueven ágiles como bolas libres
    b.restitution = 0.82;   // Rebote elástico vivo como canicas de cristal
    b.friction = 0.12;      // Rodamiento libre
    Body.setVelocity(b, {
      x: b.velocity.x + (Math.random() - 0.5) * 0.8,
      y: b.velocity.y - 0.5,
    });
  });
}

function handleOrientation(e) {
  if (!isGyroActive) return;
  if (e.gamma !== null && e.beta !== null) {
    const beta = e.beta;   // inclinación adelante/atrás (-180 a 180)
    const gamma = e.gamma; // inclinación lateral (-90 a 90)

    // Inclinación suave: van cogiendo aceleración continua en la dirección de la caja
    const gx = Math.sin((gamma * Math.PI) / 180) * 3.6;
    const gy = Math.sin(((beta - 12) * Math.PI) / 180) * 3.4;

    engine.gravity.x = Math.max(-3.5, Math.min(3.5, gx));
    engine.gravity.y = Math.max(-3.5, Math.min(3.5, gy));

    // Propiedades de canicas de cristal en caja de madera: mínimo rozamiento y rebote elástico
    letterBodies.forEach(b => {
      Matter.Sleeping.set(b, false);
      b.frictionAir = 0.0012;
      b.restitution = 0.82;
      b.friction = 0.12;
    });

    // Detección de sacudida rápida por giro angular
    const now = performance.now();
    if (lastOrientTime > 0) {
      const dt = Math.max((now - lastOrientTime) / 1000, 0.008);
      const speedGamma = (gamma - lastGamma) / dt;
      const speedBeta = (beta - lastBeta) / dt;
      const angularSpeed = Math.hypot(speedGamma, speedBeta);
      if (angularSpeed > 160) {
        const impulse = Math.min((angularSpeed - 160) * 0.018, 18);
        const dirX = speedGamma / angularSpeed;
        const dirY = speedBeta / angularSpeed;
        letterBodies.forEach(b => {
          Matter.Sleeping.set(b, false);
          Body.setVelocity(b, {
            x: b.velocity.x + dirX * impulse * (0.8 + Math.random() * 0.4),
            y: b.velocity.y + dirY * impulse * (0.8 + Math.random() * 0.4),
          });
        });
      }
    }
    lastBeta = beta;
    lastGamma = gamma;
    lastOrientTime = now;
  }
}

// Acelerómetro: respuesta inmediata cuando se agita el móvil
function handleMotion(e) {
  if (!isGyroActive) return;
  const acc = e.acceleration || e.accelerationIncludingGravity;
  if (!acc) return;
  const ax = acc.x ?? 0;
  const ay = acc.y ?? 0;
  const mag = Math.hypot(ax, ay);
  if (mag > 4.2) {
    // Al agitar, se mueven inmediatamente como bolas a la velocidad de la sacudida
    const shakePower = Math.min((mag - 4.2) * 0.72, 18);
    const dirX = -ax / (mag || 1);
    const dirY = ay / (mag || 1);
    letterBodies.forEach(b => {
      Matter.Sleeping.set(b, false);
      Body.setVelocity(b, {
        x: b.velocity.x + dirX * shakePower * (0.85 + Math.random() * 0.3),
        y: b.velocity.y + dirY * shakePower * (0.85 + Math.random() * 0.3),
      });
    });
  }
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
    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);
    isGyroActive = true;
    toggleGyro.classList.add('active');
    wakeAllLetters();
    // Modo relax: quitar ladrillos, suspender juego y cerrar modal de ranking
    bricks = [];
    shards = [];
    pendingBreaks = [];
    game = { state: 'idle', score: 0, startTime: 0, elapsed: 0, throws: 0, lastRank: null };
    closeGameOverModal();
  };

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      if (permissionState === 'granted') {
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
          try { await DeviceMotionEvent.requestPermission(); } catch (_) {}
        }
        onGranted();
      }
    } catch (e) {
      console.warn('Permiso giroscopio denegado:', e);
    }
  } else if (typeof DeviceOrientationEvent !== 'undefined' || 'ondeviceorientation' in window) {
    onGranted();
  }
}

function disableGyro() {
  isGyroActive = false;
  window.removeEventListener('deviceorientation', handleOrientation);
  window.removeEventListener('devicemotion', handleMotion);
  toggleGyro.classList.remove('active');
  engine.gravity.x = 0;
  engine.gravity.y = 1.25;
  letterBodies.forEach(b => {
    b.frictionAir = 0.01;
    b.restitution = 0.28;
    b.friction = 0.5;
  });
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

// 2. LÓGICA TOGGLE MICRÓFONO
let audioCtx = null;
let analyser = null;
let audioData = null;
let micStream = null;

async function enableMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);

    audioData = new Uint8Array(analyser.frequencyBinCount);
    isMicActive = true;
    toggleMic.classList.add('active');
  } catch (err) {
    console.error('Error al acceder al micrófono:', err);
    alert('No se pudo acceder al micrófono. Revisa los permisos.');
  }
}

function disableMic() {
  isMicActive = false;
  toggleMic.classList.remove('active');
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close();
    audioCtx = null;
  }
  analyser = null;
  audioData = null;
}

toggleMic.addEventListener('click', () => {
  if (isMicActive) {
    disableMic();
  } else {
    enableMic();
  }
});

// Soplido acústico tipo "diente de león"
function processAcousticVibrations() {
  if (!isMicActive || !analyser || !audioData) return;
  analyser.getByteFrequencyData(audioData);

  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i];
  }
  const averageVolume = sum / audioData.length;

  if (averageVolume > 14) {
    const blowIntensity = Math.min((averageVolume - 14) / 75, 1.0);

    letterBodies.forEach((body, idx) => {
      const liftForce = -0.007 * blowIntensity * (body.mass || 1);
      const flutterTime = Date.now() * 0.004 + idx * 1.5;
      const lateralFlutter = Math.sin(flutterTime) * 0.0025 * blowIntensity * (body.mass || 1);
      const torqueFlutter = Math.cos(flutterTime * 1.2) * 0.0008 * blowIntensity;

      Body.applyForce(body, body.position, {
        x: lateralFlutter,
        y: liftForce,
      });

      body.torque += torqueFlutter;
    });

    const windWave = blowIntensity * 3.5;
    for (let i = 0; i < lineNodes.length; i++) {
      const wave = Math.sin(Date.now() * 0.008 + i * 0.3) * windWave;
      lineNodes[i].vy += wave * 0.3;
    }
  }
}

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

// Botón Replay
document.getElementById('btn-replay').addEventListener('click', () => {
  startFallingSequence();
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
