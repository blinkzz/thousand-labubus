const SOUND_SETTING = 'labubu-lookalike:sound';
const SOUND_FILES = {
  miss: new URL('./assets/miss.mp3', import.meta.url).href,
  match: new URL('./assets/match.mp3', import.meta.url).href,
};

type Sound = keyof typeof SOUND_FILES;

export class GameAudio {
  private soundEnabled = true;
  private readonly clips: Partial<Record<Sound, HTMLAudioElement>> = {};
  private active: HTMLAudioElement | undefined;

  constructor() {
    try {
      this.soundEnabled = window.localStorage.getItem(SOUND_SETTING) !== 'off';
    } catch {
      // Keep the default when storage is unavailable.
    }
  }

  get enabled() {
    return this.soundEnabled;
  }

  toggle() {
    this.soundEnabled = !this.soundEnabled;
    if (!this.soundEnabled) this.stop();
    try {
      window.localStorage.setItem(SOUND_SETTING, this.soundEnabled ? 'on' : 'off');
    } catch {
      // The setting still applies for this page visit.
    }
    return this.soundEnabled;
  }

  play(sound: Sound) {
    if (!this.soundEnabled) return;
    this.stop();
    try {
      const clip = this.clips[sound] ??= new Audio(SOUND_FILES[sound]);
      this.active = clip;
      clip.currentTime = 0;
      void clip.play().catch(() => {});
    } catch {
      // Audio is optional; an unavailable clip must not interrupt the game.
    }
  }

  stop() {
    const clip = this.active;
    this.active = undefined;
    try {
      clip?.pause();
    } catch {
      // Leave the game usable if the browser cannot control playback.
    }
  }
}
