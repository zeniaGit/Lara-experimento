const ROUND_SIZE = 10;
const DECK_KEY = 'lara_english_deck_v1';

const objects = [
  ['bed', 'cama', '🛏️'],
  ['chair', 'silla', '🪑'],
  ['lamp', 'lámpara', '🪔'],
  ['book', 'libro', '📕'],
  ['clock', 'reloj', '🕰️'],
  ['door', 'puerta', '🚪'],
  ['window', 'ventana', '🪟'],
  ['mirror', 'espejo', '🪞'],
  ['box', 'caja', '📦'],
  ['teddy bear', 'osito', '🧸'],
];

const prepositions = [
  ['in', 'dentro de'],
  ['on', 'encima de'],
  ['under', 'debajo de'],
  ['next to', 'al lado de'],
];

const scenes = [
  ['The book is ___ the box.', 'El libro está dentro de la caja.', 'in'],
  ['The teddy bear is ___ the bed.', 'El osito está encima de la cama.', 'on'],
  ['The box is ___ the chair.', 'La caja está debajo de la silla.', 'under'],
  ['The lamp is ___ the window.', 'La lámpara está al lado de la ventana.', 'next to'],
  ['The clock is ___ the box.', 'El reloj está dentro de la caja.', 'in'],
  ['The book is ___ the chair.', 'El libro está encima de la silla.', 'on'],
  ['The teddy bear is ___ the chair.', 'El osito está debajo de la silla.', 'under'],
  ['The mirror is ___ the door.', 'El espejo está al lado de la puerta.', 'next to'],
  ['The box is ___ the bed.', 'La caja está debajo de la cama.', 'under'],
  ['The chair is ___ the bed.', 'La silla está al lado de la cama.', 'next to'],
];

const cards = new Map();
for (const [word, translation, symbol] of objects) {
  const explanation = `${word} significa «${translation}».`;
  cards.set(`listen:${word}`, { kind: 'listen', answer: word, explanation });
  cards.set(`read:${word}`, { kind: 'read', question: `¿Cómo se dice «${translation}»?`, clue: symbol, answer: word, explanation });
}
for (const [question, clue, answer] of scenes) {
  cards.set(question, { kind: 'sentence', question, clue, answer, explanation: question.replace('___', answer) });
}

function shuffle(items) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function loadDeck() {
  try {
    const saved = JSON.parse(localStorage.getItem(DECK_KEY));
    if (Array.isArray(saved)) {
      return [...new Set(saved.filter((id) => cards.has(id)))];
    }
  } catch {
    // La partida sigue funcionando si el navegador bloquea el almacenamiento.
  }
  return null;
}

let deck = loadDeck();

function drawCard(seenThisRound) {
  if (!deck?.length) deck = shuffle(cards.keys());

  // Al cruzar el final del banco, conserva las fichas aplazadas para otra partida.
  const index = deck.findIndex((id) => !seenThisRound.has(id));
  const [id] = deck.splice(index, 1);
  try {
    localStorage.setItem(DECK_KEY, JSON.stringify(deck));
  } catch {
    // La rotación se conserva en memoria mientras la pestaña siga abierta.
  }
  return id;
}

const element = (id) => document.getElementById(id);
const menu = element('modal-select-mode');
const modal = element('modal-english-game');
const startButton = element('btn-choose-english');
const progress = element('english-progress');
const questionText = element('english-question');
const clueText = element('english-clue');
const answers = element('english-answers');
const feedback = element('english-feedback');
const audioControls = element('english-audio');
const listenButton = element('english-listen');
const nextButton = element('english-next');
const replayButton = element('english-replay');
const reviewButton = element('english-review');

let seenThisRound = new Set();
let missed = [];
let review = null;
let currentCard = null;
let roundIndex = 0;
let score = 0;

const speech = window.speechSynthesis;
let activeSpeech = null;

function stopSpeech() {
  if (activeSpeech) {
    activeSpeech = null;
    speech.cancel();
  }
}

function revealWord() {
  clueText.textContent = currentCard.answer;
  clueText.lang = 'en';
}

