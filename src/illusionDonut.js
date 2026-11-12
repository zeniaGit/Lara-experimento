/**
 * Animación compacta del Donut de Ilusión Óptica 3D Wireframe (Biestable)
 * Se auto-pausa cuando el modal de inicio no está visible para no consumir recursos.
 */
export function initIllusionDonut() {
  const canvas = document.getElementById('illusion-donut-canvas');
  const modal = document.getElementById('modal-select-mode');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const displaySize = 140;

  canvas.width = displaySize * dpr;
  canvas.height = displaySize * dpr;
  canvas.style.width = displaySize + 'px';
  canvas.style.height = displaySize + 'px';
  ctx.scale(dpr, dpr);

  // Parámetros a escala para miniatura (140px)
  const R = 40;
  const r = 18;
  const uSteps = 18;
  const vSteps = 28;

  const tiltX = 35 * Math.PI / 180;
  const tiltZ = 15 * Math.PI / 180;

  let spinAngle = 0;
  const spinSpeed = 0.018;
  let isRunning = false;
  let animId = null;

  function getPoint(u, v, angle) {
    const x0 = (R + r * Math.cos(u)) * Math.cos(v);
    const y0 = r * Math.sin(u);
    const z0 = (R + r * Math.cos(u)) * Math.sin(v);

    // Giro continuo sobre eje Y
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const x1 = x0 * cosA + z0 * sinA;
    const y1 = y0;
    const z1 = -x0 * sinA + z0 * cosA;

    // Inclinación en X
    const cosX = Math.cos(tiltX);
    const sinX = Math.sin(tiltX);
    const x2 = x1;
    const y2 = y1 * cosX - z1 * sinX;
    const z2 = y1 * sinX + z1 * cosX;

    // Inclinación en Z
    const cosZ = Math.cos(tiltZ);
    const sinZ = Math.sin(tiltZ);
    const x3 = x2 * cosZ - y2 * sinZ;
    const y3 = x2 * sinZ + y2 * cosZ;

    const cx = displaySize / 2;
    const cy = displaySize / 2;

    return {
      x: cx + x3,
      y: cy + y3
    };
  }

  function frame() {
    if (!isRunning) return;

    ctx.clearRect(0, 0, displaySize, displaySize);
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';

    // Anillos longitudinales
    for (let i = 0; i < uSteps; i++) {
      const u = (i / uSteps) * Math.PI * 2;
      ctx.beginPath();
      for (let j = 0; j <= vSteps; j++) {
        const v = (j / vSteps) * Math.PI * 2;
        const p = getPoint(u, v, spinAngle);
        if (j === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Anillos transversales
    for (let j = 0; j < vSteps; j++) {
      const v = (j / vSteps) * Math.PI * 2;
      ctx.beginPath();
      for (let i = 0; i <= uSteps; i++) {
        const u = (i / uSteps) * Math.PI * 2;
        const p = getPoint(u, v, spinAngle);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }

    // Punto central de referencia
    const cx = displaySize / 2;
    const cy = displaySize / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3366';
    ctx.fill();

    spinAngle += spinSpeed;
    animId = requestAnimationFrame(frame);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    animId = requestAnimationFrame(frame);
  }

  function stop() {
    isRunning = false;
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }

  // Observar visibilidad del modal para pausar/reanudar automáticamente
  if (modal) {
    const observer = new MutationObserver(() => {
      const isHidden = modal.hasAttribute('hidden') || modal.style.display === 'none';
      if (isHidden) {
        stop();
      } else {
        start();
      }
    });

    observer.observe(modal, { attributes: true, attributeFilter: ['hidden', 'style'] });

    if (!modal.hasAttribute('hidden')) {
      start();
    }
  } else {
    start();
  }
}
