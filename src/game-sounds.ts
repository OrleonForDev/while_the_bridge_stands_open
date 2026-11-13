const files = {
  order: "click_001.ogg",
  turn: "confirmation_001.ogg",
  closure: "switch_001.ogg",
} as const;

type SoundCue = keyof typeof files;

export class GameSounds {
  enabled = false;
  private readonly clips = new Map<SoundCue, HTMLAudioElement>();
  private active: HTMLAudioElement | undefined;

  play(cue: SoundCue) {
    if (!this.enabled) return;
    this.stop();

    let clip = this.clips.get(cue);
    if (!clip) {
      clip = new Audio(import.meta.env.BASE_URL + "assets/kenney/" + files[cue]);
      clip.volume = 0.22;
      this.clips.set(cue, clip);
    }

    this.active = clip;
    void clip.play().catch(() => {
      // The map and turn summary already communicate the same events.
    });
  }

  stop() {
    if (!this.active) return;
    this.active.pause();
    this.active.currentTime = 0;
    this.active = undefined;
  }
}
