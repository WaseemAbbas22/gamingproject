import {
  Application,
  Asset,
  Color,
  DEVICETYPE_WEBGL2,
  Entity,
  EnvLighting,
  FILLMODE_FILL_WINDOW,
  Keyboard,
  RESOLUTION_AUTO,
  TONEMAP_ACES2,
  Texture,
  TouchDevice,
  createGraphicsDevice
} from 'playcanvas';
import { CameraFrame, SSAOTYPE_COMBINE } from 'playcanvas/build/playcanvas/src/extras/index.js';

export type Quality = 'low' | 'medium' | 'high';

export type EngineContext = {
  app: Application;
  canvas: HTMLCanvasElement;
  camera: Entity;
  sun: Entity;
  cameraFrame: CameraFrame | null;
  deviceType: string;
  android: boolean;
  quality: Quality;
};

function isAndroidWebView(): boolean {
  return typeof (window as Window & { AndroidBridge?: unknown }).AndroidBridge !== 'undefined';
}

export function loadAsset(app: Application, name: string, type: string, url: string, timeoutMs = 2500): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const existing = app.assets.find(name, type);
    if (existing && existing.resource) {
      resolve(existing);
      return;
    }
    const asset = existing || new Asset(name, type, { url });
    const timer = window.setTimeout(() => reject(new Error(`Timed out loading ${url}`)), timeoutMs);
    const done = (fn: () => void) => {
      window.clearTimeout(timer);
      fn();
    };
    asset.once('load', () => done(() => resolve(asset)));
    asset.once('error', (err: unknown) => done(() => reject(err)));
    if (!existing) app.assets.add(asset);
    app.assets.load(asset);
  });
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<EngineContext> {
  const android = isAndroidWebView();
  const status = (window as Window & { __bootStatus?: (t: string) => void }).__bootStatus;
  status?.('Creating WebGPU / WebGL2 device…');
  const device = await createGraphicsDevice(canvas, {
    // WebGPU + CameraFrame was presenting a black backbuffer. Use WebGL2
    // forward rendering so the track and cars actually appear.
    deviceTypes: [DEVICETYPE_WEBGL2],
    antialias: !android,
    powerPreference: 'high-performance'
  });
  if (!device) throw new Error('No graphics device (WebGPU/WebGL2)');
  status?.(`Graphics device: ${device.deviceType}`);

  const app = new Application(canvas, {
    graphicsDevice: device,
    keyboard: new Keyboard(window),
    touch: new TouchDevice(canvas)
  });
  app.setCanvasFillMode(FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(RESOLUTION_AUTO);
  try { (app as Application & { maxDeltaTime?: number }).maxDeltaTime = android ? 0.05 : 0.1; } catch { /* ignore */ }
  // Phones: lower pixel ratio = steadier frame pacing (less stutter).
  const dpr = window.devicePixelRatio || 1;
  app.graphicsDevice.maxPixelRatio = android
    ? Math.min(dpr, 1.2)
    : Math.min(dpr, 2);
  app.scene.ambientLight = new Color(0.68, 0.72, 0.78);
  app.scene.exposure = 1.22;
  app.scene.skyboxIntensity = 1.35;
  app.scene.skyboxMip = 1;
  try { app.scene.toneMapping = TONEMAP_ACES2; } catch { /* older scene path */ }

  const camera = new Entity('camera');
  camera.addComponent('camera', {
    clearColor: new Color(0.48, 0.74, 0.96),
    fov: 50,
    nearClip: 0.35,
    farClip: android ? 420 : 900
  });
  camera.setPosition(0, 40, 70);
  camera.lookAt(0, 0, 0);
  app.root.addChild(camera);

  const sun = new Entity('sun');
  sun.addComponent('light', {
    type: 'directional',
    color: new Color(1.0, 0.94, 0.82),
    intensity: 2.85,
    castShadows: !android,
    shadowDistance: android ? 90 : 160,
    shadowResolution: android ? 1024 : 2048,
    shadowBias: 0.18,
    normalOffsetBias: 0.08
  });
  sun.setLocalEulerAngles(48, -28, 0);
  app.root.addChild(sun);

  const fill = new Entity('fill');
  fill.addComponent('light', {
    type: 'directional',
    color: new Color(0.55, 0.68, 0.88),
    intensity: 0.62,
    castShadows: false
  });
  fill.setLocalEulerAngles(-20, 140, 0);
  app.root.addChild(fill);

  window.addEventListener('resize', () => app.resizeCanvas());
  app.start();
  app.resizeCanvas();
  try {
    if (camera.camera?.shaderParams) camera.camera.toneMapping = TONEMAP_ACES2;
  } catch { /* shaderParams not ready */ }

  // CameraFrame replaces the camera framebuffer. If its HDR compose pass
  // fails (common on WebGPU / first-frame shaderParams), the canvas stays black.
  const cameraFrame: CameraFrame | null = null;

  return {
    app,
    canvas,
    camera,
    sun,
    cameraFrame,
    deviceType: device.deviceType,
    android,
    quality: 'high'
  };
}

export function applyCameraFrame(frame: CameraFrame, quality: Quality, android: boolean): void {
  const high = quality === 'high';
  const medium = quality === 'medium';
  try {
    if (frame.cameraComponent?.shaderParams) frame.cameraComponent.toneMapping = TONEMAP_ACES2;
  } catch { /* older camera path */ }
  frame.rendering.toneMapping = TONEMAP_ACES2;
  frame.rendering.sharpness = high ? 0.55 : medium ? 0.35 : 0.2;
  frame.rendering.renderTargetScale = 1;
  frame.rendering.samples = 1;
  frame.bloom.intensity = high ? 0.045 : medium ? 0.03 : 0.015;
  frame.bloom.blurLevel = high ? 16 : 8;
  frame.ssao.type = quality === 'low' ? 'none' : SSAOTYPE_COMBINE;
  frame.ssao.intensity = high ? 0.5 : 0.35;
  frame.ssao.radius = 22;
  frame.ssao.samples = high ? 12 : 8;
  frame.taa.enabled = high && !android;
  frame.taa.jitter = 0.7;
  frame.dof.enabled = high && !android;
  frame.dof.nearBlur = false;
  frame.dof.focusDistance = 12;
  frame.dof.focusRange = 18;
  frame.dof.blurRadius = 2.4;
  frame.dof.highQuality = false;
  frame.vignette.intensity = 0.32;
  frame.vignette.inner = 0.42;
  frame.vignette.outer = 1.4;
  frame.grading.enabled = true;
  frame.grading.contrast = 1.08;
  frame.grading.saturation = 1.12;
  frame.grading.brightness = 1.02;
  try { frame.update(); } catch (err) { console.warn('CameraFrame.update failed', err); }
}

export async function applyHdrSky(app: Application): Promise<void> {
  const status = (window as Window & { __bootStatus?: (t: string) => void }).__bootStatus;
  status?.('Loading HDR environment…');
  const hdr = await loadAsset(app, 'sky', 'texture', './env/sky.hdr');
  const source = EnvLighting.generateLightingSource(hdr.resource as Texture);
  app.scene.envAtlas = EnvLighting.generateAtlas(source);
  app.scene.skybox = EnvLighting.generateSkyboxCubemap(hdr.resource as Texture);
  app.scene.skyboxIntensity = 1.25;
  source.destroy();
}
