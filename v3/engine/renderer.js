// WebGL renderer + post-processing pipeline: ACES tone mapping, sRGB output,
// moderate UnrealBloom so neon trim and lit windows glow without washing out
// the glass facades. Pixel ratio capped at 2 for perf on high-DPI phones.
import * as THREE from '../vendor/three/three.module.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';

export function createRenderPipeline(canvas, scene, camera) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: false,
  });
  renderer.setPixelRatio(Math.min((/iPhone|iPad|Android|Mobi/i.test(navigator.userAgent) ? 1.5 : 2), window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.setClearColor(0x02030a, 1);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.9);
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  function setSize(w, h) {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
  }

  return { renderer, composer, bloomPass, renderPass, setSize };
}
