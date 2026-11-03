import * as THREE from 'three';
import {MapControls} from 'three/addons/controls/MapControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {Reflector} from 'three/addons/objects/Reflector.js';

const $=s=>document.querySelector(s);
const MOBILE=matchMedia('(pointer:coarse)').matches||innerWidth<700;
const FOLLOWERS=+(new URLSearchParams(location.search).get('followers')||42);
const DISTRICTS=[
 {name:'Downtown Neon',unlock:0,seed:7,pal:[0x00e5ff,0xff2bd6,0x8a5cff,0xffb020]},
 {name:'Skyport',unlock:100,seed:21,pal:[0x39ff88,0x00b3ff,0xffffff,0xff2bd6]},
 {name:'Harbor Lights',unlock:500,seed:33,pal:[0xff5a2b,0xffd000,0x00e5ff,0xff2b6b]},
 {name:'Orbital Heights',unlock:1000,seed:48,pal:[0xb14cff,0x00ffd5,0xff2bd6,0x6b8cff]}];
let D=0,night=true,walk=false;

// ---------- renderer ----------
const renderer=new THREE.WebGLRenderer({antialias:!MOBILE,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,MOBILE?1.5:1.75));
renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.3,6000);
const HOME=MOBILE?[520,420,600]:[330,260,380];camera.position.set(...HOME);
const controls=new MapControls(camera,renderer.domElement);
Object.assign(controls,{enableDamping:true,dampingFactor:.08,minDistance:6,maxDistance:900,maxPolarAngle:1.52,zoomToCursor:true});
controls.touches={ONE:THREE.TOUCH.PAN,TWO:THREE.TOUCH.DOLLY_ROTATE};

const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth/2,innerHeight/2),1.1,0.55,0.62);
composer.addPass(bloom);composer.addPass(new OutputPass());

// env lighting (procedural, no downloads)
const pmrem=new THREE.PMREMGenerator(renderer);
function envFrom(top,hor,bottom,glow){const s=new THREE.Scene();const g=new THREE.SphereGeometry(10,32,16);
 const m=new THREE.ShaderMaterial({side:THREE.BackSide,uniforms:{t:{value:new THREE.Color(top)},h:{value:new THREE.Color(hor)},b:{value:new THREE.Color(bottom)},g:{value:new THREE.Color(glow)}},
 vertexShader:'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:'varying vec3 p;uniform vec3 t,h,b,g;void main(){float y=p.y;vec3 c=y>0.?mix(h,t,pow(y,.6)):mix(h,b,pow(-y,.4));c+=g*pow(max(0.,1.-abs(y)*4.),3.)*(.6+.4*sin(atan(p.z,p.x)*7.));gl_FragColor=vec4(c,1.);}'});
 s.add(new THREE.Mesh(g,m));const rt=pmrem.fromScene(s,0.02);return rt.texture;}
const ENV={night:envFrom(0x02030a,0x14203a,0x030308,0x1a3a5a),day:envFrom(0x3a78c8,0xcfe4f5,0x5a6070,0x000000)};

// sky dome
const skyU={top:{value:new THREE.Color()},hor:{value:new THREE.Color()},night:{value:1},time:{value:0}};
const sky=new THREE.Mesh(new THREE.SphereGeometry(3000,48,24),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:skyU,
 vertexShader:'varying vec3 p;void main(){p=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:`varying vec3 p;uniform vec3 top,hor;uniform float night,time;
 float h(vec2 q){return fract(sin(dot(q,vec2(12.9898,78.233)))*43758.5453);}
 void main(){float y=max(p.y,0.);vec3 c=mix(hor,top,pow(y,.45));
 vec2 st=floor(p.xz/(p.y+.3)*260.);float s=step(.9975,h(st))*smoothstep(.15,.5,y)*night;c+=vec3(s);
 float cl=sin(p.x*9.+time*.02)*sin(p.z*7.)*.5+.5;c=mix(c,c*1.4+vec3(.05,.0,.08)*night,cl*smoothstep(.0,.25,y)*(1.-smoothstep(.25,.6,y))*.5);
 gl_FragColor=vec4(c,1.);}`}));
scene.add(sky);

const hemi=new THREE.HemisphereLight(0x6f8fff,0x0a0f1e,0.3);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,0);sun.position.set(300,500,200);scene.add(sun);
scene.fog=new THREE.FogExp2(0x0a1530,0.0019);

// ---------- helpers ----------
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;}}
const N=7,BLK=56,ROAD=18,P=BLK+ROAD,HALF=N*P/2;
function lotCenters(){const out=[];for(let i=0;i<N;i++)for(let j=0;j<N;j++){const cx=-HALF+ROAD/2+i*P+BLK/2,cz=-HALF+ROAD/2+j*P+BLK/2;
 for(const a of[-1,1])for(const b of[-1,1])out.push({x:cx+a*14,z:cz+b*14,bi:i,bj:j,c:Math.hypot(cx,cz)});}return out;}

// building material with procedural windows (world-space, works with instancing)
const winU={uNight:{value:1}};
function makeBuildingMat(){const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.78,metalness:.18,envMapIntensity:.12});
 m.onBeforeCompile=sh=>{sh.uniforms.uNight=winU.uNight;
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWP;varying vec3 vWN;varying float vSeed;')
  .replace('#include <project_vertex>',`#include <project_vertex>
   mat4 imx=modelMatrix*instanceMatrix;vWP=(imx*vec4(transformed,1.)).xyz;vWN=normalize(mat3(imx)*objectNormal);vSeed=fract(imx[3].x*.137+imx[3].z*.311);`);
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
   varying vec3 vWP;varying vec3 vWN;varying float vSeed;uniform float uNight;
   float hh(vec3 q){return fract(sin(dot(q,vec3(12.9898,78.233,37.719)))*43758.5453);}`)
  .replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
   totalEmissiveRadiance+=win*lit*wc*(.95*uNight)*(.4+.6*hh(vec3(id.x,0.,vSeed)))*fadeE;
   totalEmissiveRadiance+=side*band*vec3(0.,.9,1.)*1.1*uNight*vec3(fract(vSeed*13.)*.3+.1,.75,1.)*fadeE;`)
  .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   float side=step(abs(vWN.y),.5);vec2 tn=normalize(vWN.xz+1e-4);float u=dot(vWP.xz,vec2(-tn.y,tn.x));
   float camDist=length(vWP-cameraPosition);
   vec2 cell=vec2(u/1.7,vWP.y/3.);vec2 f=fract(cell);vec2 id=floor(cell);
   vec2 aa=clamp(fwidth(cell)*1.3,1e-4,.09);
   float mx=smoothstep(.12-aa.x,.12+aa.x,f.x)*smoothstep(.88+aa.x,.88-aa.x,f.x);
   float my=smoothstep(.2-aa.y,.2+aa.y,f.y)*smoothstep(.85+aa.y,.85-aa.y,f.y);
   float win=side*mx*my*step(1.5,vWP.y);
   float band=step(.5,fract(vSeed*7.))*step(.92,fract(vWP.y/26.));
   float distN=clamp((camDist-320.)/1500.,0.,1.);
   float fadeE=1.-distN*.5;
   float r=hh(vec3(id,vSeed*91.+ (abs(vWN.x)>.5?3.:7.)));
   float litSharp=step(.74-.12*vSeed,r);
   float lit=mix(litSharp,.16,distN);
   vec3 wc=mix(vec3(1.,.82,.58),vec3(.55,.8,1.),step(.35,hh(vec3(id.yx,vSeed))));
   wc=mix(wc,vec3(1.,.3,.9),step(.97,r));
   diffuseColor.rgb=mix(diffuseColor.rgb*(1.+.15*side)*mix(1.,.55,uNight),mix(vec3(.015,.02,.035),vec3(.22,.3,.4),1.-uNight),win);
    roughnessFactor=mix(roughnessFactor,.1,win);`);
 };return m;}

