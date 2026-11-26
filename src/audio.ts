const SOUND_SETTING = 'labubu-lookalike:sound';
const SOUND_FILES = {
  miss: new URL('./assets/miss.mp3', import.meta.url).href,
  match: new URL('./assets/match.mp3', import.meta.url).href,
};

type Sound = keyof typeof SOUND_FILES;

export class GameAudio {
  private soundEnabled = true;
  private active: HTMLAudioElement | undefined;

  private constructor(private readonly clips: Record<Sound, HTMLAudioElement>) {
    try {
      this.soundEnabled = window.localStorage.getItem(SOUND_SETTING) !== 'off';
    } catch {
      // Keep the default when storage is unavailable.
    }
  }

  static async load(): Promise<GameAudio> {
    const fetchClip = async (sound: Sound) => {
      const response = await fetch(SOUND_FILES[sound]);
      if (!response.ok) throw new Error(`Could not fetch the ${sound} sound (HTTP ${response.status}).`);
      return response.blob();
    };
    const [miss, match] = await Promise.all([fetchClip('miss'), fetchClip('match')]);
    // The bytes are already local even if the browser defers media preparation.
    const prepare = (blob: Blob) => {
      const clip = new Audio();
      clip.preload = 'auto';
      clip.src = URL.createObjectURL(blob);
      clip.load();
      return clip;
    };
    return new GameAudio({ miss: prepare(miss), match: prepare(match) });
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
    const clip = this.clips[sound];
    this.active = clip;
    if (clip.currentTime !== 0) clip.currentTime = 0;
    // Call native playback inside the pick gesture; the browser applies its autoplay policy.
    void clip.play().catch(error => {
      if (error.name !== 'AbortError') console.warn('Could not play the sound effect.', error);
    });
  }

  stop() {
    this.active?.pause();
    this.active = undefined;
  }

  close() {
    this.stop();
    for (const clip of Object.values(this.clips)) {
      URL.revokeObjectURL(clip.src);
      clip.removeAttribute('src');
      clip.load();
    }
  }
}
