import type { ToyVariant } from '@/game';

export type Locale = 'en' | 'ru';
type LanguageChoice = Locale | 'auto';

const LANGUAGE_KEY = 'labubu-lookalike:language';

const english = {
  copy: {
    gameTitle: 'Thousand Labubus',
    loading: 'Loading the collection room…',
    modelError: 'The toy model could not be loaded. Reload the page to try again.',
    roomError: 'The 3D room could not start. Check that your browser supports WebGL, then reload the page.',
    target: 'Find this toy',
    time: 'Time',
    misses: 'Misses',
    best: 'Best',
    won: 'Twin spotted!',
    playAgain: 'Play again',
    difficulty: 'Difficulty',
    easy: 'Easy',
    normal: 'Normal',
    hard: 'Hard',
    controls: 'Controls',
    round: 'Round',
    toyCount: 'Toys:',
    language: 'Language',
    auto: 'Auto',
    help: 'Compare the fur color, pattern, ears, and eyes. Drag to orbit, right-drag to pan, and scroll or pinch to zoom. Pick a toy to guess.',
    touchHelp: 'Tap Orbit/Pan to change what one-finger dragging does. Drag with two fingers to pan in either mode.',
    camera: 'Room camera',
    quickCamera: 'Quick camera controls',
    left: 'Rotate view left',
    right: 'Rotate view right',
    up: 'Raise view',
    down: 'Lower view',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    reset: 'Reset',
    resetCamera: 'Reset camera',
    restart: 'New round',
    sound: 'Sound effects',
    touchMode: 'Pan instead of orbit with one finger',
    orbit: 'Orbit',
    pan: 'Pan',
    keyboardHelp: 'Use the Up and Down arrows to move between toys, Home or End to jump, and Enter to choose.',
    board: 'Toys in the room',
    match: 'Match.',
    wrong: 'Not a match.',
  },
  roundStarted: (round: number, count: number) => `Round ${round}: Find the exact match among ${count} toys.`,
  missed: (misses: number) => `Not this one. Misses: ${misses}.`,
  finished: (time: string, misses: number, record: boolean) =>
    `Match found in ${time} with ${misses} ${misses === 1 ? 'miss' : 'misses'}${record ? ' — a new best!' : '.'}`,
  toy: {
    fur: ['mocha brown', 'golden caramel', 'berry pink', 'lavender', 'leaf green', 'sky blue'],
    ears: ['solid pink-lined ears', 'cream-lined ears with coral stripes', 'lemon-lined ears with brown spots'],
    pattern: ['tiger stripes', 'chevrons', 'leopard spots', 'polka dots', 'patchwork', 'freckles', 'diamonds', 'waves'],
    ink: ['cream', 'charcoal', 'coral', 'teal', 'purple'],
    eyes: ['unframed glossy eyes', 'round teal glasses', 'angular plum cat-eye glasses'],
    describe: (fur: string, pattern: string, ink: string, ears: string, eyes: string) =>
      `${fur} fur with ${ink} ${pattern}, ${ears}, and ${eyes}`,
  },
};

