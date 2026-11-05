// WebGL renderer + post-processing pipeline: ACES tone mapping, sRGB output,
// moderate UnrealBloom so neon trim and lit windows glow without washing out
// the glass facades. Pixel ratio capped at 2 for perf on high-DPI phones.
import * as THREE from '../vendor/three/three.module.js';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
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
  renderer.toneMappingExposure = 0.5;
  renderer.setClearColor(0x02030a, 1);

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.9);
  composer.addPass(bloomPass);

  // night grade (linear HDR, before tone mapping): tame over-saturated pink/cyan, deep-navy shadows, slight teal-blue lift like city.jpg
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c=texture2D(tDiffuse,vUv); float l=dot(c.rgb,vec3(.2126,.7152,.0722));
        vec3 g=mix(vec3(l),c.rgb,1.08);
        g*=mix(vec3(.55,.74,1.2),vec3(1.),smoothstep(.0,.8,l));   // crush shadows to deep navy, keep neon crisp
        gl_FragColor=vec4(g,c.a); }`,
  }));
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  function setSize(w, h) {
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
  }

  return { renderer, composer, bloomPass, renderPass, setSize };
}
