import test from 'node:test';
import assert from 'node:assert/strict';
import { Cannon, MAX_ANGLE, clampAngle, traceShot, availableLetters, remapPosition } from '../src/breakCannon.js';
import { rankingModeKey, scoreImpact, completionBonus, streakMultiplier, throwLimit } from '../src/breakRules.js';

const brick = (char, x = 150, y = 100, w = 40, h = 20) => ({ char, x, y, w, h, alive: true });
const scene = (targets = []) => ({
  origin: { x: 150, y: 500 },
  bounds: { left: 0, right: 300, top: 0 },
  radius: 10,
  speed: 600,
  targets,
});

test('el tiro vertical termina en el primer ladrillo, sin atravesarlo', () => {
  const back = brick('B', 150, 50);
  const front = brick('A');
  const result = traceShot({ ...scene([back, front]), angle: 0, distance: 10000 });
  assert.equal(result.hit, front);
  assert.equal(result.position.y, 120);
  assert.equal(result.ended, true);
});

test('guía y avance por frames llegan al mismo impacto tras un rebote', () => {
  const target = brick('A', 100, 100, 80);
  const setup = scene([target]);
  const angle = Math.atan2(330, 400);
  const guide = traceShot({ ...setup, angle });
  assert.equal(guide.hit, target);
  assert.ok(guide.points.length >= 3);
  let position = setup.origin;
  let direction = angle;
  let step;
  for (let i = 0; i < 1000; i++) {
    step = traceShot({ ...setup, origin: position, angle: direction, distance: 6 });
    position = step.position;
    direction = step.angle;
    if (step.ended) break;
  }
  assert.equal(step.hit, guide.hit);
  assert.ok(Math.hypot(position.x - guide.position.x, position.y - guide.position.y) < 1e-5);
});

test('los ángulos extremos terminan en el techo y permanecen dentro de paredes', () => {
  for (const angle of [-MAX_ANGLE, MAX_ANGLE, 0]) {
    const result = traceShot({ ...scene(), angle });
    assert.equal(result.ended, true);
    assert.equal(result.hit, null);
    assert.ok(Math.abs(result.position.y - 10) < 1e-5);
    assert.ok(result.points.every(({ x }) => x >= 10 - 1e-5 && x <= 290 + 1e-5));
  }
  assert.equal(clampAngle(100), MAX_ANGLE);
  assert.equal(clampAngle(-100), -MAX_ANGLE);
});

test('no hay falsos impactos en la esquina de una caja expandida', () => {
  const target = brick('A', 150, 100, 40, 20);
  const result = traceShot({
    ...scene([target]), origin: { x: 121, y: 119 }, angle: 0, distance: 1,
  });
  assert.equal(result.hit, null);
  assert.equal(result.ended, false);
});

test('no se ofrece una letra completamente tapada por la fila inferior', () => {
  const hidden = brick('B', 150, 40);
  const front = brick('A', 150, 100, 300);
  assert.deepEqual(availableLetters(scene([hidden, front])), ['A']);
  front.alive = false;
  assert.deepEqual(availableLetters(scene([hidden, front])), ['B']);
});

test('un único puntero controla el gesto y soltar solo dispara una vez', () => {
  const cannon = new Cannon(() => 0);
  const setup = scene([brick('A')]);
  cannon.reload(setup);
  assert.equal(cannon.begin(1, 100), true);
  assert.equal(cannon.begin(2, 200), false);
  cannon.aim(2, 300, 300);
  assert.equal(cannon.angle, 0);
  assert.equal(cannon.release(2, setup), null);
  assert.equal(cannon.release(1, setup), 'A');
  assert.equal(cannon.release(1, setup), null);
  assert.equal(cannon.fire(setup), null);
  assert.equal(cannon.begin(1, 100), false);
});

test('cancelar conserva letra, no crea tiro y no carga potencia', () => {
  const cannon = new Cannon(() => 0);
  const setup = scene([brick('A')]);
  cannon.reload(setup);
  cannon.begin(1, 100);
  cannon.aim(1, 140, 300);
  const angle = cannon.angle;
  assert.equal(cannon.release(1, setup, true), null);
  assert.equal(cannon.shot, null);
  assert.equal(cannon.current, 'A');
  cannon.begin(2, 200);
  assert.equal(cannon.angle, angle);
  cannon.cancel();
  assert.equal(cannon.release(2, setup), null);
});

test('al impactar se consume el tiro y se revalida la siguiente letra', () => {
  const front = brick('A', 150, 100, 300);
  const back = brick('B', 150, 40);
  const setup = scene([front, back]);
  const cannon = new Cannon(() => 0);
  cannon.reload(setup);
  assert.equal(cannon.current, 'A');
  assert.equal(cannon.next, 'A');
  cannon.fire(setup);
  const impact = cannon.advance(1, setup);
  assert.equal(impact.target, front);
  front.alive = false;
  cannon.reload(setup);
  assert.equal(cannon.current, 'B');
  assert.equal(cannon.next, 'B');
  assert.equal(cannon.advance(1, setup), null);
});

test('la munición no depende de un especial que puede desaparecer', () => {
  const regular = brick('A');
  const special = brick('Z', 100, 400);
  const cannon = new Cannon(() => 0.99);
  cannon.reload({ ...scene([regular, special]), ammoTargets: [regular] });
  assert.equal(cannon.current, 'A');
  assert.equal(cannon.next, 'A');
});