// textures
function asphaltTex(){const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');g.fillStyle='#202226';g.fillRect(0,0,512,512);
 const r=rng(3);for(let i=0;i<9000;i++){const v=20+r()*40;g.fillStyle=`rgb(${v},${v},${v+3})`;g.fillRect(r()*512,r()*512,1+r()*2,1+r()*2);}
 for(let i=0;i<30;i++){g.fillStyle='rgba(0,0,0,.25)';g.beginPath();g.ellipse(r()*512,r()*512,10+r()*60,5+r()*30,r()*3,0,7);g.fill();}
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(330,330);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;}
function puddleTex(){const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');g.fillStyle='#bbb';g.fillRect(0,0,256,256);const r=rng(9);
 for(let i=0;i<40;i++){const x=r()*256,y=r()*256,rr=8+r()*40;const gr=g.createRadialGradient(x,y,0,x,y,rr);gr.addColorStop(0,'#000');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(x-rr,y-rr,rr*2,rr*2);}
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(160,160);return t;}
const SIGNS=['NEON','ネオン','HOTEL','24H','ラーメン','CYBER','夜市','BAR','HORIZON','電脳','SUSHI','OPEN'];
const signMats={};
function signMat(i,col){const k=i+'_'+col;if(signMats[k])return signMats[k];const c=document.createElement('canvas');c.width=256;c.height=96;const g=c.getContext('2d');
 const hex='#'+new THREE.Color(col).getHexString();g.fillStyle='#050507';g.fillRect(0,0,256,96);g.strokeStyle=hex;g.lineWidth=5;g.strokeRect(5,5,246,86);
 g.font='bold 52px sans-serif';g.textAlign='center';g.textBaseline='middle';g.shadowColor=hex;g.shadowBlur=18;g.fillStyle='#fff';g.fillText(SIGNS[i],128,50);g.fillStyle=hex;g.globalAlpha=.6;g.fillText(SIGNS[i],128,50);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const m=new THREE.MeshBasicMaterial({map:t,color:new THREE.Color(1.6,1.6,1.6),toneMapped:false});signMats[k]=m;return m;}

// ---------- data ----------
let DATA={buildings:[]};
// Pluggable store: swap LocalStore for a SupabaseStore with the same async API later (anon key only, RLS on).
const LocalStore={
 async list(){return JSON.parse(localStorage.nh3_claims||'[]');},
 async save(all){localStorage.nh3_claims=JSON.stringify(all);},
 async add(c){const a=await this.list();a.push(c);await this.save(a);return c;},
 async setStatus(code,status){const a=await this.list();const c=a.find(x=>x.code===code);if(c){c.status=status;c.updated=Date.now();await this.save(a);}return c;}};
const Store=LocalStore;
function newCode(used){let c;do{c='NH-'+(1000+Math.floor(Math.random()*9000));}while(used.has(c));return c;}
async function loadData(){try{DATA=await (await fetch('buildings.json')).json();}catch(e){}
 for(const b of DATA.buildings)if(b.nick&&!b.status)b.status='verified';
 const mine=await Store.list();for(const c of mine){const b=DATA.buildings.find(b=>b.slot==c.slot);if(!b)continue;
  if(c.status==='freed'){if(!b.nick||b.code===c.code){Object.assign(b,{nick:null,flag:null,status:'freed',freedNick:c.nick,code:c.code});}}
  else if(!b.nick||b.code===c.code)Object.assign(b,c);}}
function applyClaim(c){const b=DATA.buildings.find(b=>b.slot==c.slot);if(!b)return;
 if(c.status==='freed')Object.assign(b,{nick:null,flag:null,status:'freed',freedNick:c.nick,code:c.code});else Object.assign(b,c);}

// ---------- city build ----------
let city=null,slots=[],blockRects=[];
const tmpM=new THREE.Matrix4(),tmpQ=new THREE.Quaternion(),tmpS=new THREE.Vector3(),tmpP=new THREE.Vector3();
const boxG=new THREE.BoxGeometry(1,1,1);boxG.translate(0,.5,0);
const bMat=makeBuildingMat();
const up=new THREE.Vector3(0,1,0);
function partGeos(){if(window.__PG)return window.__PG;const b=g=>{g.computeBoundingBox();const bb=g.boundingBox;g.translate(0,-bb.min.y,0);return g;};
 const box=new THREE.BoxGeometry(1,1,1);b(box);
 const cham=new THREE.CylinderGeometry(.62,.62,1,8);cham.rotateY(Math.PI/8);b(cham);
 const cyl=new THREE.CylinderGeometry(.5,.5,1,40,1);b(cyl);
 const taper=new THREE.CylinderGeometry(.3,.62,1,4);taper.rotateY(Math.PI/4);b(taper);
 const twist=new THREE.BoxGeometry(1,1,1,1,40,1);b(twist);const p=twist.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i),a=y*1.1,x=p.getX(i),z=p.getZ(i);p.setXYZ(i,x*Math.cos(a)-z*Math.sin(a),y,x*Math.sin(a)+z*Math.cos(a));}twist.computeVertexNormals();
 const wedge=new THREE.BoxGeometry(1,1,1);b(wedge);const q=wedge.attributes.position;for(let i=0;i<q.count;i++)if(q.getY(i)>.5&&q.getX(i)<0)q.setY(i,0.02);wedge.computeVertexNormals();
 const cone=new THREE.ConeGeometry(.5,1,12);b(cone);
 const ring=new THREE.TorusGeometry(1,.035,6,48);
 const sphere=new THREE.SphereGeometry(.5,8,6);
 return window.__PG={box,cham,cyl,taper,twist,wedge,cone,ring,sphere};}
