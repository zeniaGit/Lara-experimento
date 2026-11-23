const HIT_SCORE = 100;
const SPECIAL_HIT_SCORE = 200;
export const MISS_PENALTY = 10;
export const SPECIAL_SECONDS_SAVED = 2;

const TIME_BUDGET_PER_BRICK = 8; // segundos "gratis" por ladrillo
const TIME_BONUS_PER_SECOND = 10;
const THROWS_BUDGET_PER_BRICK = 2; // por debajo de esto hay bonus de lanzamientos
const THROW_BONUS = 25;
const THROW_LIMIT_PER_BRICK = 3; // al agotarlos la partida termina sin completar

const STREAK_STEP = 0.25; // cada acierto seguido suma +0,25 al multiplicador
const MAX_STREAK_STEPS = 4; // tope ×2

const CANNON_LEVELS = 4;

export function rankingModeKey(level = 1) {
  if (level === 'pintar' || level === 'relax') return 'pintar';
  if (level === 'mates' || level === 'ingles') return level;
  if (new RegExp(`^romper-canon-[1-${CANNON_LEVELS}]$`).test(String(level))) return String(level);
  const clamped = Math.min(CANNON_LEVELS, Math.max(1, parseInt(level, 10) || 1));
  return `romper-canon-${clamped}`;
}

export function throwLimit(brickCount) {
  return brickCount * THROW_LIMIT_PER_BRICK;
}

// Multiplicador según los aciertos seguidos previos: 0→×1, 1→×1,25 … 4 o más→×2.
export function streakMultiplier(streak = 0) {
  return 1 + Math.min(Math.max(0, streak), MAX_STREAK_STEPS) * STREAK_STEP;
}

// `streak` = aciertos seguidos antes de este impacto. Devuelve el nuevo `streak`:
// un fallo (letra distinta o techo) lo reinicia a 0.
export function scoreImpact(score, char, target, special = false, streak = 0) {
  if (!target) return { score, broken: false, secondsSaved: 0, streak: 0, multiplier: 1 };
  if (char !== target.char) {
    return {
      score: Math.max(0, score - MISS_PENALTY), broken: false, secondsSaved: 0, streak: 0, multiplier: 1,
    };
  }
  const multiplier = streakMultiplier(streak);
  const base = special ? SPECIAL_HIT_SCORE : HIT_SCORE;
  return {
    score: score + Math.round(base * multiplier),
    broken: true,
    secondsSaved: special ? SPECIAL_SECONDS_SAVED : 0,
    streak: streak + 1,
    multiplier,
  };
}

export function completionBonus(brickCount, elapsed, throws) {
  return {
    timeBonus: Math.max(0, Math.round(brickCount * TIME_BUDGET_PER_BRICK - elapsed)) * TIME_BONUS_PER_SECOND,
    throwBonus: Math.max(0, brickCount * THROWS_BUDGET_PER_BRICK - throws) * THROW_BONUS,
  };
}
