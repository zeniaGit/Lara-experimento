// Geometría pura del disparo: sin estado, sin DOM. La guía visual, el proyectil
// y el cálculo de letras disponibles usan exactamente este mismo recorrido.

export const MAX_ANGLE = 70 * Math.PI / 180;
const EPSILON = 1e-7;
const SAMPLE_STEPS = 280; // resolución del barrido de ángulos en availableLetters

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function clampAngle(angle) {
  return clamp(angle, -MAX_ANGLE, MAX_ANGLE);
}

function brickEdges(brick) {
  return {
    left: brick.x - brick.w / 2,
    right: brick.x + brick.w / 2,
    top: brick.y - brick.h / 2,
    bottom: brick.y + brick.h / 2,
  };
}

function overlapsAtStart(origin, radius, { left, right, top, bottom }) {
  const nearestX = clamp(origin.x, left, right);
  const nearestY = clamp(origin.y, top, bottom);
  return Math.hypot(origin.x - nearestX, origin.y - nearestY) <= radius;
}

// Caras: el centro del círculo choca con la cara desplazada `radius` hacia fuera.
function sweepFaces(origin, direction, radius, { left, right, top, bottom }, accept) {
  if (Math.abs(direction.x) > EPSILON) {
    for (const x of [left - radius, right + radius]) {
      const distance = (x - origin.x) / direction.x;
      const y = origin.y + direction.y * distance;
      if (y >= top && y <= bottom) accept(distance);
    }
  }
  if (Math.abs(direction.y) > EPSILON) {
    for (const y of [top - radius, bottom + radius]) {
      const distance = (y - origin.y) / direction.y;
      const x = origin.x + direction.x * distance;
      if (x >= left && x <= right) accept(distance);
    }
  }
}

// Esquinas: intersección rayo/círculo de radio `radius` centrado en cada vértice.
function sweepCorners(origin, direction, radius, { left, right, top, bottom }, accept) {
  for (const [x, y] of [[left, top], [right, top], [left, bottom], [right, bottom]]) {
    const dx = origin.x - x;
    const dy = origin.y - y;
    const projection = dx * direction.x + dy * direction.y;
    const discriminant = projection * projection - (dx * dx + dy * dy - radius * radius);
    if (discriminant >= 0) accept(-projection - Math.sqrt(discriminant));
  }
}

// Barrido círculo/rectángulo: caras y esquinas redondeadas, no una caja
// expandida que produciría impactos falsos cerca de las esquinas.
function hitDistance(origin, direction, radius, brick) {
  const edges = brickEdges(brick);
  if (overlapsAtStart(origin, radius, edges)) return 0;

  let best = Infinity;
  const accept = (distance) => {
    if (distance >= -EPSILON) best = Math.min(best, Math.max(0, distance));
  };
  sweepFaces(origin, direction, radius, edges, accept);
  sweepCorners(origin, direction, radius, edges, accept);
  return best;
}

function wallDistance(position, direction, left, right) {
  if (Math.abs(direction.x) < EPSILON) return Infinity;
  return Math.max(0, ((direction.x > 0 ? right : left) - position.x) / direction.x);
}

// Primer ladrillo vivo alcanzado antes de `limit` (pared o techo).
function nearestBrick(position, direction, radius, targets, limit) {
  let travel = limit;
  let target = null;
  for (const brick of targets) {
    if (!brick.alive) continue;
    const candidate = hitDistance(position, direction, radius, brick);
    if (candidate <= travel) {
      travel = candidate;
      target = brick;
    }
  }
  return { travel, target };
}

export function traceShot({ origin, angle, radius, bounds, targets, distance = Infinity }) {
  const clamped = clampAngle(angle);
  const direction = { x: Math.sin(clamped), y: -Math.cos(clamped) };
  const position = { ...origin };
  const points = [{ ...position }];
  const left = bounds.left + radius;
  const right = bounds.right - radius;
  position.x = clamp(position.x, left, right);
  let remaining = distance;
  let hit = null;
  let ended = false;

  // Con ±70° y un tablero finito se llega siempre al techo.
  while (remaining > EPSILON && !ended) {
    const toWall = wallDistance(position, direction, left, right);
    const toCeiling = Math.max(0, (bounds.top + radius - position.y) / direction.y);
    const { travel, target } = nearestBrick(
      position, direction, radius, targets, Math.min(toWall, toCeiling),
    );

    const step = Math.min(remaining, travel);
    position.x += direction.x * step;
    position.y += direction.y * step;
    points.push({ ...position });
    remaining -= step;

    if (travel > step + EPSILON) break; // se agotó la distancia antes del obstáculo
    if (target || toCeiling <= toWall) {
      hit = target;
      ended = true;
    } else {
      direction.x *= -1; // rebote en pared
    }
  }
  return { position, angle: Math.atan2(direction.x, -direction.y), points, hit, ended };
}

// Barrido uniforme de ángulos + tiros directos a los centros de cada ladrillo
// y a sus imágenes reflejadas en las paredes (rebote simple).
function candidateAngles({ targets, bounds, radius, origin }) {
  const angles = [];
  for (let i = 0; i <= SAMPLE_STEPS; i++) {
    angles.push(-MAX_ANGLE + 2 * MAX_ANGLE * i / SAMPLE_STEPS);
  }
  const leftWall = bounds.left + radius;
  const rightWall = bounds.right - radius;
  for (const brick of targets) {
    if (!brick.alive) continue;
    for (const x of [brick.x, 2 * leftWall - brick.x, 2 * rightWall - brick.x]) {
      const angle = Math.atan2(x - origin.x, origin.y - brick.y);
      if (Math.abs(angle) <= MAX_ANGLE) angles.push(angle);
    }
  }
  return angles;
}

// Solo se ofrecen letras cuyo primer impacto es un objetivo real.
export function availableLetters(scene) {
  const letters = new Set();
  for (const angle of candidateAngles(scene)) {
    const { hit } = traceShot({ ...scene, angle });
    if (hit) letters.add(hit.char);
  }
  return [...letters];
}

// Reubica un punto del tablero antiguo al nuevo tras un resize (proporcional).
export function remapPosition(position, from, to) {
  const fromWidth = from.bounds.right - from.bounds.left;
  const toWidth = to.bounds.right - to.bounds.left;
  const fromHeight = from.origin.y - from.bounds.top;
  const toHeight = to.origin.y - to.bounds.top;
  return {
    x: to.bounds.left + (position.x - from.bounds.left) / fromWidth * toWidth,
    y: to.bounds.top + (position.y - from.bounds.top) / fromHeight * toHeight,
  };
}
