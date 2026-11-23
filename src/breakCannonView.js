import { Cannon, clampAngle, traceShot } from './breakCannon.js';

const KEY_STEP = Math.PI / 90; // 2° por pulsación de flecha

const COLORS = {
  accent: '#66fcf1',
  guide: 'rgba(102,252,241,0.65)',
  guideCancelling: '#fc5c65',
  tokenFill: '#132c32',
  tokenText: '#fff',
};

const MESSAGES = {
  flying: 'Letra en vuelo…',
  cancelling: 'Suelta aquí para cancelar',
  aiming: 'Suelta para disparar · Sube a CANCELAR para anular',
  idle: 'Mantén, desliza y suelta para disparar',
};

const toDegrees = (radians) => Math.round(radians * 180 / Math.PI);

// ── Dibujo (funciones puras sobre el contexto 2D) ─────────────────────────

function drawToken(ctx, char, x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.tokenFill;
  ctx.fill();
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = COLORS.tokenText;
  ctx.font = `900 ${Math.round(radius * 1.35)}px Cinzel, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, x, y + 1);
}

function drawGuide(ctx, scene, angle, cancelling, length) {
  const trajectory = traceShot({ ...scene, angle, distance: length });
  ctx.save();
  ctx.strokeStyle = cancelling ? COLORS.guideCancelling : COLORS.guide;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 8]);
  ctx.beginPath();
  trajectory.points.forEach((point, i) => {
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  // La bola fantasma solo se dibuja si la guía llega al impacto: con la guía
  // recortada marcaría un punto de aterrizaje falso.
  if (trajectory.ended) {
    ctx.beginPath();
    ctx.arc(trajectory.position.x, trajectory.position.y, scene.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBarrel(ctx, { origin, radius }, angle) {
  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(angle);
  ctx.fillStyle = COLORS.accent;
  ctx.beginPath();
  ctx.roundRect(-7, -radius - 22, 14, 30, 5);
  ctx.fill();
  ctx.restore();
}

// ── Vista ─────────────────────────────────────────────────────────────────

// guideLength: longitud máxima de la línea de puntos en píxeles (Infinity = guía
// completa hasta el impacto; 0 = sin guía). Cada punto ocupa unos 11 px.
// canSwap / onSwap: permiten cambiar de letra tocando la siguiente (o con la tecla X);
// canSwap decide si se permite ahora y onSwap aplica el coste (p. ej. un lanzamiento).
export function createCannonView({
  controls, getScene, canPlay, onFire, onImpact, guideLength = Infinity,
  canSwap = () => true, onSwap = () => {},
}) {
  const model = new Cannon();
  const pad = controls.querySelector('.cannon-pad');
  const cancelButton = controls.querySelector('.cannon-cancel');
  const status = controls.querySelector('.cannon-status');
  const next = controls.querySelector('.cannon-next');
  const lifecycle = new AbortController();
  let enabled = false;
  let cancelling = false; // puntero sobre el botón CANCELAR durante el gesto

  const on = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: lifecycle.signal });
  const isPlayable = () => enabled && canPlay();

  function statusText() {
    if (model.isFlying) return MESSAGES.flying;
    if (cancelling) return MESSAGES.cancelling;
    if (model.isAiming) return MESSAGES.aiming;
    return MESSAGES.idle;
  }

  function sync() {
    controls.classList.toggle('is-aiming', model.isAiming);
    controls.classList.toggle('is-cancelling', cancelling);
    controls.classList.toggle('is-flying', model.isFlying);
    const text = statusText();
    if (status.textContent !== text) status.textContent = text;
    next.textContent = model.next || '—';
    const degrees = toDegrees(model.angle);
    pad.setAttribute('aria-valuenow', String(degrees));
    pad.setAttribute('aria-valuetext', `${degrees} grados. Letra ${model.current || 'en vuelo'}`);
    pad.setAttribute('aria-disabled', String(model.isFlying));
  }

  function releaseCapture(id) {
    if (id != null && pad.hasPointerCapture(id)) pad.releasePointerCapture(id);
  }

  function cancel() {
    const id = model.gesture?.id;
    model.cancel();
    cancelling = false;
    releaseCapture(id);
    sync();
  }

  function inCancelZone(event) {
    const rect = cancelButton.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }

  // ── Puntero ──
  on(pad, 'pointerdown', (event) => {
    if (!isPlayable() || !event.isPrimary || event.button !== 0) return;
    if (next.contains(event.target)) return; // tocar la letra siguiente no inicia un gesto
    if (!model.begin(event.pointerId, event.clientX)) return;
    event.preventDefault();
    pad.focus({ preventScroll: true });
    pad.setPointerCapture(event.pointerId);
    sync();
  });

  on(pad, 'pointermove', (event) => {
    if (model.gesture?.id !== event.pointerId) return;
    if (!canPlay()) return cancel();
    model.aim(event.pointerId, event.clientX, pad.clientWidth);
    cancelling = inCancelZone(event);
    sync();
  });

  on(pad, 'pointerup', (event) => {
    if (model.gesture?.id !== event.pointerId) return;
    model.aim(event.pointerId, event.clientX, pad.clientWidth);
    const char = model.release(event.pointerId, getScene(), !isPlayable() || inCancelZone(event));
    releaseCapture(event.pointerId);
    cancelling = false;
    if (char) onFire();
    sync();
  });

  for (const type of ['pointercancel', 'lostpointercapture']) {
    on(pad, type, (event) => {
      if (model.gesture?.id === event.pointerId) cancel();
    });
  }
  on(pad, 'contextmenu', (event) => event.preventDefault());
  on(cancelButton, 'click', cancel);

  // ── Cambio de letra ──
  function trySwap() {
    if (!isPlayable() || model.isFlying || model.isAiming || !canSwap()) return;
    if (!model.swap()) return;
    onSwap();
    sync();
  }

  next.setAttribute('role', 'button');
  next.setAttribute('aria-label', 'Cambiar de letra');
  next.tabIndex = 0;
  next.style.cursor = 'pointer';
  on(next, 'click', trySwap);
  on(next, 'keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation(); // que no llegue al pad y dispare
    trySwap();
  });

  // ── Teclado ──
  on(pad, 'keydown', (event) => {
    if (event.key === 'Escape') return cancel();
    if (!isPlayable() || model.isFlying || model.isAiming) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      model.angle = clampAngle(model.angle + direction * KEY_STEP);
    } else if (event.key === 'x' || event.key === 'X') {
      trySwap();
    } else if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      if (model.fire(getScene())) onFire();
    }
    sync();
  });

  // ── Pérdida de foco: anular cualquier gesto a medias ──
  on(window, 'blur', cancel);
  on(document, 'visibilitychange', cancel);

  return {
    cancel,

    reset() {
      cancel();
      model.reset();
      model.reload(getScene());
      sync();
    },

    // Tras activar hay que llamar a reset() para cargar la munición.
    setEnabled(value) {
      if (enabled === value) return;
      enabled = value;
      controls.hidden = !value;
      if (!value) {
        cancel();
        model.reset();
      }
    },

    resize(previousScene) {
      cancel();
      const scene = getScene();
      if (previousScene) model.remapShot(previousScene, scene);
      if (enabled && !model.isFlying) model.reload(scene);
      sync();
    },

    update(dt) {
      if (!enabled) return;
      if (!canPlay()) {
        if (model.isAiming) cancel();
        return;
      }
      const impact = model.advance(dt / 1000, getScene());
      if (!impact) return;
      onImpact(impact);
      if (isPlayable()) model.reload(getScene()); // onImpact puede haber desactivado la vista
      sync();
    },

    draw(ctx) {
      if (!isPlayable()) return;
      const scene = getScene();
      ctx.save();
      if (!model.isFlying && model.current && guideLength > 0) {
        drawGuide(ctx, scene, model.angle, cancelling, guideLength);
      }
      drawBarrel(ctx, scene, model.angle);
      drawToken(ctx, model.current || '·', scene.origin.x, scene.origin.y, scene.radius);
      if (model.shot) {
        drawToken(ctx, model.shot.char, model.shot.position.x, model.shot.position.y, scene.radius);
      }
      ctx.restore();
    },

    // Quita todos los listeners (incluidos los de window/document).
    destroy() {
      lifecycle.abort();
      model.cancel();
      model.reset();
    },
  };
}
