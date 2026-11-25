/** Each species from the side (100 by 60, looking right, in the current colour). */
export const BUGS: Record<string, string> = {
  ant: '<g stroke="currentColor" stroke-width="3.4" fill="none"><path d="M40 32 28 50l-6 6M48 34v22M56 34l14 22M42 28 30 14M50 28l2-18M58 28l14-16M78 24l14-12M80 28l16-6"/></g><g fill="currentColor"><ellipse cx="24" cy="32" rx="18" ry="12"/><ellipse cx="50" cy="31" rx="11" ry="7"/><circle cx="74" cy="30" r="11"/></g>',
  spider: '<g stroke="currentColor" stroke-width="3.4" fill="none"><path d="M46 28 30 8 14 20M44 32 22 20 6 38M44 36H22L10 54M48 38l-16 8-6 12M58 28 72 8l16 12M60 32l20-12 16 18M60 36h20l12 18M56 38l14 8 6 12"/></g><g fill="currentColor"><circle cx="42" cy="34" r="17"/><circle cx="64" cy="34" r="10"/></g>',
  bee: '<g stroke="currentColor" stroke-width="3.400" fill="none"><path d="M52 40l-6 14M62 41l2 14M70 38l10 14M84 24c4-8 8-10 13-10M82 22c2-9 5-12 9-15"/></g><g fill="currentColor"><path d="M8 33Q10 20 26 20v26Q12 46 8 33zM30 20q6-1 10 1v25q-5 1-10 0z"/><ellipse cx="56" cy="31" rx="14" ry="13"/><circle cx="78" cy="31" r="10"/><ellipse cx="40" cy="11" rx="20" ry="7" transform="rotate(14 40 11)" opacity=".7"/></g>',
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
  // a smear
  'thermal-paste': '<path fill="currentColor" d="M5 37c2-9 8-8 9-15S20 9 27 12s3 9 8 11 9 4 8 14z"/><path fill="none" stroke="var(--b)" stroke-width="2.600" d="M13 32c6-5 14 3 22-3M20 23c4-3 7 0 10-2"/>',
  // splinters side by side on a bank
  rampart: '<path fill="currentColor" d="M5 34V14l4-8 4 8v20zM14.500 34V10l4-8 4 8v24zM24 34V13l4-8 4 8v21zM33.500 34V10l4-8 5 9v23z"/><path fill="currentColor" d="M1 44q5-9 23-9t23 9z"/><path stroke="var(--b)" stroke-width="1.800" d="M9 14v16M18.500 12v18M28 14v16M38 13v17"/>',
  // ants in a chain over a gap
  'living-bridge': '<path fill="currentColor" d="M1 26h9v18H1zM38 26h9v18h-9z"/><g fill="currentColor"><circle cx="13" cy="22" r="3.600"/><circle cx="19" cy="19" r="2.800"/><circle cx="24" cy="18" r="3.600"/><circle cx="29" cy="19" r="2.800"/><circle cx="35" cy="22" r="3.600"/></g><path fill="none" stroke="currentColor" stroke-width="1.800" d="M11 18 8 13M16 16l-2-5M22 14l-2-6M26 14l2-6M32 16l2-5M37 18l3-5M14 26l-2 5M24 22v7M34 26l2 5"/>',
  // a hill with a door, eyes in it
  anthill: '<path fill="currentColor" d="M2 43q6-5 9-18Q14 6 24 6t13 19q3 13 9 18z"/><path fill="var(--b)" d="M15 43V31a9 9 0 0 1 18 0v12z"/><circle cx="20.500" cy="33" r="2.600" fill="currentColor"/><circle cx="27.500" cy="33" r="2.600" fill="currentColor"/>',
  // a curtain between posts
  'silk-curtain': '<path fill="currentColor" d="M3 8h4v36H3zM22 5h4v39h-4zM41 8h4v36h-4z"/><path fill="none" stroke="currentColor" stroke-width="2.200" d="M7 11q7 8 15-3M26 8q8 11 15 3M7 19q7 8 15-1M26 18q8 9 15 1M7 28q7 7 15 0M26 28q8 7 15 0M7 37q7 5 15 0M26 37q8 5 15 0M12 15v28M17 14v29M31 14v29M36 15v28"/>',
  // a span of threads
  'silk-span': '<path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M2 14q22 20 44 0M2 30q22 14 44 0"/><path fill="none" stroke="currentColor" stroke-width="1.800" d="M7 18v15M13 22v14M19 24v14M24 24.500v14M29 24v14M35 22v14M41 18v15M2 14v16M46 14v16"/>',
  // a tent with a mouth, eyes in it
  'silk-funnel': '<path fill="currentColor" d="M3 43Q6 20 12 12l3-6 3 5q6-3 12 0l3-5 3 6q6 8 9 31z"/><circle cx="24" cy="31" r="10.500" fill="var(--b)"/><circle cx="20" cy="30" r="2.800" fill="currentColor"/><circle cx="28" cy="30" r="2.800" fill="currentColor"/><path stroke="currentColor" stroke-width="1.600" d="M2 43h44"/>',
  // shields, each over the next
  'shield-wall': '<g fill="currentColor" stroke="var(--b)" stroke-width="1.800"><ellipse cx="11" cy="33" rx="9" ry="12"/><ellipse cx="24" cy="33" rx="9" ry="12"/><ellipse cx="37" cy="33" rx="9" ry="12"/><ellipse cx="17.500" cy="16" rx="9" ry="12"/><ellipse cx="30.500" cy="16" rx="9" ry="12"/></g><g fill="var(--b)"><circle cx="14.500" cy="13" r="1.900"/><circle cx="20.500" cy="13" r="1.900"/><circle cx="27.500" cy="13" r="1.900"/><circle cx="33.500" cy="13" r="1.900"/></g>',
  // plates of a back, legs under them
  'scale-walk': '<path fill="currentColor" d="M3 18h8l1 12H2zM12.500 16h8l1 13h-9zM22 15h8l1 13h-9zM31.500 16h8l1 13h-9zM41 18h5l1 12h-6z"/><path fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" d="M9 31l-3 5 3 6M18 31l-2 5 3 6M28 31l2 5-3 6M38 31l3 5-3 6"/>',
  // a husk, eyes under it
  husk: '<path fill="currentColor" d="M2 41Q4 12 24 10q20 2 22 31h-8q-2-11-14-11T10 41z"/><path fill="none" stroke="var(--b)" stroke-width="2" d="M6 28q18-13 36 0M10 20q14-9 28 0"/><circle cx="20" cy="38" r="3" fill="currentColor"/><circle cx="28" cy="38" r="3" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.800" d="M18 11Q14 4 6 4M30 11q4-7 12-7"/>',
  // cells of a comb
  'comb-wall': '<path fill="currentColor" d="M14 4l8 4.600v9.300l-8 4.600-8-4.600V8.600zM34 4l8 4.600v9.300l-8 4.600-8-4.600V8.600zM24 22l8 4.600v9.300L24 40.500l-8-4.600v-9.300z"/><path fill="var(--b)" d="M34 8l4.500 2.600v5.200L34 18.400l-4.500-2.600v-5.200z"/>',
  // an arch of comb
  'comb-span': '<path fill="currentColor" d="M2 14h44v26h-7q-1-13-15-13T9 40H2z"/><path fill="var(--b)" d="M9 18.500l3-1.700 3 1.700V22l-3 1.700L9 22zM18 18.500l3-1.700 3 1.700V22l-3 1.700-3-1.700zM27 18.500l3-1.700 3 1.700V22l-3 1.700-3-1.700zM36 18.500l3-1.700 3 1.700V22l-3 1.700-3-1.700z"/>',
  // a nest with a door
  'wax-nest': '<path fill="currentColor" d="M3 43Q1 8 24 6q23 2 21 37z"/><path fill="var(--b)" d="M24 19l10 5.800v11.500L24 42l-10-5.700V24.800z"/><circle cx="20.500" cy="31" r="2.600" fill="currentColor"/><circle cx="27.500" cy="31" r="2.600" fill="currentColor"/><path fill="none" stroke="var(--b)" stroke-width="1.600" d="M24 7v8M14 11l3 6M34 11l-3 6M7 24l6 2M41 24l-6 2"/>',
  // a web
  'web-shot': '<path fill="none" stroke="currentColor" stroke-width="2.600" d="M24 4v40M4 24h40M10 10l28 28M38 10 10 38"/><path fill="none" stroke="currentColor" stroke-width="2.600" d="M24 12 33 15 36 24 33 33 24 36 15 33 12 24 15 15z"/><circle cx="24" cy="24" r="4.500" fill="currentColor"/>',
};
