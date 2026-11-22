import * as THREE from 'three/webgpu';
import { emissive, max, mix, mrt, output, pass, renderOutput, screenUV, select, smoothstep, sRGBTransferOETF, uniform, vec4 } from 'three/tsl';
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
import { LightSheets } from './lightSheets';
import { createTerrainMaterial } from './terrainMaterial';

/** Key light direction on this path: steeper from the side, so the walls cast long shafts. */
const SUN_OFFSET = new THREE.Vector3(-60, 150, 36);
/** Strength of the god rays added to the image. */
const RAYS = 0.5;
/** Bloom strength (the same at every hue). */
const BLOOM = 0.3;
/** Ray-march steps of the god rays (half resolution). */
const RAY_STEPS = 16;
/** Window blinds of the room, above the glass: render-only slats that only cast shadows. */
const BLINDS_ABOVE_GLASS = 16;
const SLAT_WIDTH = 3.6;
const SLAT_PITCH = 12;
/** Layer of meshes that only cast shadows (the key light's shadow camera sees it, no other camera does). */
const SHADOW_ONLY_LAYER = 2;

/**
 * The WebGPU render path (three.js WebGPURenderer + TSL). Same scene graph as the WebGL path, plus:
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
  // warmer than the WebGL path's key light (0xfff0d8): late sun through the blinds of a warm room
  sun.color.setHex(0xffb878);
  sun.intensity = 3.9;
  sun.shadow.radius = 5;
  scene.add(sun, sunTarget);

  const glow = new Glow();
  const atmosphere = new Atmosphere(glow, scene);
  const sunDir = new THREE.Vector3().copy(SUN_OFFSET).normalize();
  atmosphere.sunDir.value.copy(sunDir);
  const look = createTerrainMaterial(glow);
  const heat = new HeatShimmer();
  const leds = new ActivityLeds(scene);
  const craters = new Craters();
  const overlays = new LightOverlays(scene, glow, craters);
  const heroes = new HeroOverlays(scene, glow, craters);
  const sheets = new LightSheets(scene, new THREE.Color(0xffb36b), glow.time);
  const dust = isGPU ? new DustMotes(renderer, glow, uniform(sunDir), options.seed) : null;
  if (dust) scene.add(dust.sprite);

  // ---- post: scene (MSAA, colour + emissive + depth) -> heat shimmer, god rays, bloom -> ACES.
  // Built after the first frame: the god rays read the key light's shadow map, which exists only then.
  let pipeline: THREE.RenderPipeline | null = null;
  let frames = 0;
  let bloomRef: ReturnType<typeof bloom> | null = null;
  const buildPipeline = (): THREE.RenderPipeline => {
    const scenePass = pass(scene, camera, { samples: 4 });
    // the emissive target blends like the material does: otherwise every transparent surface (glass,
    // light sheets, labels) overwrites the emissive under it and the glow behind it loses its bloom
    const sceneMRT = mrt({ output, emissive });
    sceneMRT.setBlendMode('emissive', new THREE.BlendMode(THREE.MaterialBlending));
    scenePass.setMRT(sceneMRT);
    const sceneColor = scenePass.getTextureNode('output');
    const sceneEmissive = scenePass.getTextureNode('emissive');
    const sceneDepth = scenePass.getTextureNode('depth');
    const rays = godrays(sceneDepth, camera, sun);
    rays.raymarchSteps.value = RAY_STEPS;
    rays.resolutionScale = 0.5;
    rays.density.value = 0.22;
    rays.maxDensity.value = 0.42;
    const raysBlur = bilateralBlur(rays.getTextureNode());
    const raysTex = raysBlur.getTextureNode();
    const bloomPass = bloom(sceneEmissive, BLOOM, 0.22, 0.25);
    bloomRef = bloomPass;
    const base = sceneColor.sample(heat.uv(screenUV));
    // a little warm veil where the air is lit, and the shafts on top of it
    const shaft = smoothstep(0.17, 0.42, raysTex.sample(screenUV).r).mul(raysAmount);
    const p = new THREE.RenderPipeline(renderer);
    const final = base.rgb.add(sunColor.mul(shaft)).add(bloomPass.rgb);
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
  const debugView = uniform(0);
  /** The shafts in the dust are warmer than the light itself (scattering in warm, dusty air). */
  const sunColor = uniform(new THREE.Color(0xffb36b));

  // The key light reaches the case through the room's window blinds: slats above the glass that the
  // camera never sees (no colour, no depth) but that the shadow map does, so the light falls in
  // slanted sheets through the dusty air (god rays) and in soft stripes on the board.
  // They live on a layer only the key light's shadow camera sees: drawn in the scene pass (even fully
  // transparent) they would still write the emissive target and cut the bloom behind them in bands.
  const blindsMaterial = new THREE.MeshBasicNodeMaterial();
  sun.shadow.camera.layers.enable(SHADOW_ONLY_LAYER);
  const slat = new THREE.BoxGeometry(1, 0.6, 1);
  let blinds: THREE.InstancedMesh | null = null;
  let blindsY = 0;
  const setBlinds = (layout: SceneLayout): void => {
    if (blinds) scene.remove(blinds);
    blinds = null;
    if (layout.glassY <= 0) return;
    const [x0, , z0, x1, , z1] = layout.inner;
    blindsY = layout.glassY + BLINDS_ABOVE_GLASS;
    dust?.setBlinds(x0 - 30, SLAT_PITCH, SLAT_WIDTH, blindsY);
    sheets.set(x0 - 30, SLAT_PITCH, blindsY, SUN_OFFSET, x0, x1, z0, z1, layout.glassY, layout.floorY);
    // reach past the case on the side the light comes from (the shadows land shifted the other way)
    const from = x0 - 30;
    const n = Math.ceil((x1 - from) / SLAT_PITCH);
    blinds = new THREE.InstancedMesh(slat, blindsMaterial, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m.makeScale(SLAT_WIDTH, 1, z1 - z0 + 60).setPosition(from + i * SLAT_PITCH, blindsY, (z0 + z1) / 2);
      blinds.setMatrixAt(i, m);
    }
    blinds.castShadow = true;
    blinds.layers.set(SHADOW_ONLY_LAYER);
    blinds.frustumCulled = false;
    scene.add(blinds);
  };

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
    kind: 'webgpu',
    backend: isGPU ? 'WebGPU' : 'WebGL2 (no WebGPU)',
    scene,
    hud,
    camera,
    controls,
    look: { material: look.material, setSharp: (on) => (look.sharp.value = on ? 1 : 0) },
    gpuTimer: timer,
    resize,
    craters,
    setScenario(sc: Scenario, layout: SceneLayout) {
      document.body.style.background = sc.sky.css;
      glow.setLayout(layout);
      atmosphere.setLayout(layout, sc.sky.fog);
      heat.setLayout(layout);
      leds.setLayout(layout);
      craters.clear();
      overlays.setLayout(layout);
      heroes.setLayout(layout);
      dust?.setLayout(layout, layout.floorY);
      setBlinds(layout);
      fitShadow(sun, layout, blindsY);
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
    frameNumber: () => renderer.info.frame,
    tune: {
      rays: raysAmount,
      sheets: sheets.strength,
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
