import { GameAudio } from '@/audio';
import { createRound, DIFFICULTIES, type Round } from '@/game';
import { describeToy, isLocale, messages, readLanguageChoice, resolveLocale, saveLanguageChoice, translatePage, type Locale } from '@/locale';
import { RoomView, type CameraAction } from '@/room';
import { ToyModel } from '@/toy';
import '@/styles.css';

type Difficulty = keyof typeof DIFFICULTIES;

const BEST_TIME_PREFIX = 'labubu-lookalike:best:';

function formatTime(milliseconds: number) {
  const tenths = Math.floor(milliseconds / 100);
  const minutes = String(Math.floor(tenths / 600)).padStart(2, '0');
  const seconds = String(Math.floor(tenths / 10) % 60).padStart(2, '0');
  return `${minutes}:${seconds}.${tenths % 10}`;
}

class GameController {
  private readonly targetToy = document.getElementById('target-toy')!;
  private readonly targetDescription = document.getElementById('target-description')!;
  private readonly board = document.getElementById('board')!;
  private readonly timer = document.getElementById('timer')!;
  private readonly missesDisplay = document.getElementById('misses')!;
  private readonly best = document.getElementById('best')!;
  private readonly count = document.getElementById('count')!;
  private readonly roundDisplay = document.getElementById('round-number')!;
  private readonly status = document.getElementById('status')!;
  private readonly restart = document.querySelector<HTMLButtonElement>('#restart')!;
  private readonly soundToggle = document.querySelector<HTMLButtonElement>('#sound-toggle')!;
  private readonly result = document.getElementById('result')!;
  private readonly resultTime = document.getElementById('result-time')!;
  private readonly resultMisses = document.getElementById('result-misses')!;
  private readonly playAgain = document.querySelector<HTMLButtonElement>('#play-again')!;
  private readonly cameraButtons = document.querySelectorAll<HTMLButtonElement>('button[data-camera]');
  private readonly touchPan = document.querySelector<HTMLButtonElement>('#touch-pan')!;
  private readonly difficultyButtons = (Object.keys(DIFFICULTIES) as Difficulty[]).map(mode => [
    mode,
    document.querySelector<HTMLButtonElement>(`button[data-difficulty="${mode}"]`)!,
  ] as const);
  private readonly bestTimes = new Map<Difficulty, number>();
  private readonly audio = new GameAudio();
  private readonly room: RoomView;

  private difficulty: Difficulty = 'normal';
  private round!: Round;
  private roundNumber = 0;
  private startedAt = 0;
  private ticker: number | undefined;
  private tileButtons: HTMLButtonElement[] = [];
  private tabIndex = 0;
  private completed: { time: string; record: boolean } | undefined;

  static async boot() {
    const loading = document.getElementById('room-loading')!;
    const languagePicker = document.querySelector<HTMLSelectElement>('#language-picker')!;
    let choice = readLanguageChoice();
    let locale = resolveLocale(choice);
    let game: GameController | undefined;
    let loadingText: 'loading' | 'modelError' | 'roomError' = 'loading';
    const displayLoading = () => {
      loading.textContent = messages[locale].copy[loadingText];
    };
    const applyLanguage = (next = resolveLocale(choice)) => {
      locale = next;
      translatePage(locale);
      if (game) game.setLocale(locale);
      else displayLoading();
    };
    languagePicker.value = choice;
    languagePicker.addEventListener('change', () => {
      const selected = languagePicker.value;
      choice = isLocale(selected) ? selected : 'auto';
      saveLanguageChoice(choice);
      applyLanguage();
    });
    window.addEventListener('languagechange', () => {
      if (choice === 'auto') applyLanguage();
    });
    applyLanguage(locale);

    let model: ToyModel;
    try {
      model = await ToyModel.load();
    } catch (error) {
      console.error('Could not load the Labubu model.', error);
      loadingText = 'modelError';
      displayLoading();
      return;
    }

    try {
      game = new GameController(model, locale);
    } catch (error) {
      console.error('Could not start the 3D room.', error);
      loadingText = 'roomError';
      displayLoading();
      return;
    }
    loading.hidden = true;
  }