function gardenTex(em){const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');const r=rng(em?5:5);
 g.fillStyle=em?'#000':'#1d3a1a';g.fillRect(0,0,256,256);
 for(let i=0;i<260;i++){const x=r()*256,y=r()*256,s=4+r()*14;if(em){if(r()<.12){g.fillStyle=r()<.5?'#ffe6a0':'#9fe0ff';g.fillRect(x,y,2.5,2.5);}}else{g.fillStyle=`hsl(${95+r()*40},${40+r()*30}%,${14+r()*22}%)`;g.beginPath();g.arc(x,y,s,0,7);g.fill();}}
 if(em){g.strokeStyle='#103a20';g.lineWidth=0;}g.strokeStyle=em?'rgba(0,229,255,.9)':'#556';g.lineWidth=em?3:6;g.strokeRect(4,4,248,248);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;}
const GARDEN=gardenTex(false),GARDEN_E=gardenTex(true);

const ASPH=asphaltTex(),PUD=puddleTex();
let reflector=null,groundMat=null;

function plateTex(b){const c=document.createElement('canvas');c.width=640;c.height=128;const g=c.getContext('2d');
 if(b.status==='pending'||b.status==='freed'){const pend=b.status==='pending',col=pend?'#ffb020':'#ff2bd6';
  g.fillStyle=pend?'rgba(30,20,0,.88)':'rgba(24,6,22,.85)';g.beginPath();g.roundRect(4,4,632,120,24);g.fill();
  if(pend){g.save();g.beginPath();g.roundRect(4,4,632,120,24);g.clip();g.fillStyle='rgba(255,176,32,.25)';for(let x=-120;x<700;x+=60){g.beginPath();g.moveTo(x,0);g.lineTo(x+30,0);g.lineTo(x-90,128);g.lineTo(x-120,128);g.fill();}g.restore();}
  g.strokeStyle=col;g.lineWidth=5;g.shadowColor=col;g.shadowBlur=14;g.stroke();g.shadowBlur=0;g.textBaseline='middle';
  g.font='60px "Noto Color Emoji",sans-serif';g.fillText(pend?'🚧':'💔',20,68);g.fillStyle='#fff';g.font='bold 40px system-ui,sans-serif';
  g.fillText(pend?'Remodeling your house':'Free · follow again',100,pend?50:66);
  if(pend){g.font='26px system-ui,sans-serif';g.fillStyle='#ffd27a';g.fillText('verifying follow…'+(b.code?' '+b.code:''),100,96);}
  const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;tx.anisotropy=4;return tx;}
 const own=!!b.nick&&b.status!=='pending';g.fillStyle=own?'rgba(8,10,24,.85)':'rgba(8,10,24,.55)';g.beginPath();g.roundRect(4,4,632,120,24);g.fill();
 g.strokeStyle=own?'#00e5ff':'#555c77';g.lineWidth=5;g.shadowColor='#00e5ff';g.shadowBlur=own?16:0;g.stroke();g.shadowBlur=0;
 g.textBaseline='middle';g.font='64px "Noto Color Emoji",sans-serif';g.fillText(own?(b.flag||'🏳️'):'🏢',22,68);
 g.font='bold 46px system-ui,sans-serif';g.fillStyle=own?'#fff':'#9aa3c0';let t=own?'@'+b.nick:'#'+b.slot+' · free';
 while(g.measureText(t).width>500)t=t.slice(0,-2);g.fillText(t,110,66);
 const tx=new THREE.CanvasTexture(c);tx.colorSpace=THREE.SRGBColorSpace;tx.anisotropy=4;return tx;}

