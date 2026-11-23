import { ACTIONS, keyName, type Controls } from '../input/controls';

const el = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
};

/**
 * The key settings in the menu: one row per action with its key; click it, then press the new key
 * (Escape keeps the old one). Saved in the browser by `Controls`. Also writes the help line.
 */
export function setupKeysMenu(controls: Controls): void {
  const list = el('keyList');
  const hint = el('hint');
  const reset = el<HTMLButtonElement>('keyReset');

  const render = (): void => {
    const k = (action: Parameters<Controls['keysOf']>[0]): string => keyName(controls.keysOf(action)[0]);
    hint.textContent =
      `${k('forward')}/${k('back')} walk · ${k('run')} run · ${k('left')}/${k('right')} or ←/→ turn · ${k('jump')} jump · ` +
      `${k('aimUp')}/${k('aimDown')} aim (tap for fine steps) · hold ${k('fire')} to charge, release to fire · 1–5 weapon · ` +
      'N new match · right drag to turn the view (the bug turns with it; A/D turn it too) · scroll to zoom';
    list.replaceChildren(
      ...ACTIONS.flatMap(({ action, label }) => {
        const name = document.createElement('span');
        name.textContent = label;
        const button = document.createElement('button');
        button.textContent = keyName(controls.keysOf(action)[0]);
        button.title = 'click, then press the new key (Escape: keep this one)';
        button.addEventListener('click', () => {
          button.textContent = 'press a key…';
          button.classList.add('waiting');
          controls.captureNextKey((code) => {
            if (code !== 'Escape' && !controls.rebind(action, code)) {
              button.textContent = `${keyName(code)} is taken by the game`;
              setTimeout(render, 1200);
              return;
            }
            render();
          });
          button.blur();
        });
        return [name, button];
      }),
    );
  };

  reset.addEventListener('click', () => {
    controls.resetKeys();
    render();
    reset.blur();
  });
  render();
}
