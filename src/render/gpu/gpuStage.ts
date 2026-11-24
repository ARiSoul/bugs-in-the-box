import * as THREE from 'three/webgpu';
import { abs, emissive, float, Fn, hash, If, Loop, max, mix, mrt, output, pass, renderOutput, screenUV, select, min, pow, smoothstep, sRGBTransferOETF, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { bilateralBlur } from 'three/examples/jsm/tsl/display/BilateralBlurNode.js';
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { godrays } from 'three/examples/jsm/tsl/display/GodraysNode.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneLayout } from '../../terrain/generators/types';
import type { Scenario } from '../../terrain/scenarios';
import type { Terrain } from '../../terrain/Terrain';
import { keyLight, sizeOf, startPose, type GpuTimer, type Stage, type StageOptions } from '../stage';
import { Atmosphere, POST_LAYER } from './atmosphere';
import { Craters } from './craters';
import { DustMotes } from './dust';
import { Glow } from './glow';
import { HeatShimmer } from './heat';
import { ActivityLeds } from './leds';
import { HeroOverlays } from './heroOverlays';
import { LightOverlays } from './lightOverlays';
import { CarParts } from './carParts';
import { DeskParts } from './deskParts';
import { MicrowaveParts } from './microwaveParts';
import { SpeakerParts } from './speakerParts';
import { createTerrainMaterial } from './terrainMaterial';

/** Key light direction: steep from the side, so the walls cast long shafts. */
const SUN_OFFSET = new THREE.Vector3(-60, 150, 36);
/** Strength of the god rays added to the image. */
const RAYS = 0.5;
/** Bloom strength (the same at every hue). */
const BLOOM = 0.3;
/** Uniforms a special attack's scene drives: the world dims, the edges close in, a flash, a blur towards the edges. */
export interface StageFx {
  /** Its lights go here. */
  scene: THREE.Scene;
  /** Distance to the world behind a point of the screen (a node). */
  depthAt(at: THREE.Node): THREE.Node<'float'>;
  dim: { value: number };
  vignette: { value: number };
  flash: { value: number };
  focusBlur: { value: number };
  /** The whole picture towards black. */
  fade: { value: number };
  /** A blackout: the world goes dark and cold, its lights out (0..1), and how much of it shows in the spot. */
  black: { value: number };
  reveal: { value: number };
  /** How far away the one the picture is about is. */
  subject: { value: number };
  /** A place on the screen that does not dim: its middle (u, v down), its radius, the picture's aspect. */
  spot: { value: THREE.Vector4 };
  /** How far away it is. */
  spotAt: { value: number };
}

/** Ray-march steps of the god rays (half resolution). */
const RAY_STEPS = 16;

/**
 * The renderer (three.js WebGPURenderer + TSL), with:
 * height fog with a coloured floor layer and dark corners, half-resolution ray-marched god rays from
 * the key light's shadow map, HDR bloom from emissive parts under ACES tone mapping, the render-only
 * glass panel, dust motes moved by a compute shader, heat shimmer and blinking activity LEDs.
 *
 * Where WebGPU is missing, the same code runs on three's WebGL2 backend, without the motes (no compute)
 * and without GPU timestamps.
 */
export async function createGpuStage(canvas: HTMLCanvasElement, terrain: Terrain, options: StageOptions): Promise<Stage> {
  const hasWebGPU = 'gpu' in navigator && (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) !== null;
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    trackTimestamp: options.timestamps && hasWebGPU,
    forceWebGL: !hasWebGPU,
  });
  await renderer.init();
  const isGPU = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft: filtered with `shadow.radius` below

  const scene = new THREE.Scene();
  const hud = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 800);
  const center = new THREE.Vector3();
  startPose(terrain, camera.position, center);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x2a221c, 0.22));
  const [sun, sunTarget] = keyLight(terrain, SUN_OFFSET);
  /** Where the key light stands, from the map centre (the scenario may set its own). */
  const sunOffset = SUN_OFFSET.clone();
  // late sun in a warm room
  sun.color.setHex(0xffb878);
  sun.intensity = 3.9;
  sun.shadow.radius = 5;
  scene.add(sun, sunTarget);

  const glow = new Glow();
  const atmosphere = new Atmosphere(glow, scene);
  const sunDir = new THREE.Vector3().copy(SUN_OFFSET).normalize();
  atmosphere.sunDir.value.copy(sunDir);
  const craters = new Craters();
  const look = createTerrainMaterial(glow, craters);
  const heat = new HeatShimmer();
  const leds = new ActivityLeds(scene, craters);
  const overlays = new LightOverlays(scene, glow, craters);
  const heroes = new HeroOverlays(scene, glow, craters);
  const speakerParts = new SpeakerParts(scene, craters);
  const microwaveParts = new MicrowaveParts(scene, craters);
  const deskParts = new DeskParts(scene, craters);
  const carParts = new CarParts(scene, craters);
  const dust = isGPU ? new DustMotes(renderer, glow, uniform(sunDir), options.seed) : null;
  if (dust) scene.add(dust.sprite);

  // ---- post: scene (MSAA, colour + emissive + depth) -> heat shimmer, god rays, bloom -> ACES.
  // Built after the first frame: the god rays read the key light's shadow map, which exists only then.
  const scenePass = pass(scene, camera, { samples: 4 });
  // the emissive target blends like the material does: otherwise every transparent surface (glass,
  // labels) overwrites the emissive under it and the glow behind it loses its bloom
  const sceneMRT = mrt({ output, emissive });
  sceneMRT.setBlendMode('emissive', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(sceneMRT);
  const sceneColor = scenePass.getTextureNode('output');
  const sceneEmissive = scenePass.getTextureNode('emissive');
  const sceneDepth = scenePass.getTextureNode('depth');
  /** How far the scene is behind each pixel (the camera's near and far are 0.5 and 800). */
  const depthAt = (at: THREE.Node): THREE.Node<'float'> => float(0.5 * 800).div(float(800).sub(sceneDepth.sample(at as THREE.Node<'vec2'>).r.mul(800 - 0.5))) as unknown as THREE.Node<'float'>;
  // a special attack's lights are drawn on their own: the dimmed world does not touch them
  const fxScene = new THREE.Scene();
  const fxPass = pass(fxScene, camera, { samples: 4 });
  let pipeline: THREE.RenderPipeline | null = null;
  let frames = 0;
  let bloomRef: ReturnType<typeof bloom> | null = null;
  const buildPipeline = (): THREE.RenderPipeline => {
    const rays = godrays(sceneDepth, camera, sun);
    rays.raymarchSteps.value = RAY_STEPS;
    rays.resolutionScale = 0.5;
    rays.density.value = 0.22;
    rays.maxDensity.value = 0.42;
    const raysBlur = bilateralBlur(rays.getTextureNode());
    const raysTex = raysBlur.getTextureNode();
    const fxColor = fxPass.getTextureNode('output');
    const bloomPass = bloom(sceneEmissive.mul(fx.dim.mul(0.9).oneMinus()).mul(fx.black.oneMinus()).add(fxColor), BLOOM, 0.22, 0.25);
    bloomRef = bloomPass;
    const base = sceneColor.sample(heat.uv(screenUV));
    // a little warm veil where the air is lit, and the shafts on top of it
    const shaft = smoothstep(0.17, 0.42, raysTex.sample(screenUV).r).mul(raysAmount);
    const p = new THREE.RenderPipeline(renderer);
    // (a special attack: a few samples towards the middle of the picture, so its edges rush by)
    const away = screenUV.sub(0.5);
    const blurred = Fn(() => {
      const sum = vec3(base.rgb).toVar();
      const amount = fx.focusBlur.mul(smoothstep(0.22, 0.7, away.length())).mul(0.055).toVar();
      If(amount.greaterThan(0.0005), () => {
        const jitter = hash(screenUV.x.mul(1913).add(screenUV.y.mul(7919))).toVar();
        Loop(12, ({ i }) => {
          const k = float(i).add(jitter).div(12);
          sum.addAssign(sceneColor.sample(heat.uv(screenUV.sub(away.mul(amount.mul(k))))).rgb);
        });
        sum.divAssign(13);
      });
      return sum;
    })();
    const world = blurred.add(sunColor.mul(shaft));
    // (what shines stays bright while the rest dims)
    // (and what is far dims most: only the fighter stands out)
    const viewZ = depthAt(screenUV);
    const far = smoothstep(fx.subject.add(3.5), fx.subject.add(13), viewZ);
    // (a pale floor dims more, so the lights on it show; what shines of its own, the fighter and its bow, does not)
    const own = smoothstep(0.004, 0.03, sceneEmissive.sample(screenUV).rgb.dot(vec3(0.33)));
    const bright = world.dot(vec3(0.3, 0.6, 0.1));
    const pale = mix(0.3, 0.86, smoothstep(0.12, 0.5, bright).mul(own.oneMinus())).add(smoothstep(0.45, 1, bright).mul(own.oneMinus()).mul(0.1));
    // (the one it aims at keeps its light: a soft spot on the screen)
    const spot = smoothstep(fx.spot.z, 0, vec2(screenUV.x.sub(fx.spot.x).mul(fx.spot.w), screenUV.y.sub(fx.spot.y)).length()).mul(smoothstep(6, 1.5, abs(viewZ.sub(fx.spotAt))));
    const dimBy = spot.mul(0.8).oneMinus().mul(min(fx.dim.mul(mix(pale, 1.12, far)), 0.988));
    const lit = world.mul(dimBy.oneMinus());
    // (a blackout: what is left is moonlight)
    const lum = world.dot(vec3(0.3, 0.6, 0.1)).mul(own.mul(0.85).oneMinus());
    const night = vec3(0.42, 0.58, 1).mul(pow(max(lum, 0), 0.7).div(lum.mul(2).add(1))).mul(0.15);
    const dimmed = mix(lit, night.add(world.mul(spot).mul(fx.reveal)), fx.black);
    const edge = smoothstep(0.35, 0.85, away.length());
    const final = dimmed.mul(edge.mul(fx.vignette).oneMinus()).add(fxColor.sample(screenUV).rgb).add(bloomPass.rgb.mul(fx.dim.mul(0.25).add(1))).add(vec3(0.25, 0.8, 1).mul(fx.flash).mul(smoothstep(0.34, 0.0, away.length())).mul(1.5)).mul(fx.fade.oneMinus());
    // debug views: 1 = god rays only, 2 = bloom only, 3 = emissive buffer
    const raysView = mix(base.rgb.mul(0.15), sunColor, raysTex.sample(screenUV).r);
    const viewN = select(debugView.lessThan(2.5), bloomPass.rgb, sceneEmissive.sample(screenUV).rgb);
    // tone map here, then FXAA on the display image (edges and thin highlights stop crawling)
    p.outputColorTransform = false;
    const shown = fxaa(renderOutput(vec4(select(debugView.lessThan(0.5), final, select(debugView.lessThan(1.5), raysView, viewN)), 1)));
    // labels last: over the display image, untouched by heat shimmer, bloom and FXAA (no crawl)
    const hudColor = pass(hud, camera).getTextureNode('output');
    const hudAlpha = hudColor.a;
    p.outputNode = vec4(mix((shown as unknown as THREE.Node<'vec4'>).rgb, sRGBTransferOETF(hudColor.rgb.div(max(hudAlpha, 0.001))) as THREE.Node<'vec3'>, hudAlpha), 1);
    return p;
  };
  const raysAmount = uniform(RAYS);
  const fx = { scene: fxScene, depthAt, dim: uniform(0), vignette: uniform(0), flash: uniform(0), focusBlur: uniform(0), fade: uniform(0), black: uniform(0), reveal: uniform(0), subject: uniform(10), spot: uniform(new THREE.Vector4(0, 0, 0.0001, 1)), spotAt: uniform(10) };
  const debugView = uniform(0);
  /** The shafts in the dust are warmer than the light itself (scattering in warm, dusty air). */
  const sunColor = uniform(new THREE.Color(0xffb36b));

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.maxDistance = 300;
  controls.update();

  const resize = (): void => {
    const [w, h, ratio] = sizeOf(options);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (dust) dust.pixelAngle.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / (h * ratio);
  };
  resize();

  const tracking = (renderer.backend as unknown as { trackTimestamp?: boolean }).trackTimestamp === true;
  const timer: GpuTimer | null = tracking ? createTimer(renderer) : null;

  return {
    backend: isGPU ? 'WebGPU' : 'WebGL2 (no WebGPU)',
    scene,
    hud,
    camera,
    controls,
    look: { material: look.material, setSharp: (on) => (look.sharp.value = on ? 1 : 0) },
    gpuTimer: timer,
    resize,
    // (the turntable keeps its own craters, in its own frame: they turn with it)
    craters: {
      add(x: number, y: number, z: number, radius: number) {
        craters.add(x, y, z, radius);
        microwaveParts.addCrater(x, y, z, radius);
      },
      addTunnel(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, radius: number) {
        craters.addTunnel(x1, y1, z1, x2, y2, z2, radius);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / (radius * 0.7)));
        for (let i = 0; i <= steps; i++) microwaveParts.addCrater(x1 + (dx * i) / steps, y1 + (dy * i) / steps, z1 + (dz * i) / steps, radius);
      },
    },
    setTurntable: (turns: number) => microwaveParts.setTurns(turns),
    setScenario(sc: Scenario, layout: SceneLayout) {
      document.body.style.background = sc.sky.css;
      sunOffset.copy(SUN_OFFSET);
      if (sc.sun) sunOffset.set(...sc.sun);
      sun.color.setHex(sc.sunColor ?? 0xffb878);
      sun.intensity = sc.sunIntensity ?? 3.9;
      scene.environmentIntensity = sc.environment ?? 0.4;
      raysAmount.value = sc.rays ?? RAYS;
      sun.position.copy(sun.target.position).add(sunOffset);
      sunDir.copy(sunOffset).normalize();
      atmosphere.clear.value = sc.sky.fogClear ?? 40;
      atmosphere.span.value = sc.sky.fogSpan ?? 110;
      atmosphere.cornerDark.value = sc.sky.cornerDark ?? 0.75;
      if (sc.sky.backdrop !== undefined) atmosphere.backdropColor.value.setHex(sc.sky.backdrop);
      else atmosphere.backdropColor.value.setHex(0x1a1d24).multiplyScalar(0.55);
      atmosphere.sunDir.value.copy(sunDir);
      glow.setLayout(layout);
      atmosphere.setLayout(layout, sc.sky.fog);
      heat.setLayout(layout);
      leds.setLayout(layout);
      craters.clear();
      overlays.setLayout(layout);
      heroes.setLayout(layout);
      speakerParts.setLayout(layout);
      microwaveParts.setLayout(layout);
      deskParts.setLayout(layout);
      carParts.setLayout(layout);
      dust?.setLayout(layout, layout.floorY);
      // the top of the scene: the glass, or (an open scene) the top of the inner box
      const top = layout.glassY > 0 ? layout.glassY : layout.inner[4];
      dust?.setTop(top);
      fitShadow(sun, layout, top);
    },
    render(seconds: number, dt: number) {
      // compile every material in the scene ahead of use (also those still out of view), so the first
      // look at something new does not stall a frame on a shader compile
      // (without the post-only layer: outside the MRT pass those materials have nothing to write)
      if (++frames === 30 || frames === 240) {
        const view = camera.clone();
        view.layers.disable(POST_LAYER);
        void renderer.compileAsync(scene, view);
      }
      glow.update(seconds);
      heat.update(camera, seconds);
      leds.update(seconds);
      heroes.update(seconds);
      carParts.update(seconds);
      dust?.update(dt);
      if (pipeline) pipeline.render();
      else {
        renderer.render(scene, camera);
        if (sun.shadow.map) {
          pipeline = buildPipeline();
          camera.layers.enable(POST_LAYER);
        }
      }
    },
    fx,
    frameNumber: () => renderer.info.frame,
    tune: {
      rays: raysAmount,
      view: debugView,
      sharp: look.sharp,
      hueLock: { get value() { return glow.lock; }, set value(v: number) { glow.lock = v; } },
      fogClear: atmosphere.clear,
      fogSpan: atmosphere.span,
      layerTop: atmosphere.layerTop,
      layerStrength: atmosphere.layerStrength,
      cornerDark: atmosphere.cornerDark,
      exposure: { get value() { return renderer.toneMappingExposure; }, set value(v: number) { renderer.toneMappingExposure = v; } },
      sun: { get value() { return sun.intensity; }, set value(v: number) { sun.intensity = v; } },
      env: { get value() { return scene.environmentIntensity; }, set value(v: number) { scene.environmentIntensity = v; } },
      bloomStrength: { get value() { return bloomRef?.strength.value ?? 0; }, set value(v: number) { if (bloomRef) bloomRef.strength.value = v; } },
      glassVisible: { get value() { return atmosphere.glass?.visible ?? false; }, set value(v: boolean) { if (atmosphere.glass) atmosphere.glass.visible = v; } },
    },
  };
}