const russian = {
  copy: {
    gameTitle: 'Тысяча лабубу',
    loading: 'Загружаем комнату с игрушками…',
    modelError: 'Не удалось загрузить модель игрушки. Обнови страницу, чтобы попробовать снова.',
    roomError: 'Не удалось открыть 3D-комнату. Проверь, поддерживает ли браузер WebGL, и обнови страницу.',
    target: 'Найди пару',
    time: 'Время',
    misses: 'Ошибки',
    best: 'Рекорд',
    won: 'Есть пара!',
    playAgain: 'Играть снова',
    difficulty: 'Сложность',
    easy: 'Легко',
    normal: 'Средне',
    hard: 'Сложно',
    controls: 'Управление',
    round: 'Раунд',
    toyCount: 'Игрушек:',
    language: 'Язык',
    auto: 'Авто',
    help: 'Сравни цвет меха, узор, уши и глаза. Потяни мышью, чтобы повернуть камеру, или зажми правую кнопку, чтобы сдвинуть её. Меняй масштаб колёсиком или двумя пальцами. Нажми на игрушку, чтобы выбрать её.',
    touchHelp: 'Кнопка «Поворот / Сдвиг» меняет действие одного пальца. Двумя пальцами можно сдвигать камеру в любом режиме.',
    camera: 'Камера комнаты',
    quickCamera: 'Быстрое управление камерой',
    left: 'Повернуть камеру влево',
    right: 'Повернуть камеру вправо',
    up: 'Поднять камеру',
    down: 'Опустить камеру',
    zoomIn: 'Приблизить',
    zoomOut: 'Отдалить',
    reset: 'Сброс',
    resetCamera: 'Сброс камеры',
    restart: 'Новый раунд',
    sound: 'Звуки',
    touchMode: 'Сдвиг камеры одним пальцем вместо поворота',
    orbit: 'Поворот',
    pan: 'Сдвиг',
    keyboardHelp: 'Стрелки вверх и вниз переходят к соседней игрушке. Home и End ведут к первой и последней. Enter выбирает игрушку.',
    board: 'Игрушки в комнате',
    match: 'Подходит.',
    wrong: 'Не подходит.',
  },
  roundStarted: (round: number, count: number) => `Раунд ${round}. Найди такую же среди ${count} игрушек.`,
  missed: (misses: number) => `Не та игрушка. Ошибок: ${misses}.`,
  finished: (time: string, misses: number, record: boolean) =>
    `Пара найдена! Время: ${time}. Ошибок: ${misses}.${record ? ' Новый рекорд!' : ''}`,
  toy: {
    fur: ['кофейно-коричневый', 'золотисто-карамельный', 'малиново-розовый', 'лавандовый', 'светло-зелёный', 'небесно-голубой'],
    ears: ['уши с однотонной розовой серединкой', 'уши с кремовой серединкой в коралловую полоску', 'уши с лимонной серединкой в коричневую крапинку'],
    pattern: ['тигровые полосы', 'зигзаги', 'леопардовые пятна', 'горошек', 'лоскуты', 'веснушки', 'ромбы', 'волны'],
    ink: ['кремового', 'угольного', 'кораллового', 'бирюзового', 'фиолетового'],
    eyes: ['блестящие глаза без очков', 'круглые бирюзовые очки', 'сливовые очки «кошачий глаз»'],
    describe: (fur: string, pattern: string, ink: string, ears: string, eyes: string) =>
      `${fur} мех, узор ${ink} цвета: ${pattern}; ${ears}; ${eyes}`,
  },
} satisfies typeof english;

export function describeToy({ fur, pattern, ink, ears, eyes }: ToyVariant, locale: Locale): string {
  const toy = messages[locale].toy;
  return toy.describe(toy.fur[fur], toy.pattern[pattern], toy.ink[ink], toy.ears[ears], toy.eyes[eyes]);
}

export const messages: Record<Locale, typeof english> = { en: english, ru: russian };

export function isLocale(value: string | null): value is Locale {
  return value === 'en' || value === 'ru';
}

export function readLanguageChoice(): LanguageChoice {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Automatic language detection works without storage.
  }
  return 'auto';
}

export function saveLanguageChoice(choice: LanguageChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(LANGUAGE_KEY);
    else localStorage.setItem(LANGUAGE_KEY, choice);
  } catch {
    // The choice still applies for this visit.
  }
}

function localeFromTag(tag: string): Locale | undefined {
  const primary = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  return isLocale(primary) ? primary : undefined;
}

export function resolveLocale(choice: LanguageChoice): Locale {
  if (choice !== 'auto') return choice;
  for (const tag of navigator.languages ?? []) {
    const preferred = localeFromTag(tag);
    if (preferred) return preferred;
  }
  return localeFromTag(navigator.language) ?? 'en';
}

export function translatePage(locale: Locale): void {
  const { copy } = messages[locale];
  document.documentElement.lang = locale;
  document.title = copy.gameTitle;
  for (const [keyAttribute, targetAttribute] of [
    ['data-i18n', null],
    ['data-i18n-label', 'aria-label'],
    ['data-i18n-title', 'title'],
  ] as const) {
    for (const node of document.querySelectorAll(`[${keyAttribute}]`)) {
      const key = node.getAttribute(keyAttribute) as keyof typeof copy;
      if (targetAttribute) node.setAttribute(targetAttribute, copy[key]);
      else node.textContent = copy[key];
    }
  }
}
