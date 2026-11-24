/** Each species from the side (100 by 60, looking right, in the current colour). */
export const BUGS: Record<string, string> = {
  ant: '<g stroke="currentColor" stroke-width="3.4" fill="none"><path d="M40 32 28 50l-6 6M48 34v22M56 34l14 22M42 28 30 14M50 28l2-18M58 28l14-16M78 24l14-12M80 28l16-6"/></g><g fill="currentColor"><ellipse cx="24" cy="32" rx="18" ry="12"/><ellipse cx="50" cy="31" rx="11" ry="7"/><circle cx="74" cy="30" r="11"/></g>',
  spider: '<g stroke="currentColor" stroke-width="3.4" fill="none"><path d="M46 28 30 8 14 20M44 32 22 20 6 38M44 36H22L10 54M48 38l-16 8-6 12M58 28 72 8l16 12M60 32l20-12 16 18M60 36h20l12 18M56 38l14 8 6 12"/></g><g fill="currentColor"><circle cx="42" cy="34" r="17"/><circle cx="64" cy="34" r="10"/></g>',
  cockroach: '<g stroke="currentColor" stroke-width="3.4" fill="none"><path d="M36 36 22 56M50 38l-2 18M64 36l14 18M36 24 22 6M52 22l2-18M66 24 80 8M82 26c8-8 12-16 16-22M84 32c8 0 12-4 15-8"/></g><g fill="currentColor"><ellipse cx="44" cy="30" rx="36" ry="15"/><circle cx="80" cy="30" r="9"/></g>',
};

/** The weapons (48 by 48, in the current colour; `b` is the dark). */
export const ARMS: Record<string, string> = {
  // a drop of solder, flung
  'solder-blob': '<path fill="currentColor" d="M29 9c9 9 12 15 9 22-3 8-14 11-21 5s-6-15 0-19c4-3 8-4 12-8z"/><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M4 30l6-2M5 39l8-3M9 20l4 1"/><path fill="none" stroke="var(--b)" stroke-width="3" stroke-linecap="round" d="M20 30c1 3 3 5 6 5"/>',
  // a can with a stripe and two legs, bulging
  capacitor: '<path fill="currentColor" d="M13 11q11-8 22 0v24H13z"/><path fill="var(--b)" d="M28 9.5h4V35h-4z"/><path stroke="currentColor" stroke-width="3.4" stroke-linecap="round" d="M19 36v8M29 36v8"/><path stroke="var(--b)" stroke-width="2.4" d="M17 22h7M20.500 18.500v7"/>',
  // a bolt between two points
  'short-circuit': '<path fill="currentColor" d="M29 3 10 27h10l-5 18 22-27H25z"/><circle cx="7" cy="9" r="3.400" fill="currentColor"/><circle cx="41" cy="39" r="3.400" fill="currentColor"/>',
  // a soldering iron, hot at its tip
  'soldering-iron': '<path fill="currentColor" d="m27 14 7 7-4 4-7-7zM33 5l10 10-7 7-10-10z"/><path stroke="currentColor" stroke-width="4" stroke-linecap="round" d="M25 23 12 36"/><path fill="currentColor" d="M12 33 5 43l10-7z"/><path fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" d="M6 33c-3-3 0-5-2-8M13 43c3 2 5 0 8 2"/>',
  // a web
  'web-shot': '<path fill="none" stroke="currentColor" stroke-width="2.600" d="M24 4v40M4 24h40M10 10l28 28M38 10 10 38"/><path fill="none" stroke="currentColor" stroke-width="2.600" d="M24 12 33 15 36 24 33 33 24 36 15 33 12 24 15 15z"/><circle cx="24" cy="24" r="4.500" fill="currentColor"/>',
};