  private constructor(model: ToyModel, private locale: Locale) {
    this.room = new RoomView(document.getElementById('room-view')!, this.targetToy, model, index => this.pickTile(index));
    for (const [mode] of this.difficultyButtons) {
      const best = this.readBest(mode);
      if (best !== undefined) this.bestTimes.set(mode, best);
    }
    this.startRound();

    for (const [mode, button] of this.difficultyButtons) {
      button.disabled = false;
      button.addEventListener('click', () => {
        if (mode === this.difficulty) return;
        this.difficulty = mode;
        this.startRound();
      });
    }

    for (const button of this.cameraButtons) {
      const action = button.dataset.camera as CameraAction;
      button.addEventListener('click', () => this.room.moveCamera(action));
      button.disabled = false;
    }
    this.touchPan.disabled = false;
    this.touchPan.addEventListener('click', () => {
      const pan = this.touchPan.getAttribute('aria-pressed') !== 'true';
      this.room.setTouchMode(pan ? 'pan' : 'orbit');
      this.touchPan.setAttribute('aria-pressed', String(pan));
    });

    this.soundToggle.disabled = false;
    this.restart.disabled = false;
    this.soundToggle.setAttribute('aria-pressed', String(this.audio.enabled));
    this.soundToggle.addEventListener('click', () => {
      this.soundToggle.setAttribute('aria-pressed', String(this.audio.toggle()));
    });
    this.restart.addEventListener('click', () => this.startRound());
    this.playAgain.addEventListener('click', () => {
      const restoreFocus = document.activeElement === this.playAgain;
      this.startRound();
      if (restoreFocus) this.tileButtons[0]?.focus();
    });
    this.board.addEventListener('click', event => {
      const { target } = event;
      const tile = target instanceof Element ? target.closest<HTMLButtonElement>('button[data-index]') : null;
      if (tile) this.pickTile(Number(tile.dataset.index), event.detail === 0);
    });
    this.board.addEventListener('keydown', event => this.navigateTiles(event));

    this.board.addEventListener('focusin', event => {
      if (!(event.target instanceof HTMLButtonElement)) return;
      const index = Number(event.target.dataset.index);
      this.tileButtons[this.tabIndex]!.tabIndex = -1;
      event.target.tabIndex = 0;
      this.tabIndex = index;
      this.room.focusTile(index);
    });
    this.board.addEventListener('focusout', event => {
      const next = event.relatedTarget;
      if (!(next instanceof Node && this.board.contains(next))) this.room.focusTile(null);
    });
  }

  private setLocale(locale: Locale) {
    if (locale === this.locale) return;
    this.locale = locale;
    this.targetDescription.textContent = describeToy(this.round.target, locale);
    for (const [index, tile] of this.tileButtons.entries()) {
      tile.textContent = describeToy(this.round.tiles[index], locale);
      this.displayTileMark(tile);
    }
    this.displayStatus();
  }

  private displayTileMark(tile: HTMLButtonElement) {
    const { match, wrong } = messages[this.locale].copy;
    const text = tile.classList.contains('is-match') ? match : tile.classList.contains('is-wrong') ? wrong : null;
    if (text) tile.setAttribute('aria-label', `${tile.textContent}. ${text}`);
  }

  private displayStatus() {
    const { finished, missed, roundStarted } = messages[this.locale];
    const misses = this.round.misses;
    this.status.textContent = this.completed
      ? finished(this.completed.time, misses, this.completed.record)
      : misses > 0 ? missed(misses) : roundStarted(this.roundNumber, this.tileButtons.length);
  }

  private readBest(mode: Difficulty) {
    try {
      const saved = localStorage.getItem(`${BEST_TIME_PREFIX}${mode}`);
      const milliseconds = Number(saved);
      if (saved && Number.isSafeInteger(milliseconds) && milliseconds >= 0) return milliseconds;
    } catch {
      // Scores can still be kept for this visit if storage is unavailable.
    }
    return undefined;
  }