function buildCity(d){
 if(city){scene.remove(city);city.traverse(o=>{if(o.geometry&&o.geometry!==boxG)o.geometry.dispose();if(o.material&&o.material.map&&o.isSprite){o.material.map.dispose();o.material.dispose();}});}
 if(reflector){reflector.dispose();reflector=null;}
 city=new THREE.Group();scene.add(city);slots=[];blockRects=[];
 const dist=DISTRICTS[d],r=rng(dist.seed),pal=dist.pal;
 // ground
 const SZ=5000;
 if(!MOBILE){reflector=new Reflector(new THREE.PlaneGeometry(SZ,SZ),{textureWidth:innerWidth*.5,textureHeight:innerHeight*.5,color:0x8a8a9a,clipBias:.003});reflector.rotation.x=-Math.PI/2;reflector.position.y=-.02;city.add(reflector);}
 groundMat=new THREE.MeshStandardMaterial({map:ASPH,roughness:.18,roughnessMap:PUD,metalness:.4,transparent:!MOBILE,opacity:.72});
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(SZ,SZ),groundMat);ground.rotation.x=-Math.PI/2;city.add(ground);
 // sidewalks + road lines
 const swG=new THREE.InstancedMesh(boxG,new THREE.MeshStandardMaterial({color:0x3a3d44,roughness:.7,metalness:.1}),N*N);
 const lineM=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xdfe6ff}),N*(N+1)*2*10);let li=0,k=0;
 for(let i=0;i<N;i++)for(let j=0;j<N;j++){const cx=-HALF+ROAD/2+i*P+BLK/2,cz=-HALF+ROAD/2+j*P+BLK/2;
  tmpM.compose(tmpP.set(cx,0,cz),tmpQ.identity(),tmpS.set(BLK,.35,BLK));swG.setMatrixAt(k++,tmpM);blockRects.push([cx-BLK/2-1.5,cz-BLK/2-1.5,cx+BLK/2+1.5,cz+BLK/2+1.5]);}
 for(let i=0;i<=N;i++){const c=-HALF+i*P;for(let s=0;s<N*5;s++){const t=-HALF+s*P/5+4;
  tmpM.compose(tmpP.set(c,.03,t),tmpQ.identity(),tmpS.set(.35,1,6));lineM.setMatrixAt(li++,tmpM);
  tmpM.compose(tmpP.set(t,.03,c),tmpQ.identity(),tmpS.set(6,1,.35));lineM.setMatrixAt(li++,tmpM);}}
 lineM.count=li;city.add(swG,lineM);
 // buildings — varied futuristic silhouettes, all instanced
 const lots=lotCenters();const order=[...lots.keys()].sort((a,b)=>lots[a].c-lots[b].c);
 const isSlot=new Map();if(d===0)DATA.buildings.forEach((b,i)=>{const L=order[Math.min(order.length-1,2+i*3)];isSlot.set(L,b);});
 const parts={};const add=(g,x,y,z,sx,sy,sz,ry=0,c=null)=>{(parts[g]=parts[g]||[]).push([x,y,z,sx,sy,sz,ry,c]);};
 const glow={};const addG=(g,x,y,z,sx,sy,sz,col,ry=0)=>{(glow[g]=glow[g]||[]).push([x,y,z,sx,sy,sz,ry,col]);};
 const gardens=[],bridges=[];const tops=new Map();
 lots.forEach((L,idx)=>{const near=1-Math.min(1,L.c/(HALF*1.1));const b=isSlot.get(idx);
  let h=(b?70:16)+Math.pow(r(),2)*(b?150:120)*(.35+near)+near*50;const w=13+r()*8,dd=13+r()*8;
  const pc=pal[(r()*pal.length)|0],acc=r()<.65?pal[0]:pal[1];
  // podium with garden
  const ph=4+r()*8;add('box',L.x,.3,L.z,w+5,ph,dd+5);gardens.push([L.x,ph+.35,L.z,w+4,dd+4]);
  const type=h<34?'box':['cham','cyl','taper','twist','box','cham','slab'][(r()*7)|0];let y=ph+.3,top;
  const ry=((r()*4)|0)*Math.PI/2;
  if(type==='cyl'){const R=Math.min(w,dd);add('cyl',L.x,y,L.z,R,h,R);
   if(r()<.4)for(let k=1;k<h/55;k++)addG('ring',L.x,y+k*55,L.z,R*.505,R*.505,.7,acc);top=y+h;addG('ring',L.x,top,L.z,R*.5,R*.5,1.2,pal[1]);
   gardens.push([L.x,top+.05,L.z,R*.8,R*.8,1]);}
  else if(type==='twist'){add('twist',L.x,y,L.z,w,h,dd,r()*3);top=y+h;addG('ring',L.x,top,L.z,w*.6,dd*.6,1.4,pal[1]);}
  else if(type==='taper'){add('taper',L.x,y,L.z,w*1.1,h,dd*1.1,0);top=y+h;add('cone',L.x,top,L.z,1,h*.18,1);top+=h*.18;}
  else if(type==='slab'){// thin slab with slanted (wedge) top like ref
   add('box',L.x,y,L.z,w,h,dd*.6,ry);add('wedge',L.x,y+h,L.z,w,h*.18,dd*.6,ry);top=y+h*1.18;
   for(const sx of[-1,1])addG('box',L.x+(ry%Math.PI?0:sx*w/2),y,L.z+(ry%Math.PI?sx*w/2:0),.35,h,.35,acc);}
  else {const g=type;add(g,L.x,y,L.z,w,h,dd);top=y+h;
   if(g==='box')for(const sx of[-1,1])for(const sz of[-1,1])addG('box',L.x+sx*w/2,y,L.z+sz*dd/2,.3,h,.3,acc);
   if(h>60&&r()<.75){const h2=h*(.15+r()*.3);add(g,L.x,top,L.z,w*.7,h2,dd*.7);
    if(g==='box')for(const sx of[-1,1])for(const sz of[-1,1])addG('box',L.x+sx*w*.35,top,L.z+sz*dd*.35,.3,h2,.3,acc);top+=h2;}
   addG('box',L.x,top-1.2,L.z,(g==='box'?w*(top>y+h?.7:1):w*.95)+.4,.6,(g==='box'?dd*(top>y+h?.7:1):dd*.95)+.4,pc);
   if(r()<.5)gardens.push([L.x,top+.05,L.z,w*.6,dd*.6]);}
  if(h>90&&r()<.6){const sh=10+r()*25;add('cone',L.x,top,L.z,.6,sh,.6);addG('blink',L.x,top+sh,L.z,1,1,1,0xff2030);top+=sh;}
  tops.set(idx,top);
  if(b)slots.push({b,x:L.x,z:L.z,h:top,w,d:dd});
  // sky bridge to east neighbour in same block
  if(h>40&&r()<.4&&(idx%4)<2){const by=20+r()*Math.min(h-15,60);bridges.push([L.x+14,by,L.z,10,2.2,3]);}
 });
 for(const[x,y,z,sx,sy,sz]of bridges){add('box',x,y,z,sx,sy,sz);addG('box',x,y-.2,z+sz/2,sx,.25,.2,pal[0]);addG('box',x,y-.2,z-sz/2,sx,.25,.2,pal[0]);}
 // far skyline (horizon backdrop, cheap)
 for(let i=0;i<(MOBILE?260:520);i++){const a=r()*Math.PI*2,rad=HALF+460+r()*800,x=Math.cos(a)*rad,z=Math.sin(a)*rad;const fh=20+Math.pow(r(),1.6)*(rad<HALF+800?260:180);const fw=18+r()*22;
  add(r()<.35?'cyl':(r()<.5?'cham':'box'),x,0,z,fw,fh,fw);if(r()<.3)addG('box',x,fh-1,z,fw*.9,.6,fw*.9,pal[(r()*2)|0]);}
 const PG=partGeos();const col=new THREE.Color();const bms=[];
 for(const g in parts){const arr=parts[g];const m=new THREE.InstancedMesh(PG[g],bMat,arr.length);
  arr.forEach(([x,y,z,sx,sy,sz,ry],i)=>{tmpQ.setFromAxisAngle(up,ry);tmpM.compose(tmpP.set(x,y,z),tmpQ,tmpS.set(sx,sy,sz));m.setMatrixAt(i,tmpM);const v=.045+r()*.07;m.setColorAt(i,col.setRGB(v*.8,v*.9,v*1.25));});
  city.add(m);bms.push(m);}
 city.userData.bms=bms;
 const neonMat=new THREE.MeshBasicMaterial({toneMapped:false});const neons=[];
 for(const g in glow){const arr=glow[g];const m=new THREE.InstancedMesh(PG[g==='blink'?'sphere':g],neonMat,arr.length);
  arr.forEach(([x,y,z,sx,sy,sz,ry,c],i)=>{tmpQ.setFromAxisAngle(up,ry);if(g==='ring')tmpQ.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);tmpM.compose(tmpP.set(x,y,z),tmpQ,tmpS.set(sx,sy,sz));m.setMatrixAt(i,tmpM);m.setColorAt(i,col.set(c).multiplyScalar(g==='box'?1.5:1.3));});
  city.add(m);neons.push(m);}
 city.userData.neon=neonMat;
 // rooftop gardens
 const gm=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({map:GARDEN,emissiveMap:GARDEN_E,emissive:0xffffff,emissiveIntensity:1,roughness:.9}),gardens.length);
 gardens.forEach(([x,y,z,sx,sz],i)=>{tmpM.compose(tmpP.set(x,y,z),tmpQ.identity(),tmpS.set(sx,1,sz));gm.setMatrixAt(i,tmpM);});city.add(gm);city.userData.garden=gm.material;
 // holographic signs on some towers
 const sg=new THREE.PlaneGeometry(1,1);let sc=0;
 lots.forEach((L,idx)=>{if(r()>.18||sc>40)return;const t=tops.get(idx);if(t<40)return;sc++;const m=new THREE.Mesh(sg,signMat((r()*SIGNS.length)|0,pal[(r()*pal.length)|0]));
  const vert=r()<.6;m.scale.set(vert?4:12,vert?14:4,1);m.position.set(L.x,Math.min(t-10,20+r()*30),L.z+11.2);city.add(m);});
 // street lamps
 const lamps=[];for(let i=0;i<=N;i++)for(let s=0;s<N*2;s++){const c=-HALF+i*P,t=-HALF+s*P/2+P/4;lamps.push([c+ROAD/2-1.5,t],[t,c-ROAD/2+1.5]);}
 const poleM=new THREE.InstancedMesh(boxG,new THREE.MeshStandardMaterial({color:0x222,metalness:.8,roughness:.4}),lamps.length);
 const bulbM=new THREE.InstancedMesh(new THREE.SphereGeometry(.45,10,6),new THREE.MeshBasicMaterial({color:new THREE.Color(3,2.6,2.2),toneMapped:false}),lamps.length);
 const poolM=new THREE.InstancedMesh(new THREE.CircleGeometry(1,24).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({map:radial(),color:0xffc890,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.55}),lamps.length);
 lamps.forEach(([x,z],i)=>{tmpM.compose(tmpP.set(x,0,z),tmpQ.identity(),tmpS.set(.25,7,.25));poleM.setMatrixAt(i,tmpM);tmpM.compose(tmpP.set(x,7,z),tmpQ.identity(),tmpS.set(1,1,1));bulbM.setMatrixAt(i,tmpM);tmpM.compose(tmpP.set(x,.06,z),tmpQ.identity(),tmpS.set(7,1,7));poolM.setMatrixAt(i,tmpM);});
 city.add(poleM,bulbM,poolM);city.userData.lampFx=[bulbM,poolM];
 // nameplates (LOD: shown when close)
 for(const s of slots){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:plateTex(s.b),depthTest:true,transparent:true}));sp.scale.set(25,5,1);sp.position.set(s.x,s.h+5,s.z);sp.renderOrder=5;city.add(sp);s.plate=sp;
  // ground-level plate on facade
  const fp=new THREE.Mesh(new THREE.PlaneGeometry(10,2),new THREE.MeshBasicMaterial({map:sp.material.map,transparent:true,toneMapped:false}));fp.position.set(s.x,4.5,s.z+s.d/2+.3);city.add(fp);s.fplate=fp;}
 remodels=[];if(d===0)for(const s of slots)if(s.b.status==='pending')remodels.push(makeRemodel(s));
 buildCars(d,r);
 const owned=DATA.buildings.filter(b=>b.nick&&b.status==='verified').length;
 $('#count').textContent=d===0?`🏙 ${owned} ${owned===1?'home':'homes'} · ${DATA.buildings.length-owned} free`:`🏙 0 homes`;
 $('#dname').textContent=`${d+1}/${DISTRICTS.length} · ${dist.name}`;
 const locked=FOLLOWERS<dist.unlock;const lk=$('#lock');lk.style.display=locked?'block':'none';
 lk.innerHTML=`🔒 <b>${dist.name}</b><br>Unlocks at ${dist.unlock} followers<br><small>${FOLLOWERS} / ${dist.unlock}</small>`;
 setNight(night);
}
// ---------- remodeling fx: scaffolding, tower crane, welding sparks ----------
let remodels=[];
function makeRemodel(s){const g=new THREE.Group();city.add(g);const W=s.w+3,D=s.d+3,H=s.h+4;
 const pts=[];const lvl=Math.max(4,Math.round(H/6)),col=Math.max(3,Math.round(W/5));
 for(const[sx,sz,len,ax]of[[-W/2,-D/2,W,'x'],[-W/2,D/2,W,'x'],[-W/2,-D/2,D,'z'],[W/2,-D/2,D,'z']]){
  for(let i=0;i<=lvl;i++){const y=i*H/lvl;const a=[sx,y,sz],b=ax==='x'?[sx+len,y,sz]:[sx,y,sz+len];pts.push(...a,...b);}
  for(let k=0;k<=col;k++){const t=k*len/col;const x=ax==='x'?sx+t:sx,z=ax==='x'?sz:sz+t;pts.push(x,0,z,x,H,z);
   if(k<col)for(let i=0;i<lvl;i++){const t2=(k+1)*len/col,x2=ax==='x'?sx+t2:sx,z2=ax==='x'?sz:sz+t2;pts.push(x,i*H/lvl,z,x2,(i+1)*H/lvl,z2);}}}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
 const sc=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:new THREE.Color(1.4,.9,.3),transparent:true,opacity:.85}));sc.position.set(s.x,0,s.z);g.add(sc);
 // safety mesh panels
 const net=new THREE.Mesh(new THREE.BoxGeometry(W,H*.55,D),new THREE.MeshStandardMaterial({color:0x1d3b2a,transparent:true,opacity:.35,roughness:1,side:THREE.DoubleSide,depthWrite:false}));net.position.set(s.x,H*.3,s.z);g.add(net);
 // tower crane
 const steel=new THREE.MeshStandardMaterial({color:0xd8a020,metalness:.5,roughness:.5,emissive:0x3a2600});
 const mastH=H+28,mast=new THREE.Mesh(new THREE.BoxGeometry(1.4,mastH,1.4),steel);mast.position.set(s.x+W/2+3,mastH/2,s.z-D/2-3);g.add(mast);
 const jib=new THREE.Group();jib.position.set(mast.position.x,mastH,mast.position.z);g.add(jib);
 const arm=new THREE.Mesh(new THREE.BoxGeometry(46,1.1,1.1),steel);arm.position.x=-14;jib.add(arm);
 const cw=new THREE.Mesh(new THREE.BoxGeometry(4,2.5,2.5),new THREE.MeshStandardMaterial({color:0x444,roughness:.8}));cw.position.x=8;jib.add(cw);
 const cab=new THREE.Mesh(new THREE.BoxGeometry(2.4,2,2.4),steel);cab.position.y=-1.6;jib.add(cab);
 const cable=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,14,4),new THREE.MeshBasicMaterial({color:0x222}));cable.position.set(-26,-7,0);jib.add(cable);
 const load=new THREE.Mesh(new THREE.BoxGeometry(3,1.2,1.5),new THREE.MeshStandardMaterial({color:0x8899aa,metalness:.7,roughness:.3}));load.position.set(-26,-14.5,0);jib.add(load);
 const beacon=new THREE.Mesh(new THREE.SphereGeometry(.6,8,6),new THREE.MeshBasicMaterial({color:new THREE.Color(4,.3,.2),toneMapped:false}));beacon.position.y=1.2;jib.add(beacon);
 // sparks
 const NS=60,sp=new Float32Array(NS*3),vel=[];for(let i=0;i<NS;i++)vel.push(new THREE.Vector3());
 const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.BufferAttribute(sp,3));
 const spk=new THREE.Points(sg,new THREE.PointsMaterial({color:new THREE.Color(4,2.6,.8),size:.9,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,map:radial(),toneMapped:false}));g.add(spk);
 const flash=new THREE.PointLight(0xffb050,0,40,2);g.add(flash);
 const st={g,jib,beacon,spk,vel,flash,s,W,D,H,life:new Float32Array(NS),src:new THREE.Vector3(),t:Math.random()*10};
 return st;}
