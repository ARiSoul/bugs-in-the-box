import type { SoundEngine } from '../audio/SoundEngine';

/** The sound settings in the menu (kept in the browser by the engine); returns the mute key's action. */
export function setupSoundMenu(engine: SoundEngine): () => void {
  const volume = document.getElementById('volume') as HTMLInputElement;
  const room = document.getElementById('roomVolume') as HTMLInputElement;
  const mute = document.getElementById('mute') as HTMLButtonElement;
  const s = engine.settings;
  const show = (): void => {
    mute.textContent = s.muted ? 'sound: off' : 'sound: on';
    mute.classList.toggle('on', s.muted);
  };
  volume.value = String(Math.round(s.volume * 100));
  room.value = String(Math.round(s.room * 100));
  show();
  volume.addEventListener('input', () => {
    s.volume = Number(volume.value) / 100;
    engine.apply();
  });
  room.addEventListener('input', () => {
    s.room = Number(room.value) / 100;
    engine.apply();
  });
  // (the keys are the game's again, and a change of volume is heard)
  for (const el of [volume, room])
    el.addEventListener('change', () => {
      el.blur();
      if (el === volume) engine.play('turn');
    });
  const toggle = (): void => {
    s.muted = !s.muted;
    engine.apply();
    show();
  };
  mute.addEventListener('click', () => {
    toggle();
    mute.blur();
  });
  return toggle;
}
