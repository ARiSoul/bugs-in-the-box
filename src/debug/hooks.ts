/**
 * Repeatable debug hooks from the URL, shared by every map (none of them is scenario-specific):
 *
 *   ?pose=1..6        freeze the camera on one of the scenario's fixed poses (7+: extra detail poses, if any)
 *   ?flythrough=1     fly the scenario's scripted 60 s camera path (loops)
 *   ?fly=1            free debug camera (WASD, Q/E, mouse look, Shift/Ctrl, wheel, R)
 *   ?perf=1           log frame times (and GPU time where the renderer has timestamps); export JSON
 *   ?res=2560x1440    fixed drawing-buffer size, whatever the window (for measurements and captures)
 *   ?hud=0|1          hide or show the HUD (hidden by default in pose / fly-through modes)
 *
 * These sit next to ?scenario=, ?map= and ?mesh=. With a pose, the fly-through or the free camera the
 * game camera is off and the match does not take input; the map, its seed and the match are the same.
 */
export interface DebugHooks {
  /** 1..6, or 0 for none. */
  pose: number;
  flythrough: boolean;
  fly: boolean;
  perf: boolean;
  fixedSize: [number, number] | null;
  hud: boolean;
}

export function readHooks(params: URLSearchParams): DebugHooks {
  const pose = Math.max(0, Math.min(16, Number(params.get('pose') ?? 0) | 0));
  const flythrough = params.get('flythrough') === '1';
  const fly = params.get('fly') === '1';
  const res = (params.get('res') ?? '').match(/^(\d{3,4})x(\d{3,4})$/);
  const hudParam = params.get('hud');
  return {
    pose,
    flythrough,
    fly,
    perf: params.get('perf') === '1',
    fixedSize: res ? [Number(res[1]), Number(res[2])] : null,
    hud: hudParam === null ? !(pose > 0 || flythrough) : hudParam === '1',
  };
}

/** True when a debug camera replaces the game camera. */
export function usesDebugCamera(h: DebugHooks): boolean {
  return h.pose > 0 || h.flythrough || h.fly;
}