function updateRemodels(dt){for(const m of remodels){m.t+=dt;m.jib.rotation.y=Math.sin(m.t*.25)*1.1;m.beacon.visible=(m.t%1)<.5;
 if(Math.floor(m.t*0.7)!==m.k){m.k=Math.floor(m.t*0.7);const side=(m.k%4);const y=2+((m.k*7)%Math.max(3,m.H-4));
  m.src.set(m.s.x+(side<2?(side?1:-1)*m.W/2:0),y,m.s.z+(side>=2?(side==3?1:-1)*m.D/2:0));}
 const pos=m.spk.geometry.attributes.position;const burst=(m.t%0.7)<0.45;m.flash.position.copy(m.src);m.flash.intensity=burst?(80+Math.random()*120):0;
 for(let i=0;i<m.life.length;i++){if(m.life[i]<=0){if(burst&&Math.random()<.5){m.life[i]=.4+Math.random()*.6;pos.setXYZ(i,m.src.x,m.src.y,m.src.z);m.vel[i].set((Math.random()-.5)*10,Math.random()*6,(Math.random()-.5)*10);}else{pos.setXYZ(i,0,-999,0);continue;}}
  m.life[i]-=dt;m.vel[i].y-=18*dt;pos.setXYZ(i,pos.getX(i)+m.vel[i].x*dt,Math.max(.1,pos.getY(i)+m.vel[i].y*dt),pos.getZ(i)+m.vel[i].z*dt);}
 pos.needsUpdate=true;}}
