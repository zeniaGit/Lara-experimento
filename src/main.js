import Matter from 'matter-js';

// --- CONFIGURACIÓN & PARÁMETROS FÍSICOS (CRITICAL DAMPING) ---
const CONFIG = {
  letters: ['L', 'A', 'R', 'A'],
  fontFamily: 'Cinzel',
  dropDelay: 650, // ms entre caída de cada letra
  linePoints: 80, // resolución de la malla elástica
  springK: 0.24,  // alta rigidez elástica para firmeza inmediata
  damping: 0.76,  // amortiguación crítica: absorbe la onda en 2-3 oscilaciones rápidas
  spread: 0.16,   // propagación localizada
};

// Canvas Setup
const canvas = document.getElementById('gravity-canvas');
const ctx = canvas.getContext('2d');
let width = (canvas.width = window.innerWidth);
let height = (canvas.height = window.innerHeight);

// Matter.js Modules
const { Engine, World, Bodies, Body, Vector } = Matter;

const engine = Engine.create({
  gravity: { x: 0, y: 1.25, scale: 0.001 },
});
const world = engine.world;

// Estado de la línea elástica del suelo (Espacio-Tiempo)
let floorY = height * 0.84;
let lineNodes = [];

function initFloorMesh() {
  floorY = height * 0.84;
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

// --- PUNTOS EN PENTÁGONO CON 5 COLORES ---
const COLOR_POINTS = [
  { name: 'morado', color: '#a55eea', r: 165, g: 94, b: 234 },
  { name: 'amarillo', color: '#fed330', r: 254, g: 211, b: 48 },
  { name: 'verde', color: '#26de81', r: 38, g: 222, b: 129 },
  { name: 'azul', color: '#45aaf2', r: 69, g: 170, b: 242 },
  { name: 'rojo', color: '#fc5c65', r: 252, g: 92, b: 101 },
];

let pentagonNodes = [];

function initPentagonPoints() {
  pentagonNodes = [];
  const centerX = width / 2;
  const centerY = height * 0.48;
  const radius = Math.min(width, height) * 0.27;

  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
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
initPentagonPoints();

// Dimensiones de letra responsivas
function getLetterSize() {
  const minDim = Math.min(width, height);
  return Math.max(70, Math.min(150, minDim * 0.18));
}

// Spawner de Letras
function spawnLetter(char, index) {
  const size = getLetterSize();
  const totalLetters = CONFIG.letters.length;
  const spacing = size * 1.05;
  const startX = width / 2 - ((totalLetters - 1) * spacing) / 2 + index * spacing;
  const startY = -size;

  const body = Bodies.rectangle(startX, startY, size * 0.85, size, {
    restitution: 0.28,
    friction: 0.5,
    density: 0.003,
    angle: (Math.random() - 0.5) * 0.1,
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

// Secuencia de Caída
function startFallingSequence() {
  for (let b of letterBodies) {
    World.remove(world, b);
  }
  letterBodies = [];

  CONFIG.letters.forEach((char, i) => {
    setTimeout(() => {
      spawnLetter(char, i);
    }, i * CONFIG.dropDelay);
  });
}

// Detección e interacción elástica firme (Solver de impacto & contacto estricto)
function updateTrampolinePhysics() {
  const lineSpacing = width / (CONFIG.linePoints - 1);

  for (let body of letterBodies) {
    if (body === draggedBody) continue;

    // Altura visual real de la letra (baseline offset tipográfico de Cinzel: ~0.42 * size)
    const baseContactRadius = body.size * 0.42;
    const letterFootY = body.position.y + baseContactRadius;
    const bodyX = body.position.x;

    const nodeIndex = Math.min(
      Math.max(0, Math.round(bodyX / lineSpacing)),
      lineNodes.length - 1
    );
    const node = lineNodes[nodeIndex];

    // Contacto físico estricto con la cuerda
    if (letterFootY >= node.y) {
      const penetration = letterFootY - node.y;

      // Fase de Impacto dinámico
      if (body.velocity.y > 1.2) {
        // Deformación controlada y firme de la línea
        perturbLine(bodyX, Math.min(body.velocity.y * 1.1 + penetration * 0.15, 25));

        // Rebote elástico reactivo
        Body.setVelocity(body, {
          x: body.velocity.x * 0.9,
          y: -Math.min(body.velocity.y * 0.4, 8),
        });
      } else {
        // Fase de Reposo: Contacto perfecto sin holgura (la base de la letra toca exactamente la línea)
        Body.setPosition(body, {
          x: body.position.x,
          y: node.y - baseContactRadius,
        });

        // Nivelar ángulo en reposo para que las letras queden erguidas y estables
        Body.setAngle(body, body.angle * 0.88);
        Body.setAngularVelocity(body, 0);

        // Cancelar velocidad vertical residual para reposo absoluto
        if (Math.abs(body.velocity.y) < 1.2) {
          Body.setVelocity(body, {
            x: body.velocity.x * 0.92,
            y: 0,
          });
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

  const leftDeltas = new Float32Array(lineNodes.length);
  const rightDeltas = new Float32Array(lineNodes.length);

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

// LOOP DE RENDERIZADO
function render() {
  Engine.update(engine, 1000 / 60);
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
    for (let pt of pentagonNodes) {
      if (Matter.Bounds.contains(body.bounds, { x: pt.x, y: pt.y })) {
        body.colorContactTimes[pt.name] = (body.colorContactTimes[pt.name] || 0) + 1;
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
      const targetColor = COLOR_POINTS.find(c => c.name === dominantColorName);
      if (targetColor) {
        const lerpFactor = 0.08;
        body.currentColorRgb[0] += (targetColor.r - body.currentColorRgb[0]) * lerpFactor;
        body.currentColorRgb[1] += (targetColor.g - body.currentColorRgb[1]) * lerpFactor;
        body.currentColorRgb[2] += (targetColor.b - body.currentColorRgb[2]) * lerpFactor;
      }
    }
  }

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

    const [cr, cg, cb] = body.currentColorRgb.map(Math.round);
    ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;

    if (cr !== 255 || cg !== 255 || cb !== 255) {
      ctx.shadowColor = `rgb(${cr}, ${cg}, ${cb})`;
      ctx.shadowBlur = 14;
    }
    ctx.fillText(body.char, 0, 0);

    ctx.restore();
  }

  requestAnimationFrame(render);
}

// INTERACCIÓN: ARRASTRE Y LANZAMIENTO (Mouse & Touch)
let draggedBody = null;
let dragOffset = { x: 0, y: 0 };
let dragHistory = [];

function getPointerPos(e) {
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: clientX, y: clientY };
}

function onPointerDown(e) {
  const pos = getPointerPos(e);
  for (let body of letterBodies) {
    if (Matter.Bounds.contains(body.bounds, pos)) {
      draggedBody = body;
      Body.setStatic(draggedBody, true);
      dragOffset = { x: pos.x - body.position.x, y: pos.y - body.position.y };
      dragHistory = [{ x: pos.x, y: pos.y, t: performance.now() }];
      break;
    }
  }
}

function onPointerMove(e) {
  if (!draggedBody) return;
  const pos = getPointerPos(e);
  const halfH = draggedBody.size / 2;
  const clampedY = Math.max(halfH, pos.y - dragOffset.y);
  Body.setPosition(draggedBody, {
    x: pos.x - dragOffset.x,
    y: clampedY,
  });

  const now = performance.now();
  dragHistory.push({ x: pos.x, y: pos.y, t: now });
  if (dragHistory.length > 5) dragHistory.shift();
}

function onPointerUp() {
  if (draggedBody) {
    Body.setStatic(draggedBody, false);

    let vx = 0;
    let vy = 1;
    if (dragHistory.length >= 2) {
      const first = dragHistory[0];
      const last = dragHistory[dragHistory.length - 1];
      const dt = Math.max(last.t - first.t, 16);
      vx = ((last.x - first.x) / dt) * 18;
      vy = ((last.y - first.y) / dt) * 18;
    }

    const maxSpeed = 30;
    vx = Math.max(-maxSpeed, Math.min(maxSpeed, vx));
    vy = Math.max(-maxSpeed, Math.min(maxSpeed, vy));

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

// 1. LÓGICA TOGGLE GIROSCOPIO: MODO MESA (GOTAS DERRAMADAS) VS MODO LEVANTADO
let isTableFlatMode = false;

function handleOrientation(e) {
  if (!isGyroActive) return;
  if (e.gamma !== null && e.beta !== null) {
    const beta = e.beta;   // inclinación adelante/atrás (-180 a 180)
    const gamma = e.gamma; // inclinación lateral (-90 a 90)

    // Detectar si el móvil está plano sobre la mesa (beta cerca de 0°, +- 16°)
    const isFlat = Math.abs(beta) < 18 && Math.abs(gamma) < 70;

    if (isFlat) {
      // MODO MESA: Las letras se comportan como gotas de agua deslizándose por la superficie plana
      // La gravedad se convierte en un plano 2D directo (X e Y se derraman según el más mínimo desnivel)
      isTableFlatMode = true;

      // Sensibilidad fina y fluida tipo canica / gota de agua
      const spillX = Math.sin((gamma * Math.PI) / 180) * 2.2;
      const spillY = Math.sin((beta * Math.PI) / 180) * 2.2;

      engine.gravity.x = Math.max(-2.5, Math.min(2.5, spillX));
      engine.gravity.y = Math.max(-2.5, Math.min(2.5, spillY));

      // Reducir fricción temporal para que se deslicen suavemente como gotas
      letterBodies.forEach(b => {
        b.frictionAir = 0.015;
      });
    } else {
      // MODO LEVANTADO: Se recupera la configuración física habitual
      isTableFlatMode = false;

      // Inclinación lateral habitual
      const gx = Math.sin((gamma * Math.PI) / 180) * 2.0;

      // Con el móvil levantado (beta > 20°), gravedad natural firme hacia la línea inferior
      // Si se inclina hacia atrás o se voltea boca abajo, se invierte
      const betaNorm = (beta - 18) / 45;
      const gy = Math.max(-2.5, Math.min(2.5, betaNorm * 1.6));

      engine.gravity.x = Math.max(-2.2, Math.min(2.2, gx));
      engine.gravity.y = gy;

      letterBodies.forEach(b => {
        b.frictionAir = 0.01;
      });
    }
  }
}

async function enableGyro() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      if (permissionState === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation);
        isGyroActive = true;
        toggleGyro.classList.add('active');
      }
    } catch (e) {
      console.warn('Permiso giroscopio denegado:', e);
    }
  } else if ('ondeviceorientation' in window) {
    window.addEventListener('deviceorientation', handleOrientation);
    isGyroActive = true;
    toggleGyro.classList.add('active');
  }
}

function disableGyro() {
  isGyroActive = false;
  toggleGyro.classList.remove('active');
  engine.gravity.x = 0;
  engine.gravity.y = 1.25;
}

toggleGyro.addEventListener('click', () => {
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

// Botón Replay
document.getElementById('btn-replay').addEventListener('click', () => {
  startFallingSequence();
});

// Resize responsivo
window.addEventListener('resize', () => {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
  initFloorMesh();
  initPentagonPoints();
  Body.setPosition(floorBody, { x: width / 2, y: height + 150 });
  Body.setPosition(rightWall, { x: width + 20, y: height / 2 });
});

// Inicio
startFallingSequence();
render();
