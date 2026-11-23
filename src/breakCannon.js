import { MAX_ANGLE, clampAngle, availableLetters, remapPosition, traceShot } from './breakTrajectory.js';

// Re-exportado para que los imports existentes sigan funcionando.
export { MAX_ANGLE, clampAngle, traceShot, availableLetters, remapPosition };

// El gesto recorre ±MAX_ANGLE al arrastrar esta fracción del ancho del pad.
const AIM_TRAVEL_RATIO = 0.75;

// Estado del cañón: ángulo, munición (current/next), gesto activo y proyectil
// en vuelo. No toca el DOM ni el canvas.
export class Cannon {
  constructor(random = Math.random) {
    this.random = random;
    this.reset();
  }

  get isAiming() { return this.gesture !== null; }
  get isFlying() { return this.shot !== null; }

  reset() {
    this.angle = 0;
    this.current = null;
    this.next = null;
    this.shot = null;
    this.gesture = null;
  }

  // ── Munición ────────────────────────────────────────────────────────────
  // Hay que llamarlo tras cada cambio del tablero (impacto, resize, reset):
  // `advance` promociona `next` a `current`, pero no valida que siga alcanzable.
  reload(scene) {
    // Los especiales son transitorios: nunca depender de ellos para la munición.
    const letters = availableLetters({ ...scene, targets: scene.ammoTargets || scene.targets });
    const pick = () => letters[Math.floor(this.random() * letters.length)] || null;
    if (!letters.includes(this.current)) this.current = pick();
    if (!letters.includes(this.next)) this.next = pick();
  }

  // Intercambia la letra actual con la siguiente (ambas ya validadas por reload).
  // No hace nada en pleno gesto o vuelo, ni si son la misma letra.
  swap() {
    if (this.isFlying || this.isAiming || !this.current || !this.next) return false;
    if (this.current === this.next) return false;
    [this.current, this.next] = [this.next, this.current];
    return true;
  }

  // ── Gesto de apuntado ───────────────────────────────────────────────────
  begin(id, x) {
    if (this.isAiming || this.isFlying || !this.current) return false;
    this.gesture = { id, x, angle: this.angle };
    return true;
  }

  aim(id, x, width) {
    if (this.gesture?.id !== id) return;
    const travel = Math.max(1, width * AIM_TRAVEL_RATIO);
    this.angle = clampAngle(this.gesture.angle + (x - this.gesture.x) / travel * 2 * MAX_ANGLE);
  }

  cancel() {
    this.gesture = null;
  }

  release(id, scene, cancelled = false) {
    if (this.gesture?.id !== id) return null;
    this.cancel();
    return cancelled ? null : this.fire(scene);
  }

  // ── Disparo y vuelo ─────────────────────────────────────────────────────
  fire(scene) {
    if (this.isFlying || !this.current) return null;
    const char = this.current;
    this.shot = { position: { ...scene.origin }, angle: this.angle, char };
    this.current = null;
    return char;
  }

  advance(seconds, scene) {
    if (!this.shot) return null;
    const result = traceShot({
      ...scene,
      origin: this.shot.position,
      angle: this.shot.angle,
      distance: scene.speed * seconds,
    });
    this.shot.position = result.position;
    this.shot.angle = result.angle;
    if (!result.ended) return null;
    const impact = { char: this.shot.char, target: result.hit };
    this.shot = null;
    this.current = this.next;
    this.next = null;
    return impact;
  }

  remapShot(previousScene, scene) {
    if (!this.shot) return;
    this.shot.position = remapPosition(this.shot.position, previousScene, scene);
  }
}
