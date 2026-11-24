import * as THREE from 'three/webgpu';
import { float, floor, mix, mx_noise_float, positionLocal, positionWorld, smoothstep, vec3, vertexColor } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Feature, SceneLayout } from '../../terrain/generators/types';
import { CAP_OUT, fullLayout, laptopLayout } from '../../terrain/generators/keyboards';
import type { Craters } from './craters';

/**
 * The desk scenario's render-only parts: screens with a picture (a capture of the game, a dark code editor,
 * a desert lock screen), keyboards' keycaps (one instanced mesh a keyboard), and the dusty black laminate
 * sheet over the desk tops.
 */

/** A texture of key legends: one 128-pixel cell per distinct label, white on clear. */
function legendAtlas(labels: string[]): { texture: THREE.CanvasTexture; cell: Map<string, number>; per: number } {
  const distinct = [...new Set(labels.filter((l) => l !== ''))];
  const per = Math.ceil(Math.sqrt(distinct.length));
  const size = 128;
  const c = document.createElement('canvas');
  c.width = per * size;
  c.height = per * size;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cell = new Map<string, number>();
  distinct.forEach((l, i) => {
    cell.set(l, i);
    const px = (i % per) * size + size / 2;
    const py = Math.floor(i / per) * size + size / 2;
    if (l.includes('\n')) {
      // (two legends: the shifted one small above, the plain one below)
      const [upper, lower] = l.split('\n');
      g.font = `600 36px "Segoe UI", Arial, sans-serif`;
      g.fillText(upper, px, py - 26);
      g.font = `600 46px "Segoe UI", Arial, sans-serif`;
      g.fillText(lower, px, py + 22);
      return;
    }
    const fontSize = l.length <= 1 ? 64 : l.length <= 3 ? 40 : 30;
    g.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`;
    g.fillText(l, px, py);
  });
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, cell, per };
}

export class DeskParts {
  private readonly group = new THREE.Group();
  private readonly pieces: THREE.Object3D[] = [];
  private readonly textures = new Map<string, THREE.Texture>();

  constructor(
    scene: THREE.Scene,
    private readonly craters: Craters,
  ) {
    scene.add(this.group);
  }

  setLayout(layout: SceneLayout): void {
    for (const p of this.pieces) {
      this.group.remove(p);
      p.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    }
    this.pieces.length = 0;
    for (const f of layout.features) {
      if (f.kind === 'screen') this.addScreen(f);
      else if (f.kind === 'keyboard') this.addKeyboard(f);
      else if (f.kind === 'dusty') this.addDusty(f);
      else if (f.kind === 'mouse') this.addMouse(f);
      else if (f.kind === 'speakerFront') this.addSpeakerFront(f);
      else if (f.kind === 'bottle') this.addBottle(f);
      else if (f.kind === 'foil') this.addFoil(f);
    }
  }

  /** Place a box-centred object: position, then the turn about the vertical (local +x to (cos, 0, sin)). */
  private place(o: THREE.Object3D, f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    o.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    o.rotation.order = 'YXZ';
    if (f.yaw) o.rotation.y = Math.atan2(-f.yaw[1], f.yaw[0]);
    // (a screen may also lean back, like a laptop's lid: `path` = [cos, sin] about its own x)
    if (f.kind === 'screen' && f.path.length === 2) o.rotation.x = Math.atan2(f.path[1], f.path[0]);
  }

  private addScreen(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    const look = f.look ?? 'off';
    // (off, a screen stays near-black from the front: a matte coat, little of the room in it)
    const glass = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: 0x020203, metalness: 0, roughness: 0.85 }));
    if (look === 'game' || look === 'editor' || look === 'desert' || look === 'movie' || look === 'desktop') {
      const tex = this.texture(look);
      glass.color = new THREE.Color(0x000000);
      glass.emissiveMap = tex;
      glass.emissive = new THREE.Color(0xffffff);
      glass.emissiveIntensity = 0.55;
    }
    const g = new THREE.Group();
    this.place(g, f);
    const R = f.radius;
    if (R > 0) {
      // a curved panel, concave towards the viewer: the picture on the inside of a cylinder of radius R
      // whose axis stands R in front of the panel; the bezel's shell behind it, its rims and ends
      glass.side = THREE.BackSide;
      const theta = w / R;
      const start = Math.PI - theta / 2;
      // (seen from inside the cylinder, its u runs right to left: flipped, so the picture reads the right way)
      const panel = new THREE.CylinderGeometry(R, R, h, 48, 1, true, start, theta);
      const puv = panel.getAttribute('uv');
      for (let i = 0; i < puv.count; i++) puv.setX(i, 1 - puv.getX(i));
      const screen = new THREE.Mesh(panel, glass);
      screen.position.z = R;
      const bezel = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: 0.1, roughness: 0.4 }));
      const lip = 0.7;
      // (a chin: more bezel under the picture than over it)
      const chin = f.chin ?? 0;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.2, R + 1.2, h + 2 * lip + chin, 48, 1, true, start - lip / R, theta + (2 * lip) / R), bezel);
      shell.position.set(0, -chin / 2, R);
      const frame = new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: 0.1, roughness: 0.4, side: THREE.DoubleSide });
      for (const y of [h / 2 + lip, -h / 2 - lip - chin]) {
        // (a ring's angle runs from +x towards -z once laid flat; the cylinder's from +z towards +x: a quarter less)
        const rim = new THREE.Mesh(new THREE.RingGeometry(R - 0.05, R + 1.2, 48, 1, start - lip / R - Math.PI / 2, theta + (2 * lip) / R), frame);
        rim.rotation.x = -Math.PI / 2;
        rim.position.set(0, y, R);
        g.add(rim);
      }
      for (const [y, bh] of [[h / 2 + lip / 2, lip], [-h / 2 - (lip + chin) / 2, lip + chin]]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.03, R - 0.03, bh, 48, 1, true, start - lip / R, theta + (2 * lip) / R), frame);
        band.position.set(0, y, R);
        g.add(band);
      }
      for (const sgn of [-1, 1]) {
        const a = start + theta / 2 + sgn * (theta / 2 + lip / R);
        const end = new THREE.Mesh(new THREE.BoxGeometry(1.25, h + 2 * lip + chin, 0.2), frame);
        end.position.set(Math.sin(a) * (R + 0.6), -chin / 2, R + Math.cos(a) * (R + 0.6));
        end.rotation.y = a + Math.PI / 2;
        g.add(end);
      }
      if (f.trim) {
        // (a coloured trim along the lower bezel's front, its middle 60%)
        const trim = new THREE.Mesh(
          new THREE.CylinderGeometry(R - 0.08, R - 0.08, lip * 0.22, 64, 1, true, start + theta * 0.2, theta * 0.6),
          new THREE.MeshStandardNodeMaterial({ color: f.trim, metalness: 0.3, roughness: 0.4, side: THREE.BackSide }),
        );
        trim.position.set(0, -h / 2 - lip * 0.86 - chin, R);
        g.add(trim);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshStandardNodeMaterial({ color: 0xffffff, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1.5 }));
        led.position.set(0, -h / 2 - lip * 0.45 - chin, 0.08);
        g.add(led);
      }
      shell.castShadow = true;
      g.add(screen, shell);
    } else {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass);
      mesh.position.z = d / 2 + 0.02;
      g.add(mesh);
    }
    this.push(g);
  }

  /** The picture on a screen: a capture of the game, or one drawn on a canvas (an editor, a desert). */
  private texture(look: 'game' | 'editor' | 'desert' | 'movie' | 'desktop'): THREE.Texture {
    let t = this.textures.get(look);
    if (t) return t;
    if (look === 'game') {
      t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/screen-game.jpg`);
    } else {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 512;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      if (look === 'editor') {
        // a dark editor: a side bar, a tab strip, and lines of coloured "code" (blocks, no text)
        g.fillStyle = '#1b1830';
        g.fillRect(0, 0, 1024, 512);
        g.fillStyle = '#13111f';
        g.fillRect(0, 0, 150, 512);
        g.fillStyle = '#24203d';
        g.fillRect(150, 0, 874, 26);
        const colours = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#a6accd'];
        let seed = 7;
        const rnd = (): number => {
          seed = (seed * 16807) % 2147483647;
          return seed / 2147483647;
        };
        for (let y = 40; y < 500; y += 14) {
          let x = 170 + Math.floor(rnd() * 4) * 20;
          const n = 2 + Math.floor(rnd() * 5);
          for (let k = 0; k < n && x < 980; k++) {
            const w = 20 + rnd() * 90;
            g.fillStyle = colours[Math.floor(rnd() * colours.length)];
            g.fillRect(x, y, w, 7);
            x += w + 9;
          }
        }
        for (let y = 40; y < 500; y += 22) {
          g.fillStyle = '#4a4466';
          g.fillRect(16, y, 40 + rnd() * 80, 8);
        }
      } else if (look === 'movie') {
        // a film playing full screen: letterbox bars, a city at dusk under a teal sky with warm windows, the
        // player's thin progress bar (no faces, no text)
        g.fillStyle = '#000000';
        g.fillRect(0, 0, 1024, 512);
        const sky = g.createLinearGradient(0, 50, 0, 430);
        sky.addColorStop(0, '#0f2a3a');
        sky.addColorStop(0.55, '#2d5c66');
        sky.addColorStop(1, '#d08a4c');
        g.fillStyle = sky;
        g.fillRect(0, 50, 1024, 380);
        let seed = 11;
        const rnd = (): number => {
          seed = (seed * 16807) % 2147483647;
          return seed / 2147483647;
        };
        for (let layer = 0; layer < 2; layer++) {
          let x = 0;
          while (x < 1024) {
            const bw = 30 + rnd() * 70;
            const bh = (layer ? 90 : 140) + rnd() * (layer ? 120 : 180);
            g.fillStyle = layer ? '#0b1418' : '#1a2a30';
            g.fillRect(x, 430 - bh, bw, bh);
            // (lit windows: most dark, each its own size, warmth and brightness; softened like video)
            g.filter = 'blur(0.8px)';
            for (let wy = 430 - bh + 10; wy < 420; wy += 14)
              for (let wx = x + 6; wx < x + bw - 8; wx += 12) {
                if (rnd() > 0.2) continue;
                const warm = rnd();
                const a = (layer ? 0.45 : 0.25) + rnd() * 0.5;
                g.fillStyle = warm < 0.7 ? `rgba(255,${180 + Math.floor(rnd() * 50)},${100 + Math.floor(rnd() * 60)},${a})` : `rgba(${170 + Math.floor(rnd() * 40)},${210 + Math.floor(rnd() * 30)},255,${a})`;
                g.fillRect(wx + rnd() * 2, wy + rnd() * 2, 3 + rnd() * 4, 4 + rnd() * 5);
              }
            g.filter = 'none';
            x += bw + 4;
          }
        }
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(60, 470, 904, 4);
        g.fillStyle = '#e8473c';
        g.fillRect(60, 470, 380, 4);
        g.beginPath();
        g.arc(440, 472, 7, 0, Math.PI * 2);
        g.fill();
      } else if (look === 'desktop') {
        // a desktop: a soft blue wallpaper, two windows (a file list, a picture), a taskbar (blocks, no text)
        const wall = g.createLinearGradient(0, 0, 1024, 512);
        wall.addColorStop(0, '#1e3d6b');
        wall.addColorStop(0.6, '#3b6fa8');
        wall.addColorStop(1, '#8fb6d9');
        g.fillStyle = wall;
        g.fillRect(0, 0, 1024, 512);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(96, 66, 520, 330);
        g.fillStyle = '#c4c8ce';
        g.fillRect(90, 60, 520, 330);
        g.fillStyle = '#dfe3e8';
        g.fillRect(90, 60, 520, 28);
        g.fillRect(90, 88, 130, 302);
        g.fillStyle = '#9aa4b0';
        for (let y = 104; y < 380; y += 22) {
          g.fillRect(104, y, 90, 8);
          g.fillRect(236, y, 200 + ((y * 37) % 120), 8);
        }
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(566, 156, 380, 250);
        g.fillStyle = '#1d1f24';
        g.fillRect(560, 150, 380, 250);
        const pic = g.createLinearGradient(0, 180, 0, 400);
        pic.addColorStop(0, '#f2a65a');
        pic.addColorStop(1, '#5a2e6b');
        g.fillStyle = pic;
        g.fillRect(560, 176, 380, 224);
        g.fillStyle = '#2a1838';
        g.beginPath();
        g.moveTo(560, 400);
        g.lineTo(700, 290);
        g.lineTo(800, 350);
        g.lineTo(880, 300);
        g.lineTo(940, 340);
        g.lineTo(940, 400);
        g.fill();
        g.fillStyle = 'rgba(20,24,32,0.85)';
        g.fillRect(0, 476, 1024, 36);
        for (let k = 0; k < 7; k++) {
          g.fillStyle = ['#4f8de0', '#f2c14e', '#e0574f', '#5fbf6a', '#9a7ae0', '#e0e0e0', '#4fc0d0'][k];
          g.fillRect(392 + k * 36, 484, 22, 20);
        }
      } else {
        // a lock screen: orange dunes under a pale sky, a clock (blocks, no text)
        const sky = g.createLinearGradient(0, 0, 0, 512);
        sky.addColorStop(0, '#e9b48c');
        sky.addColorStop(0.5, '#d9733e');
        sky.addColorStop(1, '#7a2e14');
        g.fillStyle = sky;
        g.fillRect(0, 0, 1024, 512);
        g.fillStyle = '#5c200d';
        g.beginPath();
        g.moveTo(0, 360);
        g.bezierCurveTo(300, 250, 520, 420, 1024, 300);
        g.lineTo(1024, 512);
        g.lineTo(0, 512);
        g.fill();
        g.fillStyle = '#a4441c';
        g.beginPath();
        g.moveTo(0, 440);
        g.bezierCurveTo(260, 380, 700, 520, 1024, 420);
        g.lineTo(1024, 512);
        g.lineTo(0, 512);
        g.fill();
        // (the account's picture: a soft light circle, a short thin line under it)
        const glow = g.createRadialGradient(512, 200, 0, 512, 200, 46);
        glow.addColorStop(0, 'rgba(255,240,228,0.9)');
        glow.addColorStop(0.75, 'rgba(255,236,220,0.75)');
        glow.addColorStop(1, 'rgba(255,236,220,0)');
        g.fillStyle = glow;
        g.beginPath();
        g.arc(512, 200, 46, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fillRect(472, 266, 80, 6);
      }
      t = new THREE.CanvasTexture(c);
    }
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    this.textures.set(look, t);
    return t;
  }

  /**
   * Keycaps on a keyboard's deck, one instanced mesh, in a real layout (`look`): 'full' (a full-size board: the
   * main block, the navigation cluster, the numpad; with a backlight, a gap under the function row, grey WASD
   * caps and taller tapered caps) or 'laptop' (a laptop's: a low function row, the arrows with half-height up
   * and down). Each key is [x, z, width, depth] in key units from the back left.
   */
  private addKeyboard(f: Feature): void {
    const [x0, , z0, x1, y1, z1] = f.box;
    const kh = f.radius > 0 ? f.radius : 0.55;
    const lit = (f.glow ?? 0) > 0;
    const { keys, labels, uw, ud, grey, iso } = f.look === 'laptop' ? laptopLayout() : fullLayout(lit);
    const fill = f.look === 'laptop' ? 0.86 : lit ? 0.92 : 0.84;
    const w = x1 - x0;
    const d = z1 - z0;
    const ux = w / uw;
    const uz = d / ud;
    const gx = ux * (1 - fill);
    const gz = uz * (1 - fill);
    // (rounded caps: their corners and top edges softened)
    const cap = new RoundedBoxGeometry(1, kh, 1, 2, Math.min(0.12, kh * 0.3));
    if (lit) {
      // (mechanical caps: their tops a little smaller than their feet)
      const pos = cap.getAttribute('position');
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setXYZ(i, pos.getX(i) * 0.74, pos.getY(i), pos.getZ(i) * 0.74);
      cap.computeVertexNormals();
    }
    const mat = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: 0xffffff, metalness: 0, roughness: 0.55 }));
    if (lit) {
      // (the backlight seen on each key's foot: violet light on the lowest visible part of its sides, fading up;
      // the caps' local height runs 0..kh inside the instance, the deck at 0.35 kh)
      const footY = positionLocal.y;
      mat.emissiveNode = vec3(0.54, 0.3, 1).mul(float(1).sub(smoothstep(kh * 0.36, kh * 0.62, footY)).mul((f.glow ?? 0) * 1.1));
    }
    const caps = new THREE.InstancedMesh(cap, mat, keys.length);
    const m = new THREE.Matrix4();
    const base = new THREE.Color(f.color);
    const light = new THREE.Color(0xb8b8b8);
    // (long keys get caps of their own, so their bevel stays even; the ISO Enter is one L-shaped cap)
    const own: THREE.Mesh[] = [];
    const ownMat = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: 0, roughness: 0.55 }));
    if (lit) ownMat.emissiveNode = mat.emissiveNode;
    keys.forEach(([kx, kz, kw, kd, ys = 1], i) => {
      const cx = -w / 2 + (kx + kw / 2) * ux;
      const cz = -d / 2 + (kz + kd / 2) * uz;
      const long = kw >= 1.7 || kd >= 1.7;
      m.makeScale(ys === 0 || long ? 0.0001 : kw * ux - gx, ys === 0 || long ? 0.0001 : ys, ys === 0 || long ? 0.0001 : kd * uz - gz).setPosition(cx, (kh * ys) / 2, cz);
      caps.setMatrixAt(i, m);
      caps.setColorAt(i, grey.includes(i) ? light : base);
      if (long && ys !== 0) {
        const cw = kw * ux - gx;
        const cd = kd * uz - gz;
        const geo = new RoundedBoxGeometry(cw, kh, cd, 2, Math.min(0.12, kh * 0.3));
        if (lit) {
          const p = geo.getAttribute('position');
          // (the same inset at the top on every side, as a mechanical cap's)
          const inset = Math.min(cw, cd) * 0.13;
          for (let k = 0; k < p.count; k++) if (p.getY(k) > 0) p.setXYZ(k, p.getX(k) - Math.sign(p.getX(k)) * inset, p.getY(k), p.getZ(k) - Math.sign(p.getZ(k)) * inset);
          geo.computeVertexNormals();
        }
        // (its local height 0..kh, as the instanced caps', so the foot's light sits at the same height)
        geo.translate(0, kh / 2, 0);
        const capMesh = new THREE.Mesh(geo, ownMat);
        capMesh.position.set(cx, 0, cz);
        own.push(capMesh);
      }
    });
    if (iso) {
      // (the ISO Enter: 1.5 keys wide on its upper row, 1.25 on its lower, one cap with one bevel)
      const [ix0, iz0] = iso;
      const x0 = -w / 2 + ix0 * ux + gx / 2;
      const x1 = -w / 2 + (ix0 + 1.5) * ux - gx / 2;
      const xm = -w / 2 + (ix0 + 0.25) * ux + gx / 2;
      const z0 = -d / 2 + iz0 * uz + gz / 2;
      const zm = -d / 2 + (iz0 + 1) * uz - gz / 2;
      const z1 = -d / 2 + (iz0 + 2) * uz - gz / 2;
      const bevel = Math.min(0.12, kh * 0.3);
      const shapeL = new THREE.Shape();
      // (drawn in x and -z, then laid down: extruded upwards)
      shapeL.moveTo(x0 + bevel, -z0 - bevel);
      shapeL.lineTo(x1 - bevel, -z0 - bevel);
      shapeL.lineTo(x1 - bevel, -z1 + bevel);
      shapeL.lineTo(xm + bevel, -z1 + bevel);
      shapeL.lineTo(xm + bevel, -zm + bevel);
      shapeL.lineTo(x0 + bevel, -zm + bevel);
      shapeL.closePath();
      const geo = new THREE.ExtrudeGeometry(shapeL, { depth: kh - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, bevel, 0);
      const enter = new THREE.Mesh(geo, ownMat);
      own.push(enter);
    }
    caps.castShadow = true;
    caps.receiveShadow = true;
    const g = new THREE.Group();
    this.place(g, f);
    g.position.y = y1 - kh * (1 - CAP_OUT);
    g.add(caps, ...own);
    // (the legends: one quad on each cap's top, a square in its middle (on a wide key, at its left), its texture
    // a cell of an atlas; backlit boards light their legends)
    const atlas = legendAtlas(labels);
    const pos: number[] = [];
    const uv: number[] = [];
    const top = lit ? 0.74 : 1;
    keys.forEach(([kx, kz, kw, kd], i) => {
      const at = atlas.cell.get(labels[i]);
      if (at === undefined) return;
      const tw = (kw * ux - gx) * top;
      const td = (kd * uz - gz) * top;
      const q = Math.min(tw, td) * 0.92;
      const cx = -w / 2 + (kx + kw / 2) * ux + (tw > td * 1.6 ? -tw / 2 + q / 2 : 0);
      const cz = -d / 2 + (kz + kd / 2) * uz;
      const y = kh + 0.006;
      const u0 = (at % atlas.per) / atlas.per;
      const v1 = 1 - Math.floor(at / atlas.per) / atlas.per;
      const u1 = u0 + 1 / atlas.per;
      const v0 = v1 - 1 / atlas.per;
      const x0q = cx - q / 2;
      const x1q = cx + q / 2;
      const z0q = cz - q / 2;
      const z1q = cz + q / 2;
      pos.push(x0q, y, z0q, x0q, y, z1q, x1q, y, z1q, x0q, y, z0q, x1q, y, z1q, x1q, y, z0q);
      uv.push(u0, v1, u0, v0, u1, v0, u0, v1, u1, v0, u1, v1);
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    lg.computeVertexNormals();
    const ink = new THREE.MeshStandardNodeMaterial({ color: lit ? 0xd9c6ff : f.look === 'laptop' ? 0xc9ccd2 : 0xb9bcc2, metalness: 0, roughness: 0.6, transparent: true, map: atlas.texture, depthWrite: false });
    if (lit) {
      ink.emissive = new THREE.Color(0xe6d4ff);
      ink.emissiveMap = atlas.texture;
      ink.emissiveIntensity = (f.glow ?? 0) * 1.3;
    }
    const legends = new THREE.Mesh(lg, ink);
    legends.renderOrder = 1;
    g.add(legends);
    if (lit) {
      // (a near-black plate under all the caps, just over the deck: the light is on the keys' feet)
      const plate = new THREE.MeshStandardNodeMaterial({ color: 0x141218, metalness: 0, roughness: 0.6 });
      plate.emissive = new THREE.Color(0x8a4dff);
      plate.emissiveIntensity = 0;
      const sheet = new THREE.Mesh(new THREE.BoxGeometry(w * 0.99, 0.04, d * 0.98), plate);
      sheet.position.y = kh * 0.35 + 0.03;
      g.add(sheet);
    }
    this.push(g);
  }

  /**
   * The desk's black laminate, dusty: a faint grey film, many fine beige specks and small crumbs. With
   * `look` 'felt', felt of the feature's colour instead: matte, speckled with fibres.
   */
  private addDusty(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const mat = this.craters.cut(new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.62 }));
    const p = positionWorld;
    if (f.look === 'wood') {
      // (whitewashed wood: pale paint over a faint grey grain along the board's longest side)
      const c = new THREE.Color(f.color);
      const q = positionLocal;
      const along = x1 - x0 >= z1 - z0 ? (y1 - y0 > x1 - x0 ? q.yxz : q) : y1 - y0 > z1 - z0 ? q.yzx : q.zyx;
      // (long streaks along the board, faint: no speckle)
      const grain = mx_noise_float(vec3(along.x.mul(0.06), along.y.mul(1.4), along.z.mul(1.4)));
      const streak = smoothstep(0.1, 0.6, grain);
      mat.colorNode = vec3(c.r, c.g, c.b).mul(float(1).sub(streak.mul(0.14)));
      mat.roughnessNode = float(0.85);
      const board = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
      this.place(board, f);
      board.castShadow = true;
      board.receiveShadow = true;
      this.push(board);
      return;
    }
    if (f.look === 'felt') {
      const c = new THREE.Color(f.color);
      const base = vec3(c.r, c.g, c.b);
      const fibres = mx_noise_float(p.mul(5.2)).mul(0.5).add(0.5);
      const flecks = smoothstep(0.55, 0.62, mx_noise_float(p.mul(2.6).add(4.1)));
      mat.colorNode = base.mul(fibres.mul(0.28).add(0.82)).mul(float(1).sub(flecks.mul(0.25)));
      mat.roughnessNode = float(0.97);
      const felt = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
      this.place(felt, f);
      felt.receiveShadow = true;
      this.push(felt);
      return;
    }
    const haze = mx_noise_float(p.mul(0.04)).mul(0.5).add(0.5);
    if (f.look === 'pale') {
      // (a white table: a pale grey film where the haze is, dark grey ash specks, a few pale crumbs)
      const c = new THREE.Color(f.color);
      const ash = smoothstep(0.78, 0.82, mx_noise_float(p.mul(4.8).add(3.3))).add(smoothstep(0.84, 0.88, mx_noise_float(p.mul(2.4).add(9.1)))).clamp(0, 1);
      const film = haze.mul(0.04);
      mat.colorNode = mix(vec3(c.r, c.g, c.b).mul(float(1).sub(film)), vec3(0.32, 0.31, 0.3), ash.mul(0.8));
      mat.roughnessNode = float(0.6);
      const top = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
      this.place(top, f);
      top.receiveShadow = true;
      this.push(top);
      return;
    }
    // (fine pale specks, sharp, and white crumbs in three sizes, denser where the haze is)
    // (light dust: a few fine specks and rare small crumbs)
    const fine = smoothstep(0.76, 0.8, mx_noise_float(p.mul(5.5)));
    const crumbs = smoothstep(0.82, 0.86, mx_noise_float(p.mul(3.2).add(7.3)))
      .add(smoothstep(0.86, 0.9, mx_noise_float(p.mul(2.1).add(2.1))));
    const dust = fine.mul(haze.mul(0.6).add(0.4)).mul(0.65).add(crumbs.mul(0.7)).clamp(0, 1);
    // (a faint grey film over the black, thicker where the haze is; off-white, beige crumbs)
    mat.colorNode = mix(vec3(0.026, 0.026, 0.028).add(haze.mul(0.008)), vec3(0.6, 0.56, 0.48), dust);
    mat.roughnessNode = mix(float(0.74), float(0.9), dust);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    this.place(mesh, f);
    mesh.receiveShadow = true;
    this.push(mesh);
  }

  /**
   * A vertical mouse: one smooth hull in its box, a fin: a teardrop footprint (narrower at the front, -z), its
   * sides narrowing up to a ridge that rises towards the front, leaning right, flared at its foot, the thumb's
   * side flatter; a scroll wheel at the ridge's front. With `glow`, a rainbow strip along its foot from the
   * front left round the back to the right, and a blue-lit wheel.
   */
  private addMouse(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const hw = (x1 - x0) / 2;
    const H = y1 - y0;
    const hl = (z1 - z0) / 2;
    const glow = f.glow ?? 0;
    /** The hull's point for a point (vx, vy, vz) of the unit sphere (local, its foot's middle at the origin). */
    const hull = (vx: number, vy: number, vz: number, out: THREE.Vector3): THREE.Vector3 => {
      const u = (1 - vz) / 2; // 0 at the back, 1 at the front
      const rise = 0.55 + 0.45 * Math.sin(Math.min(1, u / 0.75) * (Math.PI / 2));
      // (the crown flat: the top fifth of the sphere pressed level)
      const y = vy >= 0 ? Math.min(1, vy * 1.2) * H * rise : 0;
      const t = y / H;
      // (narrowing to the ridge, flared at the foot; narrower at the front of the footprint)
      const width = hw * (1 - (glow ? 0.62 : 0.5) * Math.pow(t, 0.8)) * (1 - (glow ? 0.3 : 0.18) * u);
      let x = vx * width;
      if (vx < -0.6) x = -0.6 * width + (vx + 0.6) * 0.35 * width;
      // (the thumb's scoop: a hollow low on the left side)
      if (vx < 0) x += 0.4 * hw * Math.exp(-((vy - 0.4) * (vy - 0.4)) / 0.04 - ((vz - 0.1) * (vz - 0.1)) / 0.12) * -vx;
      return out.set(x + y * 0.32, y, vz * hl);
    };
    const geo = new THREE.SphereGeometry(1, 72, 48);
    const pos = geo.getAttribute('position');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      hull(pos.getX(i), pos.getY(i), pos.getZ(i), v);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mat = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: 0.05, roughness: 0.6 }));
    const g = new THREE.Group();
    g.position.set((x0 + x1) / 2, y0, (z0 + z1) / 2);
    const shell = new THREE.Mesh(geo, mat);
    shell.castShadow = true;
    shell.receiveShadow = true;
    g.add(shell);
    // (the wheel: a dark disc set in the ridge near its front, turning about x)
    hull(0, 1, -0.45, v);
    const wr = H * 0.07;
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(wr, wr, hw * 0.14, 24).rotateZ(Math.PI / 2),
      new THREE.MeshStandardNodeMaterial({ color: 0x1a1a1c, metalness: 0.3, roughness: 0.5, emissive: glow ? new THREE.Color(0x3050ff) : new THREE.Color(0), emissiveIntensity: glow ? 0.3 : 0 }),
    );
    wheel.position.set(v.x - H * 0.01, v.y - wr * 0.95, v.z);
    g.add(wheel);
    // (the buttons' seam along the crown, behind the wheel; two small side buttons over the thumb's scoop)
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x050505, metalness: 0, roughness: 0.8 });
    const seam: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) seam.push(hull(0, 1, -0.1 - (0.35 * i) / 12, new THREE.Vector3()).add(new THREE.Vector3(0, H * 0.004, 0)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam), 16, H * 0.008, 6, false), dark));
    const side = new THREE.MeshStandardNodeMaterial({ color: 0x2a2a2c, metalness: 0.1, roughness: 0.5 });
    // (the side buttons: flush, an inset outline on the thumb's face just under the crown's edge, split in two)
    const onSide = (vy: number, vz: number): THREE.Vector3 => hull(-Math.sqrt(Math.max(0, 1 - vy * vy - vz * vz)), vy, vz, new THREE.Vector3());
    // (two long rounded buttons end to end, a small gap between them)
    for (const [za, zb] of [[-0.42, -0.11], [-0.09, 0.22]] as const) {
      const outline: THREE.Vector3[] = [];
      const zc = (za + zb) / 2;
      const zh = (zb - za) / 2;
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        // (a stadium: flat sides, round ends)
        const cz = Math.cos(a);
        const sz = Math.sin(a);
        outline.push(onSide(0.7 + 0.042 * sz, zc + (zh - 0.03) * Math.sign(cz) * Math.min(1, Math.abs(cz) * 3) + 0.03 * cz));
      }
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline, true), 64, H * 0.006, 5, true), dark));
    }
    void side;
    // (the crown: a separate matte panel, a seam round it; a small white light on the plain one)
    const cap = new THREE.SphereGeometry(1, 64, 10, 0, Math.PI * 2, 0, Math.acos(0.84));
    const cp = cap.getAttribute('position');
    for (let i = 0; i < cp.count; i++) {
      hull(cp.getX(i), cp.getY(i), cp.getZ(i), v);
      cp.setXYZ(i, v.x, v.y + H * 0.004, v.z);
    }
    cap.computeVertexNormals();
    g.add(new THREE.Mesh(cap, new THREE.MeshStandardNodeMaterial({ color: glow ? 0x1e1e20 : 0x2a2a2c, metalness: 0, roughness: 0.72 })));
    const rim: THREE.Vector3[] = [];
    const rr = Math.sqrt(1 - 0.84 * 0.84);
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      rim.push(hull(rr * Math.cos(a), 0.84, rr * Math.sin(a), new THREE.Vector3()).add(new THREE.Vector3(0, H * 0.002, 0)));
    }
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 96, H * 0.005, 5, true), dark));
    if (!glow) {
      hull(0.22, 1, -0.15, v);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(H * 0.012, 10, 6), new THREE.MeshStandardNodeMaterial({ color: 0xffffff, emissive: new THREE.Color(0xdfe8ff), emissiveIntensity: 1.2 }));
      dot.position.set(v.x, v.y + H * 0.006, v.z);
      g.add(dot);
    }
    if (glow) {
      // (the strip: along the foot just above the mat, from the front left (angle 1.25π) round the back (π/2)
      // to the right side (-0.1π); its hue from green through blue and violet to red)
      const pts: THREE.Vector3[] = [];
      const lift = 0.07;
      for (let i = 0; i <= 60; i++) {
        const a = 1.25 * Math.PI + ((-0.1 * Math.PI - 1.25 * Math.PI) * i) / 60;
        const c = Math.sqrt(1 - lift * lift);
        hull(Math.cos(a) * c, lift, -Math.sin(a) * c, v);
        pts.push(new THREE.Vector3(v.x * 0.985, v.y + H * 0.03, v.z * 0.985));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, H * 0.016, 8, false);
      const uv = tube.getAttribute('uv');
      const colors = new Float32Array(uv.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < uv.count; i++) {
        c.setHSL((0.33 + uv.getX(i) * 0.67) % 1, 1, 0.55);
        colors.set([c.r, c.g, c.b], i * 3);
      }
      tube.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const band = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.4 });
      band.colorNode = vertexColor();
      band.emissiveNode = vertexColor().mul(glow * 0.65);
      g.add(new THREE.Mesh(tube, band));
    }
    this.push(g);
  }

  /**
   * A studio speaker's front, from the owner's photo, in the speaker's frame (origin on the baffle's face, +z
   * out; `radius` is the map's scale): a front skin with rounded edges and its openings (the woofer's, the
   * tweeter's, the slot port's); in them the woofer (a flat trim, a rubber roll, a concave woven cone, a matte
   * dust cap), the tweeter's smooth horn with a thin glossy lip and a shallow woven dome; a plain badge plate.
   */
  private addSpeakerFront(f: Feature): void {
    const L = (v: number): number => v * (f.radius || 1);
    const g = new THREE.Group();
    this.place(g, f);
    // (heights from the speaker's bottom; the group's origin is at its middle height)
    const at = (v: number): number => L(v) - L(7);
    const zf = L(0.9);
    const skinMat = new THREE.MeshStandardNodeMaterial({ color: 0x151515, metalness: 0.05, roughness: 0.5 });
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x050505, metalness: 0, roughness: 0.95, side: THREE.DoubleSide });
    const weave = (base: number): THREE.MeshStandardNodeMaterial => {
      const m = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.78 });
      const c = new THREE.Color(base);
      // (a basket weave: pairs of strands, alternating across and along; fine and faint)
      const pitch = float(L(0.03));
      const cx = floor(positionLocal.x.div(pitch));
      const cy = floor(positionLocal.y.div(pitch));
      const weaveBit = floor(cx.div(2)).add(floor(cy.div(2))).mul(0.5).fract().mul(2);
      const strand = mix(cx.mul(0.5).fract(), cy.mul(0.5).fract(), weaveBit).mul(2);
      m.colorNode = mix(vec3(c.r, c.g, c.b).mul(0.95), vec3(c.r, c.g, c.b).mul(1.05), strand);
      m.side = THREE.DoubleSide;
      return m;
    };
    // the skin: the front with its openings, extruded with rounded edges (the openings get rounded lips too)
    const hw = L(4.7) - L(0.2);
    const hh = L(7) - L(0.2);
    const rc = L(0.5);
    const shape = new THREE.Shape();
    shape.moveTo(-hw + rc, -hh);
    shape.lineTo(hw - rc, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + rc);
    shape.lineTo(hw, hh - rc);
    shape.quadraticCurveTo(hw, hh, hw - rc, hh);
    shape.lineTo(-hw + rc, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - rc);
    shape.lineTo(-hw, -hh + rc);
    shape.quadraticCurveTo(-hw, -hh, -hw + rc, -hh);
    const wy = at(6);
    const ty = at(11.5);
    const py = at(1.3);
    const hole = (cx: number, cy: number, rad: number): THREE.Path => new THREE.Path().absarc(cx, cy, rad, 0, Math.PI * 2, true);
    shape.holes.push(hole(0, wy, L(2.7)), hole(0, ty, L(1.6)));
    const port = new THREE.Path();
    const pw = L(2.6);
    const pr = L(0.9) + L(0.2);
    port.absarc(pw, py, pr, -Math.PI / 2, Math.PI / 2, false);
    port.absarc(-pw, py, pr, Math.PI / 2, (Math.PI * 3) / 2, false);
    shape.holes.push(port);
    const skin = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: L(0.6), bevelEnabled: true, bevelThickness: L(0.15), bevelSize: L(0.2), bevelSegments: 3, curveSegments: 72 }),
      this.craters.cut(skinMat),
    );
    skin.position.z = L(0.15);
    skin.castShadow = true;
    skin.receiveShadow = true;
    g.add(skin);
    const disc = (r0: number, r1: number, y: number, z: number, m: THREE.Material): void => {
      const d = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 96), m);
      d.position.set(0, y, z);
      g.add(d);
    };
    const lathe = (profile: [number, number][], y: number, m: THREE.Material): THREE.Mesh => {
      // (a profile of [radius, z] pairs, turned about the z axis)
      // (rotated a quarter about x, the profile's height becomes z)
      const geo = new THREE.LatheGeometry(profile.map(([rad, z]) => new THREE.Vector2(rad, z)), 96).rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.y = y;
      g.add(mesh);
      return mesh;
    };
    const cap = (base: number, height: number, y: number, z: number, m: THREE.Material): void => {
      const rs = (base * base + height * height) / (2 * height);
      const geo = new THREE.SphereGeometry(rs, 64, 16, 0, Math.PI * 2, 0, Math.asin(base / rs)).rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(0, y, z + height - rs);
      g.add(mesh);
    };
    // the woofer: a flat trim at the opening's floor, the rubber roll, the concave cone, the dust cap
    disc(L(2.2), L(2.55), wy, zf - L(0.25), new THREE.MeshStandardNodeMaterial({ color: 0x101011, metalness: 0, roughness: 0.7 }));
    const roll = new THREE.Mesh(new THREE.TorusGeometry(L(1.98), L(0.24), 16, 96), new THREE.MeshStandardNodeMaterial({ color: 0x1e1e1f, metalness: 0, roughness: 0.9 }));
    roll.position.set(0, wy, zf - L(0.4));
    g.add(roll);
    lathe([[L(1.75), zf - L(0.38)], [L(1.36), zf - L(0.55)], [L(0.94), zf - L(0.72)], [L(0.63), zf - L(0.82)]], wy, weave(0xd6b864));
    cap(L(0.64), L(0.28), wy, zf - L(0.82), new THREE.MeshStandardNodeMaterial({ color: 0x3a3a3a, metalness: 0, roughness: 0.9 }));
    // the tweeter: a smooth concave horn down to a thin glossy lip, the shallow woven dome
    lathe([[L(1.58), zf], [L(1.33), zf - L(0.12)], [L(1.04), zf - L(0.38)], [L(0.8), zf - L(0.62)], [L(0.69), zf - L(0.78)]], ty, new THREE.MeshStandardNodeMaterial({ color: 0x141415, metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide }));
    const lip = new THREE.Mesh(new THREE.TorusGeometry(L(0.66), L(0.08), 12, 96), new THREE.MeshStandardNodeMaterial({ color: 0x0a0a0a, metalness: 0.1, roughness: 0.2 }));
    lip.position.set(0, ty, zf - L(0.78));
    g.add(lip);
    disc(0, L(0.68), ty, zf - L(0.8), dark);
    cap(L(0.53), L(0.24), ty, zf - L(0.8), weave(0xd6b864));
    // the port: its dark back inside the slot
    const back = new THREE.Shape();
    back.absarc(pw, py, pr, -Math.PI / 2, Math.PI / 2, false);
    back.absarc(-pw, py, pr, Math.PI / 2, (Math.PI * 3) / 2, false);
    const portBack = new THREE.Mesh(new THREE.ShapeGeometry(back, 32), new THREE.MeshStandardNodeMaterial({ color: 0x010101, metalness: 0, roughness: 1 }));
    portBack.position.z = L(0.05);
    g.add(portBack);
    // the badge's place: a plain dark glossy plate between the tweeter and the woofer, to the left
    const plate = (pw2: number, ph2: number, rad: number): THREE.ShapeGeometry => {
      const sh = new THREE.Shape();
      sh.moveTo(-pw2 / 2 + rad, -ph2 / 2);
      sh.lineTo(pw2 / 2 - rad, -ph2 / 2);
      sh.quadraticCurveTo(pw2 / 2, -ph2 / 2, pw2 / 2, -ph2 / 2 + rad);
      sh.lineTo(pw2 / 2, ph2 / 2 - rad);
      sh.quadraticCurveTo(pw2 / 2, ph2 / 2, pw2 / 2 - rad, ph2 / 2);
      sh.lineTo(-pw2 / 2 + rad, ph2 / 2);
      sh.quadraticCurveTo(-pw2 / 2, ph2 / 2, -pw2 / 2, ph2 / 2 - rad);
      sh.lineTo(-pw2 / 2, -ph2 / 2 + rad);
      sh.quadraticCurveTo(-pw2 / 2, -ph2 / 2, -pw2 / 2 + rad, -ph2 / 2);
      return new THREE.ShapeGeometry(sh, 8);
    };
    // (flush on the front, a little glossier than it, no outline: a blank badge, not a recess)
    const badge = new THREE.Mesh(plate(L(1.12), L(0.77), L(0.08)), new THREE.MeshStandardNodeMaterial({ color: 0x121213, metalness: 0.1, roughness: 0.28 }));
    badge.position.set(-L(2.75), at(9.3), zf + 0.004);
    g.add(badge);
    this.push(g);
  }

  /**
   * A long-neck bottle in its box: one smooth lathed profile (a tall body, a gradual shoulder, a long tapered neck,
   * a ringed lip, open), amber-brown glass.
   */
  private addBottle(f: Feature): void {
    const [x0, y0, z0, x1, y1] = f.box;
    const R = (x1 - x0) / 2;
    const H = y1 - y0;
    const outer: [number, number][] = [
      // (the bottom is hollow: only its rim rests on the coaster)
      [0, 0.014], [R * 0.8, 0.01], [R * 0.9, 0.001], [R, 0.02], [R, 0.48], [R * 0.97, 0.53], [R * 0.86, 0.58], [R * 0.68, 0.63], [R * 0.52, 0.68],
      [R * 0.43, 0.73], [R * 0.4, 0.8], [R * 0.38, 0.9], [R * 0.44, 0.91], [R * 0.47, 0.93], [R * 0.41, 0.945], [R * 0.47, 0.96],
      [R * 0.47, 0.985], [R * 0.42, 1], [R * 0.33, 1], [R * 0.31, 0.98],
    ];
    const geo = new THREE.LatheGeometry(outer.map(([rad, h]) => new THREE.Vector2(rad, h * H)), 64);
    // (real glass: the light through it turns amber, thicker towards its edges)
    const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0xffffff, metalness: 0, roughness: 0.05, transmission: 1, thickness: R * 0.4, ior: 1.5, attenuationColor: new THREE.Color(0x6a3410), attenuationDistance: R * 0.5 });
    // (its shadow from the faces that meet the light: from the others its bottom, flat on the coaster, flickers)
    glass.shadowSide = THREE.FrontSide;
    const g = new THREE.Group();
    g.position.set((x0 + x1) / 2, y0, (z0 + f.box[5]) / 2);
    const shell = new THREE.Mesh(geo, glass);
    shell.renderOrder = 2;
    shell.castShadow = true;
    g.add(shell);
    this.push(g);
  }

  /**
   * A crumpled foil pouch filling its box: smooth, many small low crinkles over two or three soft folds, its
   * edges rounded down; with `radius` > 0, a short tight twist at its +x end, `radius` across where it starts.
   */
  private addFoil(f: Feature): void {
    const [x0, y0, z0, x1, y1, z1] = f.box;
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    const geo = new THREE.BoxGeometry(w, h, d, 48, 3, 32);
    const pos = geo.getAttribute('position');
    // (a smooth value noise of the position: the same nudge for the same point, so the surface stays whole)
    const hash = (a: number, b: number): number => {
      const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return s - Math.floor(s) - 0.5;
    };
    const noise = (x: number, z: number): number => {
      const ix = Math.floor(x);
      const iz = Math.floor(z);
      const fx = x - ix;
      const fz = z - iz;
      const sx = fx * fx * (3 - 2 * fx);
      const sz = fz * fz * (3 - 2 * fz);
      const a = hash(ix, iz) + (hash(ix + 1, iz) - hash(ix, iz)) * sx;
      const b = hash(ix, iz + 1) + (hash(ix + 1, iz + 1) - hash(ix, iz + 1)) * sx;
      return a + (b - a) * sz;
    };
    const unit = Math.min(w, d) / 3.3;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // (the distance in from the rim: a flat crimped seal 0.4 wide, then the pouch puffs up to its middle)
      const inward = Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
      const seal = unit * 0.4;
      const t = Math.max(0, Math.min(1, (inward - seal) / (unit * 1.3)));
      const puff = Math.sqrt(t * (2 - t));
      const sealH = unit * 0.15;
      const crimp = inward < seal ? Math.sin((x + z) / (unit * 0.08)) * unit * 0.015 : 0;
      const folds = Math.sin((x / unit) * 1.3 + 0.6) * 0.09 * unit + Math.sin((z / unit) * 1.7 + x / unit) * 0.06 * unit;
      const crinkle = noise((x / unit) * 1.5, (z / unit) * 1.5) * 0.15 * unit + noise((x / unit) * 4, (z / unit) * 4 + 9) * 0.05 * unit;
      // (sharp creases: narrow ridges and valleys from the seal towards the middle)
      let crease = 0;
      for (const [ax, az, dx, dz, sgn] of [[-0.9, -1, 0.4, 1, 1], [0.5, 1, -0.2, -1, -1], [1, -1, -0.6, 1, 1], [-0.2, 1, 0.5, -1, -1]]) {
        const lx = x / (w / 2) - ax;
        const lz = z / (d / 2) - az;
        const dn = Math.sqrt(dx * dx + dz * dz);
        const along = (lx * dx + lz * dz) / dn;
        const across = Math.abs(lx * dz - lz * dx) / dn;
        if (along > 0 && along < 1.4) crease += sgn * Math.max(0, 1 - across / 0.08) * (1 - along / 1.4) * unit * 0.12;
      }
      const ny = y > -h / 2 + 1e-4 ? -h / 2 + sealH + (h - sealH) * puff + (folds + crinkle + crease) * puff + crimp : y;
      // (a soft, slightly irregular outline)
      const wob = 1 + noise(x / unit + 3, z / unit + 7) * 0.06;
      pos.setXYZ(i, x * wob, ny, z * wob);
    }
    geo.computeVertexNormals();
    const mat = this.craters.cut(new THREE.MeshStandardNodeMaterial({ color: f.color, metalness: 0.35, roughness: 0.42 }));
    // (a broken sheen: the foil's roughness varies in patches)
    mat.roughnessNode = float(0.3).add(mx_noise_float(positionWorld.mul(1.3)).mul(0.5).add(0.5).mul(0.35));
    const g = new THREE.Group();
    this.place(g, f);
    const bag = new THREE.Mesh(geo, mat);
    bag.castShadow = true;
    bag.receiveShadow = true;
    g.add(bag);
    if (f.radius > 0) {
      // (the twist: a tapered cone along +x, three spiral ridges round it)
      const len = f.radius * 2;
      const tw = new THREE.CylinderGeometry(f.radius * 0.2, f.radius * 0.6, len, 24, 12).rotateZ(-Math.PI / 2);
      const tp = tw.getAttribute('position');
      for (let i = 0; i < tp.count; i++) {
        const x = tp.getX(i);
        const yy = tp.getY(i);
        const zz = tp.getZ(i);
        const a = Math.atan2(zz, yy);
        const k = 1 + 0.14 * Math.sin(3 * a + (x / len) * 9);
        tp.setXYZ(i, x, yy * k, zz * k);
      }
      tw.computeVertexNormals();
      const twist = new THREE.Mesh(tw, mat);
      // (drooping over the end it lies on)
      twist.rotation.z = -0.65;
      twist.position.set(w / 2 + len * 0.3, -h / 2 - len * 0.22, 0);
      g.add(twist);
    }
    this.push(g);
  }

  /** Add a piece to the scene; whatever it is made of, the explosions' craters cut it. */
  private push(object: THREE.Object3D): void {
    object.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as THREE.NodeMaterial[]) if (!m.maskNode) this.craters.cut(m);
    });
    this.group.add(object);
    this.pieces.push(object);
  }
}