function speakWord() {
  stopSpeech();
  if (!speech || typeof window.SpeechSynthesisUtterance !== 'function') {
    revealWord();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(currentCard.answer);
  utterance.lang = 'en-GB';
  utterance.rate = 0.85;
  activeSpeech = utterance;
  utterance.onend = () => {
    if (activeSpeech === utterance) activeSpeech = null;
  };
  utterance.onerror = () => {
    if (activeSpeech !== utterance) return;
    activeSpeech = null;
    revealWord();
  };
  speech.speak(utterance);
}

function showCard() {
  const id = review ? review[roundIndex] : drawCard(seenThisRound);
  if (!review) seenThisRound.add(id);
  currentCard = cards.get(id);
  const listening = currentCard.kind === 'listen';
  const sentence = currentCard.kind === 'sentence';

  progress.textContent = review
    ? `Repaso · Ficha ${roundIndex + 1} de ${review.length}`
    : `Ficha ${roundIndex + 1} de ${ROUND_SIZE} · Aciertos: ${score}`;
  questionText.textContent = listening ? 'Escucha y elige el dibujo' : currentCard.question;
  questionText.lang = sentence ? 'en' : 'es';
  clueText.textContent = currentCard.clue || '';
  clueText.lang = 'es';
  feedback.textContent = '';
  audioControls.hidden = !listening;
  listenButton.disabled = !speech || typeof window.SpeechSynthesisUtterance !== 'function';
  if (listening && listenButton.disabled) revealWord();

  nextButton.hidden = true;
  replayButton.hidden = true;
  reviewButton.hidden = true;
  answers.replaceChildren();

  const pool = sentence ? prepositions : objects;
  const correct = pool.find(([word]) => word === currentCard.answer);
  const alternatives = shuffle(pool.filter(([word]) => word !== currentCard.answer)).slice(0, 3);
  for (const [word, translation, symbol] of shuffle([correct, ...alternatives])) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'math-answer';
    button.dataset.word = word;
    button.textContent = listening ? symbol : word;
    if (listening) button.setAttribute('aria-label', translation);
    else button.lang = 'en';

    button.addEventListener('click', () => {
      for (const option of answers.children) {
        option.disabled = true;
        if (option.dataset.word === currentCard.answer) option.classList.add('correct');
      }
      if (word === currentCard.answer) {
        if (!review) score += 1;
        feedback.textContent = `¡Correcto! ${currentCard.explanation}`;
      } else {
        if (!review) missed.push(id);
        button.classList.add('incorrect');
        feedback.textContent = `Casi. ${currentCard.explanation}`;
      }

      if (listening) revealWord();
      if (!review) progress.textContent = `Ficha ${roundIndex + 1} de ${ROUND_SIZE} · Aciertos: ${score}`;
      nextButton.hidden = false;
      nextButton.focus();
    });
    answers.append(button);
  }
  progress.focus();
}

function finishRound() {
  stopSpeech();
  const wasReview = Boolean(review);
  progress.textContent = wasReview ? 'Repaso completado' : 'Partida completada';
  questionText.textContent = wasReview ? '¡Buen trabajo!' : `${score} de ${ROUND_SIZE} aciertos`;
  questionText.lang = 'es';
  clueText.textContent = '';
  feedback.textContent = '';
  audioControls.hidden = true;
  nextButton.hidden = true;
  answers.replaceChildren();
  reviewButton.hidden = wasReview || missed.length === 0;
  replayButton.hidden = false;
  progress.focus();
}

function startRound() {
  stopSpeech();
  menu.hidden = true;
  modal.hidden = false;
  seenThisRound = new Set();
  missed = [];
  review = null;
  roundIndex = 0;
  score = 0;
  showCard();
}

function closeEnglish() {
  stopSpeech();
  modal.hidden = true;
  menu.hidden = false;
  startButton.focus();
}

startButton.addEventListener('click', startRound);
replayButton.addEventListener('click', startRound);
listenButton.addEventListener('click', speakWord);
element('english-show-text').addEventListener('click', revealWord);
element('english-back').addEventListener('click', closeEnglish);
modal.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeEnglish();
});
nextButton.addEventListener('click', () => {
  stopSpeech();
  roundIndex += 1;
  if (roundIndex === (review ? review.length : ROUND_SIZE)) finishRound();
  else showCard();
});
reviewButton.addEventListener('click', () => {
  review = [...missed];
  roundIndex = 0;
  showCard();
});
