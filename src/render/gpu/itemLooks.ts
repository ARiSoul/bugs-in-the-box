import type { ItemKind } from '../../game/items';

/** Each item's colour, name and emblem (48 by 48 path data, filled). */
export const ITEM_LOOKS: Readonly<Record<ItemKind, { color: string; name: string; path: string }>> = {
  battery: { color: '#8bd450', name: 'Battery', path: 'M18 4h12v5h5v35H13V9h5zM25 14l-8 14h6l-2 11 9-15h-6z' },
  patch: { color: '#ff7fa5', name: 'Flux patch', path: 'M18 6h12v12h12v12H30v12H18V30H6V18h12z' },
  fuse: { color: '#6db4ff', name: 'Fuse', path: 'M10 12h28v18H10zM13 30h6v12h-6zM29 30h6v12h-6z' },
  overclock: { color: '#ff8a4c', name: 'Overclock', path: 'M14 14h20v20H14zM18 4h4v8h-4zM26 4h4v8h-4zM18 36h4v8h-4zM26 36h4v8h-4zM4 18h8v4H4zM4 26h8v4H4zM36 18h8v4h-8zM36 26h8v4h-8z' },
  spring: { color: '#5fdcb0', name: 'Springs', path: 'M12 40l24-5v-4l-20-4 20-4v-4l-20-4 20-4V7l-24 5v4l20 3-20 4v4l20 4-20 5z' },
  paste: { color: '#c3ccd8', name: 'Thermal paste', path: 'M6 36q4-24 18-26 16 4 18 26z' },
  crystal: { color: '#ffd45a', name: 'Spare crystal', path: 'M24 3l13 16-13 26-13-26z' },
  magnet: { color: '#ff5a5a', name: 'Magnet', path: 'M8 6h10v18a6 6 0 0 0 12 0V6h10v18a16 16 0 0 1-32 0z' },
  scrap: { color: '#d8d0c0', name: 'Scrap', path: 'M8 12h20v28H8zM18 6h20v28h-6V10H18z' },
  dud: { color: '#ffb547', name: 'Dud!', path: 'M22 16a14 14 0 1 0 8 0l6-9-4-3z' },
};