function radial(){const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'#fff');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}

// ---------- flying cars ----------
let cars=null,carData=[];
function carGeo(){// smooth hover-car body: capsule-ish lathe
 const g=new THREE.CapsuleGeometry(.75,2.6,6,12);g.rotateX(Math.PI/2);g.scale(1,.55,1);return g;}
function buildCars(d,r){const n=MOBILE?90:180;carData=[];
 const body=new THREE.InstancedMesh(carGeo(),new THREE.MeshStandardMaterial({color:0x1a1d24,metalness:.9,roughness:.25}),n);
 const head=new THREE.InstancedMesh(new THREE.BoxGeometry(1.3,.18,.12),new THREE.MeshBasicMaterial({color:new THREE.Color(4,4,4.4),toneMapped:false}),n);
 const tail=new THREE.InstancedMesh(new THREE.BoxGeometry(1.3,.18,1.6),new THREE.MeshBasicMaterial({color:new THREE.Color(4,.2,.3),toneMapped:false}),n);
 const under=new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4,3).rotateX(Math.PI/2),new THREE.MeshBasicMaterial({color:new THREE.Color(0,1.8,2.5),toneMapped:false,side:THREE.DoubleSide}),n);
 for(let i=0;i<n;i++){const ax=r()<.5,lane=((r()*(N+1))|0),y=[18,32,48,70][(r()*4)|0],dir=r()<.5?1:-1;
  const off=-HALF+lane*P+(dir>0?3:-3);carData.push({ax,off,y:y+(dir>0?0:3),dir,t:r()*N*P*1.6,sp:14+r()*16});}
 city.add(body,head,tail,under);cars={body,head,tail,under,n};}
const cq=new THREE.Quaternion(),off3=new THREE.Vector3();
function updateCars(dt){if(!cars)return;const L=N*P+300;
 for(let i=0;i<cars.n;i++){const c=carData[i];c.t=(c.t+c.sp*dt)%L;const s=-L/2+c.t;const pos=c.dir>0?s:-s;
  const x=c.ax?pos:c.off,z=c.ax?c.off:pos;const yaw=c.ax?(c.dir>0?Math.PI/2:-Math.PI/2):(c.dir>0?0:Math.PI);
  cq.setFromAxisAngle(up,yaw);const bob=Math.sin(c.t*.05+i)*.3;
  tmpM.compose(tmpP.set(x,c.y+bob,z),cq,tmpS.set(1,1,1));cars.body.setMatrixAt(i,tmpM);
  off3.set(0,.1,2.05).applyQuaternion(cq);tmpM.compose(tmpP.set(x+off3.x,c.y+bob+.1,z+off3.z),cq,tmpS.set(1,1,1));cars.head.setMatrixAt(i,tmpM);
  off3.set(0,.1,-2.6).applyQuaternion(cq);tmpM.compose(tmpP.set(x+off3.x,c.y+bob+.1,z+off3.z),cq,tmpS.set(1,1,1));cars.tail.setMatrixAt(i,tmpM);
  tmpM.compose(tmpP.set(x,c.y+bob-.45,z),cq,tmpS.set(1,1,1));cars.under.setMatrixAt(i,tmpM);}
 for(const k of['body','head','tail','under'])cars[k].instanceMatrix.needsUpdate=true;}


// ---------- day / night ----------
function setNight(n){night=n;winU.uNight.value=n?1:0;skyU.night.value=n?1:0;
 skyU.top.value.set(n?0x020309:0x2a6fd0);skyU.hor.value.set(n?0x16233f:0xcfe2f2);
 scene.fog.color.set(n?0x0a1530:0xb8cce0);scene.fog.density=n?.0019:.0007;
 scene.environment=n?ENV.night:ENV.day;hemi.intensity=n?.16:1.1;hemi.color.set(n?0x6f8fff:0xdfefff);hemi.groundColor.set(n?0x05070f:0x445060);
 sun.intensity=n?0:2.4;bloom.strength=n?.62:.12;bloom.threshold=n?.78:.97;bloom.radius=n?.68:.55;renderer.toneMappingExposure=n?1.05:1.0;
 if(city){city.userData.neon.color.setScalar(n?1:.5);city.userData.garden.emissiveIntensity=n?1:0;city.userData.lampFx.forEach(m=>m.visible=n);}
 if(groundMat){groundMat.roughness=n?.15:.6;groundMat.opacity=n?.7:.96;groundMat.color.setScalar(n?1:.75);}
 $('#bDay').textContent=n?'☀️ Day':'🌙 Night';}