  private saveBest(milliseconds: number) {
    this.bestTimes.set(this.difficulty, milliseconds);
    try {
      localStorage.setItem(`${BEST_TIME_PREFIX}${this.difficulty}`, String(milliseconds));
    } catch {
      // The in-memory best remains available.
    }
  }

  private displayBest() {
    const milliseconds = this.bestTimes.get(this.difficulty);
    this.best.textContent = milliseconds === undefined ? '—' : formatTime(milliseconds);
  }

  private startRound() {
    this.audio.stop();
    window.clearInterval(this.ticker);
    this.round = createRound(this.difficulty);
    this.roundNumber += 1;
    this.completed = undefined;

    this.result.hidden = true;
    this.room.showRound(this.round.target, this.round.tiles);
    this.targetDescription.textContent = describeToy(this.round.target, this.locale);

    this.tabIndex = 0;
    this.tileButtons = [];
    const items = document.createDocumentFragment();
    for (const [index, variant] of this.round.tiles.entries()) {
      const item = document.createElement('li');
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.dataset.index = String(index);
      tile.tabIndex = index === 0 ? 0 : -1;
      tile.textContent = describeToy(variant, this.locale);
      this.tileButtons.push(tile);
      item.append(tile);
      items.append(item);
    }
    this.board.replaceChildren(items);

    this.timer.textContent = formatTime(0);
    this.missesDisplay.textContent = String(this.round.misses);
    this.count.textContent = String(this.tileButtons.length);
    this.roundDisplay.textContent = String(this.roundNumber).padStart(2, '0');
    this.displayBest();
    for (const [mode, button] of this.difficultyButtons) {
      button.setAttribute('aria-pressed', String(mode === this.difficulty));
    }
    this.displayStatus();

    this.startedAt = performance.now();
    this.ticker = window.setInterval(() => {
      this.timer.textContent = formatTime(performance.now() - this.startedAt);
    }, 100);
  }

  private pickTile(index: number, fromKeyboard = false) {
    const tile = this.tileButtons[index];
    if (!tile) return;
    const outcome = this.round.guess(index);
    if (outcome === 'ignored') return;

    this.room.markTile(index, outcome);
    tile.classList.add(`is-${outcome}`);
    this.displayTileMark(tile);
    if (outcome === 'match') {
      this.finishRound(tile, fromKeyboard);
      this.audio.play('match');
    } else {
      tile.setAttribute('aria-disabled', 'true');
      this.missesDisplay.textContent = String(this.round.misses);
      this.displayStatus();
      this.audio.play('miss');
    }
  }

  private finishRound(tile: HTMLButtonElement, fromKeyboard: boolean) {
    const milliseconds = Math.floor(performance.now() - this.startedAt);
    window.clearInterval(this.ticker);
    for (const button of this.tileButtons) button.setAttribute('aria-disabled', 'true');

    const previousBest = this.bestTimes.get(this.difficulty);
    const isRecord = previousBest === undefined || milliseconds < previousBest;
    if (isRecord) {
      this.saveBest(milliseconds);
      this.displayBest();
    }

    const time = formatTime(milliseconds);
    this.timer.textContent = time;
    this.resultTime.textContent = time;
    this.resultMisses.textContent = String(this.round.misses);
    this.result.hidden = false;
    this.completed = { time, record: isRecord };
    this.displayStatus();
    if (fromKeyboard && document.activeElement === tile) this.playAgain.focus();
  }

  private navigateTiles(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const { key } = event;
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') return;
    const tile = event.target;
    if (!(tile instanceof HTMLButtonElement)) return;

    const index = Number(tile.dataset.index);
    let next: number;
    switch (key) {
      case 'ArrowUp': next = index - 1; break;
      case 'ArrowDown': next = index + 1; break;
      case 'Home': next = 0; break;
      case 'End': next = this.tileButtons.length - 1; break;
    }

    event.preventDefault();
    this.tileButtons[next]?.focus();
  }
}

void GameController.boot();