/**
 * Fit the key light's shadow box tightly around the enclosure: sharper shadows, and the god rays (which
 * march only inside the shadow box) stay inside the case instead of veiling the whole view.
 */
function fitShadow(sun: THREE.DirectionalLight, layout: SceneLayout, topY: number): void {
  const [x0, , z0, x1, y1, z1] = layout.inner;
  const cam = sun.shadow.camera;
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  cam.position.setFromMatrixPosition(sun.matrixWorld);
  cam.lookAt(sun.target.position);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  const p = new THREE.Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let c = 0; c < 8; c++) {
    p.set(c & 1 ? x1 : x0, c & 2 ? Math.max(y1 + 2, topY + 2) : 0, c & 4 ? z1 : z0).applyMatrix4(inv);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, -p.z);
    maxZ = Math.max(maxZ, -p.z);
  }
  cam.left = minX - 2;
  cam.right = maxX + 2;
  cam.bottom = minY - 2;
  cam.top = maxY + 2;
  cam.near = Math.max(0.5, minZ - 4);
  cam.far = maxZ + 4;
  cam.updateProjectionMatrix();
}

/**
 * GPU time per frame from three's timestamp queries: after each resolve, the per-pass durations of the
 * frames that were resolved are summed per frame (render and compute passes).
 */
function createTimer(renderer: THREE.WebGPURenderer): GpuTimer {
  const pools = (renderer.backend as unknown as { timestampQueryPool: Record<string, { timestamps: Map<string, number> } | undefined> })
    .timestampQueryPool;
  const sums = new Map<number, number>();
  let busy = false;
  return {
    poll(onFrame) {
      if (busy) return;
      busy = true;
      Promise.all([renderer.resolveTimestampsAsync('render'), renderer.resolveTimestampsAsync('compute')])
        .then(() => {
          sums.clear();
          for (const type of ['render', 'compute']) {
            const pool = pools[type];
            if (!pool) continue;
            for (const [uid, ms] of pool.timestamps) {
              const m = /:f(\d+)$/.exec(uid);
              if (!m) continue;
              const f = Number(m[1]);
              sums.set(f, (sums.get(f) ?? 0) + ms);
            }
          }
          for (const [f, ms] of sums) onFrame(f, ms);
        })
        .finally(() => {
          busy = false;
        });
    },
  };
}