// ---------- fly-to ----------
let fly=null,highlight=null;
function flyTo(pos,target,dur=2.2){fly={p0:camera.position.clone(),t0:controls.target.clone(),p1:pos,t1:target,t:0,dur};}
function focusSlot(s,open=true){if(walk)toggleWalk();
 const tgt=new THREE.Vector3(s.x,s.h+2,s.z);const dir=new THREE.Vector3(s.x,0,s.z).normalize();if(dir.lengthSq()<.1)dir.set(1,0,1).normalize();
 const dist=MOBILE?95:55;flyTo(new THREE.Vector3(s.x+dir.x*dist+8,s.h+(MOBILE?80:40),s.z+dir.z*dist+14),tgt);
 slots.forEach(o=>{o.plate.material.depthTest=true;o.plate.renderOrder=5;});s.plate.material.depthTest=false;s.plate.renderOrder=20;
 if(highlight)city.remove(highlight);highlight=new THREE.Group();
 const beam=new THREE.Mesh(new THREE.CylinderGeometry(s.w*.12,s.w*.3,600,24,1,true),new THREE.MeshBasicMaterial({color:new THREE.Color(0,1.5,2),transparent:true,opacity:.05,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
 beam.position.set(s.x,s.h+300,s.z);const edges=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s.w+1,s.h+1,s.d+1)),new THREE.LineBasicMaterial({color:new THREE.Color(0,3,4),toneMapped:false}));
 edges.position.set(s.x,s.h/2+.3,s.z);highlight.add(beam,edges);city.add(highlight);if(open)showCard(s);}
function showCard(s){const b=s.b;$('#cf').textContent=b.status==='pending'?'🚧':b.nick?(b.flag||'🏳️'):(b.status==='freed'?'💔':'🏢');$('#cn').textContent=b.nick?'@'+b.nick:`Building #${b.slot}`;
 $('#ci').innerHTML=b.status==='pending'?`<b style="color:#ffb020">Remodeling your house…</b><br>Comment <b>${b.code}</b> under any of our ${b.source==='tiktok'?'TikTok videos':'Instagram reels'} and keep following. Your nick appears here once our bot verifies (every few minutes).`
  :b.status==='freed'?`Free again — <b>@${b.freedNick||'?'}</b> unfollowed us.<br><span style="color:#ff9be9">Follow again and re-register to get a home back!</span>`
  :b.nick?`Home #${b.slot} · ${DISTRICTS[0].name}${b.coins?` · 🪙 ${b.coins}`:''}`:'Free — follow us on Instagram or TikTok to claim it!';
 $('#card').style.display='block';$('#card').dataset.nick=b.nick||'';if(b.nick)history.replaceState(null,'','#'+encodeURIComponent(b.nick));}
$('#cclose').onclick=()=>{$('#card').style.display='none';};
$('#cshare').onclick=async()=>{const n=$('#card').dataset.nick;const url=location.origin+location.pathname+(n?'#'+encodeURIComponent(n):'');
 try{if(navigator.share)await navigator.share({title:'My home in Neon Horizon',url});else{await navigator.clipboard.writeText(url);toast('Link copied');}}catch(e){toast(url);}};
function toast(t){const e=$('#toast');e.textContent=t;e.style.display='block';clearTimeout(e._t);e._t=setTimeout(()=>e.style.display='none',2500);}
function findNick(q){q=q.trim().replace(/^@/,'').toLowerCase();if(!q)return null;return slots.find(s=>s.b.nick&&s.b.nick.toLowerCase()===q)||slots.find(s=>s.b.nick&&s.b.nick.toLowerCase().includes(q));}
$('#search').onsubmit=e=>{e.preventDefault();const q=$('#q').value;const go=()=>{const s=findNick(q);if(s)focusSlot(s);else toast('No home for @'+q.replace(/^@/,'')+' yet');};
 if(D!==0){D=0;buildCity(0);}go();$('#q').blur();};

// picking
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();let downAt=null;
renderer.domElement.addEventListener('pointerdown',e=>downAt=[e.clientX,e.clientY,performance.now()]);
renderer.domElement.addEventListener('pointerup',e=>{if(walk||!downAt)return;if(Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1])>6||performance.now()-downAt[2]>400)return;
 ndc.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(ndc,camera);
 const sprites=slots.map(s=>s.plate).filter(p=>p.visible);let hit=ray.intersectObjects(sprites)[0];
 if(hit){focusSlot(slots.find(s=>s.plate===hit.object));return;}
 hit=ray.intersectObjects(city.userData.bms)[0];if(hit){const s=slots.find(s=>Math.abs(hit.point.x-s.x)<s.w/2+3&&Math.abs(hit.point.z-s.z)<s.d/2+3);if(s)focusSlot(s);}});

// ---------- walk mode ----------
const keys={};addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;keys[e.code]=true;});addEventListener('keyup',e=>keys[e.code]=false);
let yaw=0,pitch=0,joy={x:0,y:0};
function toggleWalk(){walk=!walk;$('#bWalk').classList.toggle('on',walk);$('#bWalk').textContent=walk?'🛸 Fly':'🚶 Walk';controls.enabled=!walk;
 $('#joy').style.display=walk&&MOBILE?'block':'none';
 if(walk){fly=null;const c=controls.target;let x=Math.round((c.x+HALF)/P)*P-HALF,z=c.z;if(Math.abs(x)>HALF)x=0;
  camera.position.set(x,1.7,Math.max(-HALF,Math.min(HALF,z)));yaw=0;pitch=.08;}
 else{const p=camera.position;controls.target.set(p.x,0,p.z-1);flyTo(new THREE.Vector3(p.x+60,90,p.z+90),new THREE.Vector3(p.x,0,p.z),1.6);}
 hint();}
$('#bWalk').onclick=toggleWalk;
let look=null;
renderer.domElement.addEventListener('pointerdown',e=>{if(walk)look={id:e.pointerId,x:e.clientX,y:e.clientY};});
addEventListener('pointermove',e=>{if(walk&&look&&e.pointerId===look.id){yaw-=(e.clientX-look.x)*.004;pitch=Math.max(-1.2,Math.min(1.2,pitch-(e.clientY-look.y)*.004));look.x=e.clientX;look.y=e.clientY;}});
addEventListener('pointerup',e=>{if(look&&e.pointerId===look.id)look=null;});
const jEl=$('#joy'),kn=$('#knob');let jid=null;
jEl.addEventListener('pointerdown',e=>{jid=e.pointerId;jEl.setPointerCapture(jid);e.stopPropagation();});
jEl.addEventListener('pointermove',e=>{if(e.pointerId!==jid)return;const r=jEl.getBoundingClientRect();let x=(e.clientX-r.left-60)/50,y=(e.clientY-r.top-60)/50;const l=Math.hypot(x,y);if(l>1){x/=l;y/=l;}joy={x,y};kn.style.left=40+x*40+'px';kn.style.top=40+y*40+'px';});
jEl.addEventListener('pointerup',()=>{jid=null;joy={x:0,y:0};kn.style.left=kn.style.top='40px';});
function blocked(x,z){for(const[a,b,c,d]of blockRects)if(x>a&&x<c&&z>b&&z<d)return true;return Math.abs(x)>HALF+150||Math.abs(z)>HALF+150;}
function updateWalk(dt){let f=0,s=0;if(keys.KeyW||keys.ArrowUp)f++;if(keys.KeyS||keys.ArrowDown)f--;if(keys.KeyA)s--;if(keys.KeyD)s++;
 if(keys.ArrowLeft)yaw+=dt*1.6;if(keys.ArrowRight)yaw-=dt*1.6;f-=joy.y;s+=joy.x;
 const sp=(keys.ShiftLeft?16:7)*dt;const fx=-Math.sin(yaw),fz=-Math.cos(yaw);
 const nx=camera.position.x+(fx*f-fz*s)*sp,nz=camera.position.z+(fz*f+fx*s)*sp;
 if(!blocked(nx,camera.position.z))camera.position.x=nx;if(!blocked(camera.position.x,nz))camera.position.z=nz;
 camera.position.y=1.7+Math.sin(performance.now()*.008)*.03*(f||s?1:0);
 camera.quaternion.setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));}