test('puntuación de aciertos, errores, techo y especial', () => {
  assert.deepEqual(scoreImpact(0, 'A', brick('A')), {
    score: 100, broken: true, secondsSaved: 0, streak: 1, multiplier: 1,
  });
  assert.equal(scoreImpact(5, 'B', brick('A')).score, 0);
  assert.equal(scoreImpact(100, 'B', brick('A')).score, 90);
  assert.equal(scoreImpact(100, 'B', null).score, 100);
  assert.deepEqual(scoreImpact(100, 'A', brick('A'), true), {
    score: 300, broken: true, secondsSaved: 2, streak: 1, multiplier: 1,
  });
  const bonus = completionBonus(10, 50, 12);
  assert.equal(1000 + bonus.timeBonus + bonus.throwBonus, 1500);
  assert.deepEqual(completionBonus(10, 1000, 1000), { timeBonus: 0, throwBonus: 0 });
});

test('rankings del cañón aislados e idempotentes; otros juegos conservan claves', () => {
  for (let level = 1; level <= 4; level++) {
    assert.equal(rankingModeKey(level), `romper-canon-${level}`);
    assert.equal(rankingModeKey(rankingModeKey(level)), rankingModeKey(level));
  }
  for (const key of ['pintar', 'mates', 'ingles']) assert.equal(rankingModeKey(key), key);
  assert.equal(rankingModeKey('relax'), 'pintar');
});

test('al cambiar el tamaño del tablero el proyectil conserva su posición relativa', () => {
  const from = scene();
  const to = { ...scene(), bounds: { left: 0, right: 150, top: 0 }, origin: { x: 75, y: 250 } };
  assert.deepEqual(remapPosition({ x: 150, y: 250 }, from, to), { x: 75, y: 125 });
  assert.deepEqual(remapPosition({ x: 0, y: 0 }, from, to), { x: 0, y: 0 });

  const cannon = new Cannon(() => 0);
  cannon.reload(scene([brick('A')]));
  cannon.fire(from);
  cannon.shot.position = { x: 150, y: 250 };
  cannon.remapShot(from, to);
  assert.deepEqual(cannon.shot.position, { x: 75, y: 125 });
  new Cannon().remapShot(from, to); // sin tiro en vuelo no hace nada
});

test('isAiming e isFlying reflejan el estado del cañón', () => {
  const cannon = new Cannon(() => 0);
  const setup = scene([brick('A')]);
  cannon.reload(setup);
  assert.equal(cannon.isAiming, false);
  assert.equal(cannon.isFlying, false);
  cannon.begin(1, 100);
  assert.equal(cannon.isAiming, true);
  cannon.release(1, setup);
  assert.equal(cannon.isAiming, false);
  assert.equal(cannon.isFlying, true);
});

test('el multiplicador de combo sube 0,25 por acierto seguido con tope ×2', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50].map(streakMultiplier), [1, 1.25, 1.5, 1.75, 2, 2, 2]);
  assert.equal(streakMultiplier(-3), 1);
  assert.equal(streakMultiplier(), 1);
});

test('el combo multiplica los aciertos y se reinicia al fallar o tocar el techo', () => {
  let state = { score: 0, streak: 0 };
  const gains = [];
  for (let i = 0; i < 6; i++) {
    const r = scoreImpact(state.score, 'A', brick('A'), false, state.streak);
    gains.push(r.score - state.score);
    state = r;
  }
  assert.deepEqual(gains, [100, 125, 150, 175, 200, 200]);
  assert.equal(state.streak, 6);

  const miss = scoreImpact(state.score, 'B', brick('A'), false, state.streak);
  assert.equal(miss.score, state.score - 10);
  assert.equal(miss.streak, 0);
  assert.equal(miss.broken, false);

  const ceiling = scoreImpact(state.score, 'A', null, false, state.streak);
  assert.equal(ceiling.score, state.score);
  assert.equal(ceiling.streak, 0);

  const special = scoreImpact(0, 'A', brick('A'), true, 2);
  assert.equal(special.score, 300); // 200 × 1,5
  assert.equal(special.secondsSaved, 2);
});

test('el límite de lanzamientos es proporcional al número de ladrillos', () => {
  assert.equal(throwLimit(10), 30);
  assert.equal(throwLimit(0), 0);
  assert.ok(throwLimit(10) > 10 * 2); // más holgado que el presupuesto del bonus
});

test('swap intercambia actual y siguiente solo cuando procede', () => {
  const setup = scene([brick('A', 100), brick('B', 200)]);
  const cannon = new Cannon(() => 0);
  assert.equal(cannon.swap(), false); // sin munición
  cannon.current = 'A';
  cannon.next = 'B';
  assert.equal(cannon.swap(), true);
  assert.equal(cannon.current, 'B');
  assert.equal(cannon.next, 'A');

  cannon.next = 'B'; // misma letra: no gasta el cambio
  assert.equal(cannon.swap(), false);

  cannon.next = 'A';
  cannon.begin(1, 100); // apuntando
  assert.equal(cannon.swap(), false);
  cannon.release(1, setup); // en vuelo
  assert.equal(cannon.isFlying, true);
  assert.equal(cannon.swap(), false);
});
