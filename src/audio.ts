const SOUND_SETTING = 'labubu-lookalike:sound';
const SOUND_FILES = {
  miss: new URL('./assets/miss.mp3', import.meta.url).href,
  match: new URL('./assets/match.mp3', import.meta.url).href,
};

type Sound = keyof typeof SOUND_FILES;

export class GameAudio {
  private soundEnabled = true;
  private active: AudioBufferSourceNode | undefined;
  private playback = 0;

  private constructor(
    private readonly context: AudioContext,
    private readonly clips: Record<Sound, AudioBuffer>,
  ) {
    try {
      this.soundEnabled = window.localStorage.getItem(SOUND_SETTING) !== 'off';
    } catch {
      // Keep the default when storage is unavailable.
    }
  }

  static async load(): Promise<GameAudio> {
    const context = new AudioContext();
    const loadClip = async (sound: Sound) => {
      const response = await fetch(SOUND_FILES[sound]);
      if (!response.ok) throw new Error(`Could not fetch the ${sound} sound (HTTP ${response.status}).`);
      return context.decodeAudioData(await response.arrayBuffer());
    };
    try {
      const [miss, match] = await Promise.all([loadClip('miss'), loadClip('match')]);
      return new GameAudio(context, { miss, match });
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
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

  play(sound: Sound, trusted: boolean) {
    if (!trusted || !this.soundEnabled) return;
    this.stop();
    if (this.context.state === 'running') {
      this.start(sound);
      return;
    }
    const playback = this.playback;
    // Request resume in the gesture handler, but don't play a superseded guess after it resolves.
    void this.context.resume().then(() => {
      if (playback === this.playback && this.context.state === 'running') this.start(sound);
    }).catch(error => console.warn('Could not play the sound effect.', error));
  }

  private start(sound: Sound) {
    const clip = this.context.createBufferSource();
    clip.buffer = this.clips[sound];
    clip.connect(this.context.destination);
    clip.onended = () => {
      if (this.active === clip) this.active = undefined;
      clip.disconnect();
    };
    clip.start();
    this.active = clip;
  }

  stop() {
    this.playback++;
    const clip = this.active;
    if (!clip) return;
    this.active = undefined;
    clip.onended = null;
    clip.stop();
    clip.disconnect();
  }

  close() {
    this.stop();
    void this.context.close().catch(() => {});
  }
}
