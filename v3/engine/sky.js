// Procedural starry night sky (equirectangular canvas) used both as the
// scene background and, via PMREM, as the environment map that gives the
// glass towers soft realistic reflections. Also sets up depth fog/haze.
import * as THREE from '../vendor/three/three.module.js';

function mkStarsEquirect() {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // vertical gradient: dark-but-not-black zenith -> deep blue/violet near
  // horizon, with a bright warm city-glow band right at the horizon line.
  // Raised well above the original near-#000 stops: this equirect texture
  // is also PMREM-converted into scene.environment, so a near-black sky
  // gave the PBR glass towers almost no light to reflect and they rendered
  // as flat black silhouettes no matter how bright the direct lights were.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, '#00030a');
  grad.addColorStop(0.35, '#030814');
  grad.addColorStop(0.58, '#0a1430');
  grad.addColorStop(0.72, '#15234e');
  grad.addColorStop(0.82, '#1f1c48');
  grad.addColorStop(1.0, '#2e1a3e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // city glow haze hugging the horizon (cyan/magenta bleed, like bounce light off the skyline)
  const glow = ctx.createLinearGradient(0, h * 0.58, 0, h * 0.9);
  glow.addColorStop(0, 'rgba(40,220,255,0)');
  glow.addColorStop(0.55, 'rgba(70,210,255,0.38)');
  glow.addColorStop(1, 'rgba(255,70,220,0.34)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, h * 0.55, w, h * 0.35);
  // brighter warm band right at the skyline itself, like the dense glow
  // bouncing off the streets/windows in city.jpg
  const base = ctx.createLinearGradient(0, h * 0.82, 0, h);
  base.addColorStop(0, 'rgba(80,180,255,0)');
  base.addColorStop(1, 'rgba(150,215,255,0.55)');
  ctx.fillStyle = base;
  ctx.fillRect(0, h * 0.82, w, h * 0.18);

  // stars: dense small points in the upper 60%, fading toward the horizon haze
  let seed = 918273;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * w;
    const y = rnd() * h * 0.62;
    const r = rnd() < 0.08 ? 1.3 : 0.6;
    const a = 0.25 + rnd() * 0.65;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
    ctx.fillRect(x, y, r, r);
  }
  // a few brighter stars with a soft glow
  for (let i = 0; i < 40; i++) {
    const x = rnd() * w, y = rnd() * h * 0.5;
    ctx.fillStyle = 'rgba(200,230,255,0.9)';
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(200,230,255,0.15)';
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function setupSky(renderer, scene) {
  const skyTex = mkStarsEquirect();
  scene.background = skyTex;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envRT = pmrem.fromEquirectangular(skyTex);
  scene.environment = envRT.texture;

  // Depth haze: exponential fog reads correctly at both whole-city and
  // street-level distances, unlike linear Fog which needs re-tuning per zoom.
  // Lightened from near-black 0x060914 so far buildings fade into a visible
  // navy haze (matching the horizon glow + distant skyline) instead of
  // vanishing into the void; density eased slightly so the skyline backdrop
  // still reads through it.
  scene.fog = new THREE.FogExp2(0x081a44, 0.00085); // glowing blue city haze: far towers dissolve into it, no dark band at the horizon

  pmrem.dispose();
  return { skyTex };
}


// Gradient night-sky dome with shader stars and a cyan/magenta city-glow band at the horizon
// (like city.jpg). Follows the camera so it is always at infinity.
export function addSkyDome(scene) {
  const fogC = scene.fog ? scene.fog.color : new THREE.Color(0x050a1c);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFog: { value: fogC } },
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vD; uniform vec3 uFog;
      float h3(vec3 p){ p=fract(p*0.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float y = vD.y;
        vec3 zen = vec3(0.0005,0.001,0.004), mid = vec3(0.004,0.010,0.04), hor = uFog;
        float t = max(y, 0.);
        // continuous from below the horizon (pure fog colour, so the far ground/towers meet it seamlessly) up to the zenith
        vec3 c = mix(hor, mid, smoothstep(0.0,0.22,t));
        c = mix(c, zen, smoothstep(0.12,0.55,t));
        // luminous haze: cyan-blue glow rising from the skyline, soft magenta bounce above it
        c += vec3(0.03,0.16,0.50) * smoothstep(0.0,0.09,t) * exp(-t*9.0) * 0.8;
        c += vec3(0.22,0.07,0.30) * exp(-abs(t-0.07)*14.) * 0.12;
        // stars (fade toward the horizon)
        vec3 p = vD*420.; vec3 ip = floor(p); float r = h3(ip);
        float star = step(0.975, r) * smoothstep(0.02,0.18,y);
        vec3 f = fract(p)-0.5; star *= smoothstep(0.62,0.0,length(f))*(0.5+0.5*h3(ip+7.));
        c += mix(vec3(0.7,0.85,1.),vec3(1.,0.9,0.8),h3(ip+3.))*star*4.5;
        gl_FragColor = vec4(c,1.);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
  dome.renderOrder = -100; dome.frustumCulled = false;
  scene.add(dome);
  return dome;
}