function hint(){$('#hint').textContent=walk?(MOBILE?'Joystick to walk · drag to look':'WASD / arrows to walk · drag to look · Shift run'):(MOBILE?'Drag to pan · pinch to zoom · two-finger twist to rotate · tap a building':'Drag pan · right-drag rotate · wheel zoom · click a building');}

// ---------- UI ----------
$('#bDay').onclick=()=>setNight(!night);
$('#bHome').onclick=()=>{if(walk)toggleWalk();flyTo(new THREE.Vector3(...HOME),new THREE.Vector3(0,0,0));};
$('#prev').onclick=()=>{D=(D+DISTRICTS.length-1)%DISTRICTS.length;switchD();};$('#next').onclick=()=>{D=(D+1)%DISTRICTS.length;switchD();};
function switchD(){if(walk)toggleWalk();highlight=null;$('#card').style.display='none';buildCity(D);camera.position.set(330,260,380);controls.target.set(0,0,0);
 camera.position.set(520,380,600);flyTo(new THREE.Vector3(...HOME),new THREE.Vector3(0,0,0),1.5);}
// registration
const CC='AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(' ');
const DN=new Intl.DisplayNames(['en'],{type:'region'}),FL=c=>String.fromCodePoint(...[...c].map(ch=>127397+ch.charCodeAt()));
const COUNTRIES=CC.map(c=>({c,n:DN.of(c),f:FL(c)})).sort((a,b)=>a.n.localeCompare(b.n));let pick=null;
function listC(){const q=$('#rs').value.toLowerCase();$('#cl').innerHTML=COUNTRIES.filter(x=>x.n.toLowerCase().includes(q)).map(x=>`<div data-c="${x.c}" class="${pick&&pick.c==x.c?'sel':''}">${x.f} ${x.n}</div>`).join('');}
$('#rs').oninput=listC;$('#cl').onclick=e=>{const c=e.target.dataset.c;if(!c)return;pick=COUNTRIES.find(x=>x.c==c);$('#rs').value=pick.f+' '+pick.n;listC();};
$('#bReg').onclick=()=>{$('#reg').style.display='block';listC();};$('#rx').onclick=()=>$('#reg').style.display='none';
let src='instagram';document.querySelectorAll('#src button').forEach(x=>x.onclick=()=>{src=x.dataset.s;document.querySelectorAll('#src button').forEach(y=>y.classList.toggle('on',y===x));});
$('#rok').onclick=async()=>{const n=$('#rn').value.trim().replace(/^@/,'');if(!/^[\w.]{1,30}$/.test(n))return alert('Enter a valid nickname');if(!pick)return alert('Pick your country');
 if(DATA.buildings.some(b=>b.nick&&b.nick.toLowerCase()===n.toLowerCase()))return alert('This nick already has a home — search it!');
 const b=DATA.buildings.find(b=>!b.nick);if(!b)return alert('District full — next one unlocks soon!');
 const all=await Store.list();const code=newCode(new Set(all.map(x=>x.code)));
 const c={nick:n,flag:pick.f,country:pick.c,source:src,slot:b.slot,code,status:'pending',created:Date.now()};await Store.add(c);applyClaim(c);
 $('#reg').style.display='none';D=0;buildCity(0);const s=slots.find(s=>s.b===b);focusSlot(s,false);
 $('#dcode').textContent=code;$('#dsrc').textContent=src==='tiktok'?'TikTok video':'Instagram reel';$('#done').style.display='block';};
$('#dok').onclick=()=>{$('#done').style.display='none';const s=slots.find(s=>s.b.code===$('#dcode').textContent);if(s)showCard(s);};
$('#dcopy').onclick=async()=>{try{await navigator.clipboard.writeText($('#dcode').textContent);toast('Code copied');}catch(e){toast($('#dcode').textContent);}};
// bot hooks: the verification bot (or Supabase realtime later) calls these
async function setStatus(code,status){const c=await Store.setStatus(code,status);if(!c)return false;
 if(status==='verified'){const b=DATA.buildings.find(b=>b.slot==c.slot);Object.assign(b,c);}else applyClaim(c);
 const keep=$('#card').style.display==='block';buildCity(D);const s=slots.find(s=>s.b.slot==c.slot);if(s&&keep)focusSlot(s);return true;}

// ---------- loop ----------
const clock=new THREE.Clock();let fpsAcc=0,fpsN=0;
function loop(){requestAnimationFrame(loop);const dt=Math.min(.05,clock.getDelta());skyU.time.value+=dt;
 if(fly){fly.t+=dt/fly.dur;const k=fly.t>=1?1:1-Math.pow(1-fly.t,3);const arc=Math.sin(Math.PI*Math.min(1,fly.t))*Math.min(120,fly.p0.distanceTo(fly.p1)*.25);
  camera.position.lerpVectors(fly.p0,fly.p1,k);camera.position.y+=arc;controls.target.lerpVectors(fly.t0,fly.t1,k);camera.lookAt(controls.target);if(fly.t>=1)fly=null;}
 if(walk)updateWalk(dt);else if(!fly)controls.update();
 updateCars(dt);updateRemodels(dt);
 // nameplate LOD
 for(const s of slots){const dd=camera.position.distanceTo(s.plate.position);s.plate.visible=dd<(s.b.nick||s.b.status?420:200);const sc=Math.max(1,dd/90);s.plate.scale.set(25*sc,5*sc,1);s.fplate.visible=dd<120;}
 sky.position.copy(camera.position);
 composer.render();}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);bloom.resolution.set(innerWidth/2,innerHeight/2);});

await loadData();buildCity(0);hint();loop();
window.NH={flyNick:q=>{const s=findNick(q);if(s)focusSlot(s);return !!s;},setNight,toggleWalk,get walk(){return walk},camera,controls,go:(d)=>{D=d;switchD();},yawTo:v=>yaw=v,verify:c=>setStatus(c,'verified'),unfollow:c=>setStatus(c,'freed'),focus:slot=>{const s=slots.find(s=>s.b.slot==slot);if(s)focusSlot(s);},Store};
const h=decodeURIComponent(location.hash.slice(1));if(h){const s=findNick(h);if(s)setTimeout(()=>focusSlot(s),600);}
document.title='Neon Horizon 3D';window.__ready=true;
