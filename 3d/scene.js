// liteya 3D · the room (WebGL): walls, glossy floor, holographic sphere with the infinity logo,
// orbital rings, light beams, anime night-city window, sakura petals and dust. All motion is time/spring based.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

export const ROOM = { floor: -640, ceil: 980, back: -1750, side: 1750, front: 1700 };
export const SPHERE = new THREE.Vector3(0, 545, -760);
export const SPHERE_SCALE = 0.5;

const add = THREE.AdditiveBlending;
// GLSL pow is undefined for a negative base: ANGLE on Windows (Direct3D, HLSL pow = exp2(y*log2 x)) returns NaN there.
// One NaN pixel in the HDR buffer is spread by the bloom blur mips into big pure-black blocks, so squares use sq()
// and every other pow base is clamped to >= 0. SAFE_GLSL is prepended to every room shader (see Room.mat).
export const SAFE_GLSL = `float sq(float x){ return x*x; }
`;
// last line of defence before the bloom: any non-finite or runaway value becomes the room tone, never black
const SANITIZE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
void main(){ vec4 c=texture2D(tDiffuse,vUv);
  bool bad=any(isnan(c))||any(isinf(c));
  c=bad?vec4(.004,.004,.014,1.):clamp(c,vec4(0.),vec4(64.));
  gl_FragColor=vec4(max(c.rgb,vec3(.0028,.0028,.009)),1.); }`
};

function radialTex(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => r.addColorStop(o, col)); g.fillStyle = r; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function textTex(text, w, h, font, glow) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = glow; g.shadowBlur = h * 0.25; g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, h / 2); g.shadowBlur = h * 0.08; g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const WALL_VS = `varying vec2 vUv; varying vec3 vW;
void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;
const WALL_FS = `uniform float uTime; uniform vec3 uCursor; uniform vec2 uSize; uniform float uKind; uniform vec3 uSph;
varying vec2 vUv; varying vec3 vW;
float gridLine(vec2 p, float w){ vec2 g=abs(fract(p)-.5); return 1.-smoothstep(.5-w,.5,max(g.x,g.y)); }
void main(){
  vec2 p=vUv*uSize;
  float hgt=clamp((vW.y+640.)/1620.,0.,1.);
  vec3 col=mix(vec3(.003,.004,.016),vec3(.010,.010,.040),hgt);
  if(uKind>1.5) col=vec3(.002,.002,.010);                         // ceiling
  // architectural panel seams + fine tech grid
  float seams=gridLine(p/vec2(420.,300.),.004);
  float fine=gridLine(p/42.,.012)*.35;
  float scan=smoothstep(.0,.9,sin(p.y*.006-uTime*.35)*.5+.5);
  vec3 lineC=mix(vec3(.18,.22,.85),vec3(.45,.25,.95),vUv.x);
  col+=lineC*(seams*.06+fine*.012)*(.5+.5*scan);
  // soft light from the hologram sphere
  float ds=distance(vW,uSph); col+=vec3(.10,.10,.45)*.40*exp(-ds*ds/(2.*800.*800.));
  // the cursor is a soft light that moves across the room
  float dc=distance(vW,uCursor); col+=vec3(.28,.24,.95)*.13*exp(-dc*dc/(2.*460.*460.));
  // neon base strip near the floor
  if(uKind<1.5){ float b=exp(-sq((vW.y+600.)/14.)); col+=vec3(.35,.30,1.)*b*.45; }
  gl_FragColor=vec4(col*.32+vec3(.0032,.0032,.010),1.);
}`;

const FLOOR_FS = `uniform float uTime; uniform vec3 uCursor; uniform vec3 uSph; uniform float uRefl;
varying vec2 vUv; varying vec3 vW;
float gridLine(vec2 p, float w){ vec2 g=abs(fract(p)-.5); return 1.-smoothstep(.5-w,.5,max(g.x,g.y)); }
void main(){
  vec2 p=vW.xz;
  float fade=smoothstep(2600.,200.,length(p-vec2(0.,-600.)));
  float grid=gridLine(p/120.,.010)*fade;
  vec3 col=vec3(.004,.005,.018);
  col+=vec3(.20,.24,.9)*grid*.07;
  float ds=distance(p,uSph.xz); col+=vec3(.20,.18,.95)*.32*exp(-ds*ds/(2.*620.*620.));
  float dc=distance(p,uCursor.xz); col+=vec3(.35,.28,1.)*.10*exp(-dc*dc/(2.*480.*480.));
  float a=mix(.97,.80,uRefl);                // how much of the mirror below shows through
  gl_FragColor=vec4(col*.32+vec3(.0030,.0030,.010),a);
}`;

const SHELL_FS = `uniform float uTime; uniform float uI; varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP;
float ln(float x,float w){ float f=fract(x); return 1.-smoothstep(0.,w,min(f,1.-f)); }
void main(){
  float fr=sq(clamp(1.-abs(dot(vN,vV)),0.,1.));
  float grid=max(ln(vUv.x*48.+uTime*.012,.05),ln(vUv.y*30.,.06));
  float band=.5+.5*sin(vP.y*.035-uTime*1.1);
  vec3 c1=vec3(.02,.22,1.0),c2=vec3(.05,.55,1.3),c3=vec3(.15,.75,1.5);
  vec3 col=mix(c1,c2,fr);
  col=col*(fr*1.5+grid*(.10+.55*fr)+.03)+c3*grid*band*.12*(.3+fr)+vec3(.25,.75,1.4)*sq(sq(fr))*fr*1.3;
  gl_FragColor=vec4(col*uI,1.);
}`;
const SHELL_VS = `varying vec3 vN; varying vec3 vV; varying vec2 vUv; varying vec3 vP;
void main(){ vUv=uv; vP=position; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;

const PLAT_FS = `uniform float uTime; varying vec2 vUv;
void main(){
  vec2 p=(vUv-.5)*2.; float r=length(p); float a=atan(p.y,p.x+1e-6);
  float rings=0.;
  for(int i=0;i<6;i++){ float rr=.16+float(i)*.135; rings+=exp(-sq((r-rr)/.0045))*(1.-float(i)*.12); }
  float ticks=step(.55,fract((a+uTime*.05)*36./6.2832))*exp(-sq((r-.43)/.02))*.7;
  float dash=step(.5,fract((a-uTime*.08)*12./6.2832))*exp(-sq((r-.71)/.006));
  float core=exp(-r*r/.03)*.5;
  vec3 col=mix(vec3(.15,.75,1.6),vec3(.35,.40,1.6),smoothstep(.1,.9,r));
  float v=(rings+ticks+dash*.9+core)*smoothstep(1.,.6,r);
  gl_FragColor=vec4(col*v*.8,1.);
}`;

const BEAM_FS = `uniform float uTime; uniform float uSeed; varying vec2 vUv;
void main(){
  float x=clamp(1.-abs(vUv.x-.5)*2.,0.,1.); float fl=.55+.45*sin(uTime*(1.3+uSeed*2.)+uSeed*40.);
  float v=x*x*x*pow(clamp(1.-vUv.y,0.,1.),1.6)*fl;
  vec3 col=mix(vec3(.3,.8,1.),vec3(.55,.4,1.),uSeed);
  gl_FragColor=vec4(col*v*.65,1.);
}`;

const LEM_FS = `uniform float uTime; varying vec2 vUv;
void main(){
  float t=vUv.x; vec3 a=vec3(.70,.85,1.),b=vec3(1.,1.,1.),c=vec3(.65,.90,1.);
  vec3 col=t<.5?mix(a,b,t*2.):mix(b,c,t*2.-1.);
  float sweep=exp(-sq(fract(t-uTime*.12)-.5)/.004);
  gl_FragColor=vec4(col*(1.15+.7*sweep),1.);
}`;

const WIN_FS = `uniform sampler2D uMap; uniform vec2 uPar; uniform float uTime; uniform float uGlow; uniform vec2 uSize; varying vec2 vUv;
float rbox(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
void main(){
  vec2 uv=vUv; vec2 c=uv-.5;
  vec2 tuv=.5+c*.92+uPar*.035;                              // parallax: the city sits "behind" the glass
  vec3 img=texture2D(uMap,tuv).rgb;
  img=pow(max(img,vec3(0.)),vec3(1.05))*vec3(.92,.95,1.08);
  img=max(img,vec3(.012,.012,.03));                         // the darkest picture pixels stay room-tone, never black
  float scan=.965+.035*sin(vUv.y*uSize.y*1.4+uTime*2.);
  float d=rbox(c*uSize,uSize*.5,22.);
  float inside=1.-smoothstep(-1.5,0.,d);
  float edge=exp(-sq(d/3.))+.35*exp(-abs(d)/22.);
  vec3 ec=mix(vec3(.36,.48,1.),vec3(.72,.45,1.),vUv.y)+vec3(.2,.6,.7)*smoothstep(.6,1.,vUv.x);
  vec3 col=img*scan*inside*.80+ec*edge*(.75+.7*uGlow);
  float a=max(inside,edge*.9);
  gl_FragColor=vec4(col,a);
}`;

const PETAL_VS = `attribute vec4 aSeed; uniform float uTime; uniform float uScale; uniform vec3 uBox; uniform vec3 uMin; uniform float uSpeed;
varying float vAng; varying float vFlip; varying float vTint; varying float vA;
void main(){
  float t=uTime*uSpeed;
  vec3 p=position;
  p.y=uMin.y+mod(p.y-uMin.y-t*(22.+aSeed.x*26.),uBox.y);
  p.x=uMin.x+mod(p.x-uMin.x+t*(9.+aSeed.y*8.)+sin(t*.6+aSeed.z*6.28)*60.,uBox.x);
  p.z+=sin(t*.4+aSeed.w*6.28)*40.;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  gl_PointSize=clamp(uScale*(20.+aSeed.w*16.)/-mv.z,1.,72.);
  vAng=t*(.6+aSeed.x)+aSeed.z*6.28; vFlip=sin(t*(1.+aSeed.y)+aSeed.w*9.); vTint=aSeed.z;
  float edgeF=smoothstep(0.,80.,p.y-uMin.y)*smoothstep(0.,120.,uMin.y+uBox.y-p.y);
  vA=edgeF*(.55+.45*aSeed.y);
  gl_Position=projectionMatrix*mv;
}`;
const PETAL_FS = `uniform float uOpacity; varying float vAng; varying float vFlip; varying float vTint; varying float vA;
void main(){
  vec2 p=(gl_PointCoord-.5)*2.; float s=sin(vAng),c=cos(vAng); p=mat2(c,-s,s,c)*p;
  p.x/=max(.25,abs(vFlip));
  float d=length(vec2(p.x*1.25,p.y*.95+.08*p.x*p.x));
  float body=1.-smoothstep(.62,.9,d);
  body*=smoothstep(.0,.22,length(p-vec2(0.,.86)));
  if(body<.01) discard;
  vec3 col=mix(vec3(1.,.46,.74),vec3(.80,.55,1.),vTint)*(.7+.3*(1.-d));
  gl_FragColor=vec4(col,body*vA*uOpacity);
}`;

const DUST_VS = `attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
void main(){ vec3 p=position; p.y+=sin(uTime*.25+aSeed*30.)*30.; p.x+=cos(uTime*.2+aSeed*20.)*25.;
  vec4 mv=modelViewMatrix*vec4(p,1.); gl_PointSize=clamp(uScale*(2.+aSeed*3.)/-mv.z,1.,6.);
  vA=.35+.65*(.5+.5*sin(uTime*(1.+aSeed*2.)+aSeed*50.)); gl_Position=projectionMatrix*mv; }`;
const DUST_FS = `varying float vA; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard;
  gl_FragColor=vec4(vec3(.55,.65,1.)*(1.-d*2.)*vA*.9,1.); }`;

function makePetals(n, min, box, scaleRef) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = min.x + Math.random() * box.x; pos[i * 3 + 1] = min.y + Math.random() * box.y; pos[i * 3 + 2] = min.z + Math.random() * box.z;
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const m = new THREE.ShaderMaterial({
    vertexShader: PETAL_VS, fragmentShader: PETAL_FS, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScale: scaleRef, uBox: { value: box }, uMin: { value: min }, uSpeed: { value: 1 }, uOpacity: { value: .9 } }
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false; return p;
}

export class Room {
  constructor(host, opts) {
    this.q = opts.quality; this.rm = opts.reducedMotion;
    // alpha:true + an opaque clear: the canvas is never promoted to a GPU overlay/underlay (Chrome/Windows DirectComposition
    // punches black rectangles through underlays when 3D-transformed HTML moves on top of them)
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: this.q >= 2, powerPreference: 'high-performance', alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    r.setClearColor(0x0c0d2a, 1); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    host.appendChild(r.domElement);
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.FogExp2(0x0a0b26, 0.00011);
    this.t = 0; this.cursor = new THREE.Vector3(0, 0, -900);
    this.uScale = { value: 900 };
    this.U = []; // materials with uTime
    this.build();
  }
  mat(fs, vs, uniforms, extra = {}) {
    const m = new THREE.ShaderMaterial(Object.assign({ vertexShader: vs || WALL_VS, fragmentShader: SAFE_GLSL + fs, uniforms: Object.assign({ uTime: { value: 0 } }, uniforms) }, extra));
    this.U.push(m); return m;
  }
  build() {
    const S = this.scene, R = ROOM;
    const W = R.side * 2, H = R.ceil - R.floor, Dp = R.front - R.back;
    const wallU = k => ({ uCursor: { value: this.cursor }, uSize: { value: new THREE.Vector2(k[0], k[1]) }, uKind: { value: k[2] }, uSph: { value: SPHERE } });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.mat(WALL_FS, null, wallU([W, H, 0])));
    back.position.set(0, (R.ceil + R.floor) / 2, R.back); S.add(back);
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(Dp, H), this.mat(WALL_FS, null, wallU([Dp, H, 1])));
      w.rotation.y = -s * Math.PI / 2; w.position.set(s * R.side, (R.ceil + R.floor) / 2, (R.front + R.back) / 2); S.add(w);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), this.mat(WALL_FS, null, wallU([W, Dp, 2])));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, R.ceil, (R.front + R.back) / 2); S.add(ceil);
    // ceiling light strips (soft, blooming)
    const stripM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.5, 1.6), transparent: true, opacity: .55, blending: add, depthWrite: false });
    for (const x of [-900, 900]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(10, Dp * .8), stripM); s.rotation.x = Math.PI / 2; s.position.set(x, R.ceil - 2, R.back + Dp * .45); S.add(s); }
    // vertical corner light lines at the back corners
    const vM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.55, 1.8), transparent: true, opacity: .22, blending: add, depthWrite: false });
    for (const s of [-1, 1]) { const v = new THREE.Mesh(new THREE.PlaneGeometry(6, H), vM); v.position.set(s * (R.side - 4), (R.ceil + R.floor) / 2, R.back + 4); S.add(v); }

    // floor: real-time mirror (high quality) under a translucent dark glossy layer
    if (this.q >= 2) {
      this.mirror = new Reflector(new THREE.PlaneGeometry(W, Dp), { clipBias: 0.003, textureWidth: 512, textureHeight: 512, color: 0x8a8fb5 });
      this.mirror.rotation.x = -Math.PI / 2; this.mirror.position.set(0, R.floor - 1, (R.front + R.back) / 2); S.add(this.mirror);
    }
    this.floorM = this.mat(FLOOR_FS, null, { uCursor: { value: this.cursor }, uSph: { value: SPHERE }, uRefl: { value: this.mirror ? 1 : 0 } }, { transparent: true, depthWrite: false });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), this.floorM);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, R.floor, (R.front + R.back) / 2); floor.renderOrder = 1; S.add(floor);

    this.buildSphere();
    this.buildParticles();
  }
  buildSphere() {
    const S = this.scene, g = this.sph = new THREE.Group(); g.position.copy(SPHERE); g.scale.setScalar(SPHERE_SCALE); S.add(g);
    const Rr = 330;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(30,110,255,0.32)'], [.25, 'rgba(20,80,255,0.13)'], [.6, 'rgba(20,40,200,0.03)'], [1, 'rgba(0,0,0,0)']]), blending: add, depthWrite: false, transparent: true }));
    halo.scale.set(Rr * 3.8, Rr * 3.8, 1); halo.position.z = -Rr * 1.15; g.add(halo); this.halo = halo;
    this.shellM = this.mat(SHELL_FS, SHELL_VS, { uI: { value: 1 } }, { transparent: true, blending: add, depthWrite: false });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(Rr, this.q >= 2 ? 96 : 48, this.q >= 2 ? 64 : 32), this.shellM);
    g.add(shell); this.shell = shell;
    // deep-blue body behind the glowing layers, so the white logo and text read clearly
    const body = new THREE.Mesh(new THREE.SphereGeometry(Rr * .965, 64, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.004, 0.018, 0.10), transparent: true, opacity: .82, depthWrite: false, side: THREE.BackSide }));
    body.renderOrder = -1; g.add(body);
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(20,80,255,0.22)'], [.3, 'rgba(10,50,200,0.10)'], [.6, 'rgba(10,30,160,0.03)'], [1, 'rgba(0,0,0,0)']]), blending: add, depthWrite: false, transparent: true }));
    core.scale.set(Rr * 1.5, Rr * 1.5, 1); core.position.z = -Rr * 1.1; g.add(core);
    // point shell
    { const n = this.q >= 2 ? 1400 : 700, pos = new Float32Array(n * 3), sd = new Float32Array(n);
      for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rr = Rr * (1.0 + Math.pow(Math.random(), 3) * .35), s = Math.sqrt(1 - u * u);
        pos.set([rr * s * Math.cos(th), rr * u, rr * s * Math.sin(th)], i * 3); sd[i] = Math.random(); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
      const m = this.mat(DUST_FS, DUST_VS, { uScale: this.uScale }, { transparent: true, blending: add, depthWrite: false });
      this.shellPts = new THREE.Points(geo, m); g.add(this.shellPts); }
    // infinity logo (lemniscate tube) + "Liteya"
    { const a = 150; class Lem extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const u = t * Math.PI * 2, s = Math.sin(u), c = Math.cos(u), d = 1 + s * s;
        return o.set(a * c / d * 1.15, a * s * c / d * 1.05, 26 * Math.sin(u)); } }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new Lem(), 400, 10, 16, true), this.mat(LEM_FS, `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, {}));
      this.logo = new THREE.Group(); this.logo.add(tube); this.logo.position.y = 30; g.add(this.logo);
      const txt = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex('Liteya', 1024, 256, '650 160px system-ui,"Segoe UI",Roboto,sans-serif', 'rgba(120,190,255,.9)'), transparent: true, depthWrite: false }));
      txt.scale.set(380, 95, 1); txt.position.set(0, -104, 60); txt.renderOrder = 10; this.logoText = txt; g.add(txt); }
    // orbital rings
    this.rings = [];
    const ringDefs = [[1.32, 4.0, [0.05, 0.45, 1.5], 1.36, 0.10, .05], [1.48, 3.0, [0.50, 0.15, 1.5], 1.22, 0.42, -.035], [1.66, 3.2, [0.05, 0.65, 1.4], 1.44, -0.30, .025],
      [1.95, 2.4, [0.40, 0.20, 1.4], 1.50, 0.18, -.015], [2.30, 2.6, [0.05, 0.40, 1.4], 1.40, -0.12, .02], [2.95, 2.2, [0.30, 0.25, 1.3], 1.47, -0.05, .01]];
    for (const [rad, tube, col, tx, tz, sp] of ringDefs) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(...col), transparent: true, opacity: 1, blending: add, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Rr * rad, tube, 8, 360), m);
      const piv = new THREE.Group(); piv.rotation.set(tx, 0, tz); piv.add(ring); g.add(piv);
      // a bright bead travelling on the ring
      const bead = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,255,255,1)'], [.3, 'rgba(150,170,255,.6)'], [1, 'rgba(0,0,0,0)']]), blending: add, depthWrite: false, transparent: true }));
      bead.scale.set(46, 46, 1); ring.add(bead); bead.userData.r = Rr * rad;
      this.rings.push({ piv, ring, bead, sp, tx, tz });
    }
    // dashed equator band
    { const m = this.mat(`uniform float uTime; varying vec2 vUv; void main(){ float a=vUv.x; float d=step(.45,fract(a*90.-uTime*.4)); float e=1.-abs(vUv.y-.5)*2.; gl_FragColor=vec4(vec3(.35,.75,1.)*d*e*.9,1.); }`,
      `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, {}, { transparent: true, blending: add, depthWrite: false, side: THREE.DoubleSide });
      const geo = new THREE.CylinderGeometry(Rr * 2.55, Rr * 2.55, 6, 256, 1, true);
      const band = new THREE.Mesh(geo, m); band.rotation.x = 0.08; g.add(band); this.band = band; }
    { const ico = new THREE.IcosahedronGeometry(Rr * .985, 3), edges = new THREE.EdgesGeometry(ico, 1);
      this.net = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: new THREE.Color(0.05, 0.40, 1.3), transparent: true, opacity: .5, blending: add, depthWrite: false }));
      g.add(this.net);
      const nodes = new THREE.Points(ico, new THREE.PointsMaterial({ color: new THREE.Color(0.35, 0.75, 1.6), size: 6, sizeAttenuation: true, transparent: true, opacity: .9, blending: add, depthWrite: false, map: radialTex([[0, 'rgba(255,255,255,1)'], [.4, 'rgba(160,210,255,.5)'], [1, 'rgba(0,0,0,0)']], 64) }));
      this.net.add(nodes); }
    { const streakFS = `uniform float uTime; uniform float uSeed; varying vec2 vUv;
        void main(){ float x=1.-abs(vUv.x-.5)*2.; float run=fract(vUv.y*3.-uTime*(.25+uSeed*.4)+uSeed*7.);
          float dash=smoothstep(.0,.08,run)*smoothstep(.55,.25,run);
          float v=x*x*(.25+.75*dash)*smoothstep(1.,.2,vUv.y)*smoothstep(0.,.15,vUv.y);
          gl_FragColor=vec4(vec3(.06,.45,1.4)*v*(.5+.5*uSeed),1.); }`;
      const vs = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
      const n = this.q >= 2 ? 46 : 22;
      for (let i = 0; i < n; i++) { const sd = Math.random(), h = 300 + Math.random() * 700;
        const st = new THREE.Mesh(new THREE.PlaneGeometry(3 + Math.random() * 5, h), this.mat(streakFS, vs, { uSeed: { value: sd } }, { transparent: true, blending: add, depthWrite: false }));
        st.position.set((Math.random() - .5) * Rr * 3.2, Rr * .55 + h / 2, (Math.random() - .5) * Rr * .8); g.add(st); } }
    { const disc = new THREE.Mesh(new THREE.PlaneGeometry(Rr * 4.6, Rr * 4.6), this.mat(PLAT_FS, `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, {}, { transparent: true, blending: add, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = -Rr * 1.22; disc.scale.setScalar(1); g.add(disc); }
    // floor platform + beams
    const plat = new THREE.Mesh(new THREE.PlaneGeometry(1900, 1900), this.mat(PLAT_FS, `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, {}, { transparent: true, blending: add, depthWrite: false }));
    plat.rotation.x = -Math.PI / 2; plat.position.set(SPHERE.x, ROOM.floor + 2, SPHERE.z); plat.renderOrder = 2; this.scene.add(plat);
    const nb = this.q >= 2 ? 34 : 16; this.beams = [];
    for (let i = 0; i < nb; i++) {
      const sd = Math.random(), h = 260 + Math.random() * 700, ang = Math.random() * Math.PI * 2, rad = 260 + Math.random() * 420;
      const m = this.mat(BEAM_FS, `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, { uSeed: { value: sd } }, { transparent: true, blending: add, depthWrite: false, side: THREE.DoubleSide });
      const b = new THREE.Mesh(new THREE.PlaneGeometry(4 + Math.random() * 10, h), m);
      b.position.set(SPHERE.x + Math.cos(ang) * rad, ROOM.floor + h / 2, SPHERE.z + Math.sin(ang) * rad * .6);
      this.scene.add(b); this.beams.push(b);
    }
  }
  buildParticles() {
    const q = this.q, rm = this.rm;
    const n = rm ? 40 : q >= 2 ? 220 : 90;
    this.petals = makePetals(n, new THREE.Vector3(-1700, -640, -1700), new THREE.Vector3(3400, 1650, 2200), this.uScale);
    this.petals.material.uniforms.uSpeed.value = rm ? .25 : 1; this.scene.add(this.petals); this.U.push(this.petals.material);
    const dn = q >= 2 ? 700 : 250, pos = new Float32Array(dn * 3), sd = new Float32Array(dn);
    for (let i = 0; i < dn; i++) { pos.set([(Math.random() - .5) * 3400, ROOM.floor + Math.random() * 1500, ROOM.back + Math.random() * 2300], i * 3); sd[i] = Math.random(); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    this.dust = new THREE.Points(geo, this.mat(DUST_FS, DUST_VS, { uScale: this.uScale }, { transparent: true, blending: add, depthWrite: false }));
    this.dust.frustumCulled = false; this.scene.add(this.dust);
  }
  // anime night-city window, mounted like a soft-lit holographic pane on the right
  addWindow(texUrl, w, h) {
    const tex = new THREE.TextureLoader().load(texUrl); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = this.mat(WIN_FS, `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      { uMap: { value: tex }, uPar: { value: new THREE.Vector2() }, uGlow: { value: 0 }, uSize: { value: new THREE.Vector2(w, h) } }, { transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w + 60, h + 60), m);
    m.uniforms.uSize.value.set(w, h); mesh.geometry = new THREE.PlaneGeometry(w + 60, h + 60);
    // uv covers the padded quad; remap so the picture fills w×h and the glow spills into the padding
    const uv = mesh.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) { uv.setXY(i, (uv.getX(i) - .5) * (w + 60) / w + .5, (uv.getY(i) - .5) * (h + 60) / h + .5); }
    m.uniforms.uSize.value.set(w, h);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(120,110,255,.30)'], [.5, 'rgba(90,70,220,.10)'], [1, 'rgba(0,0,0,0)']]), blending: add, depthWrite: false, transparent: true }));
    glow.scale.set(w * 2.2, h * 1.7, 1); glow.position.z = -40;
    const grp = new THREE.Group(); grp.add(glow); grp.add(mesh); this.scene.add(grp);
    this.win = { grp, m }; return grp;
  }
  setup(camera, w, h, dpr) {
    this.camera = camera; const r = this.renderer;
    r.setPixelRatio(dpr); r.setSize(w, h);
    if (this.q >= 1) {
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(this.scene, camera));
      this.composer.addPass(new ShaderPass(SANITIZE));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this.q >= 2 ? .6 : .5, .3, .7);
      this.composer.addPass(this.bloom); this.composer.addPass(new OutputPass());
    }
    this.resize(w, h, dpr);
  }
  resize(w, h, dpr) {
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h);
    if (this.composer) { this.composer.setPixelRatio(dpr); this.composer.setSize(w, h); this.bloom.resolution.set(w * dpr, h * dpr); }
    if (this.mirror) { const rt = this.mirror.getRenderTarget(); rt.setSize(Math.round(w * dpr * .5), Math.round(h * dpr * .5)); }
    this.uScale.value = h * dpr * 0.9;
  }
  degrade(level) { // called by the fps governor
    if (level < 2 && this.mirror) { this.mirror.visible = false; this.floorM.uniforms.uRefl.value = 0; }
    if (level < 1 && this.bloom) { this.bloom.enabled = false; }
    this.q = level;
  }
  update(dt, ptr, react) {
    const t = this.t += dt, rm = this.rm, sp = rm ? .25 : 1;
    for (const m of this.U) if (m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = t;
    // sphere softly turns toward the cursor, logo floats, rings orbit
    const s = this.sph;
    s.rotation.y += (ptr.x * .35 - s.rotation.y) * Math.min(1, dt * 1.6);
    s.rotation.x += (-ptr.y * .18 - s.rotation.x) * Math.min(1, dt * 1.6);
    this.shell.rotation.y += dt * .05 * sp; this.shellPts.rotation.y -= dt * .03 * sp; this.net.rotation.y += dt * .035 * sp; this.net.rotation.x = Math.sin(t * .1) * .1;
    this.logo.position.y = 30 + Math.sin(t * .8) * 8 * sp; this.logo.rotation.y = Math.sin(t * .35) * .25 * sp - s.rotation.y * .6;
    this.logoText.material.opacity = .85 + .15 * Math.sin(t * 1.3);
    this.shellM.uniforms.uI.value = .85 + .15 * react;
    for (const r of this.rings) {
      r.ring.rotation.z += dt * r.sp * sp * 2.2;
      const a = t * r.sp * 9 * sp; r.bead.position.set(Math.cos(a) * r.bead.userData.r, Math.sin(a) * r.bead.userData.r, 0);
      r.piv.rotation.x = r.tx + ptr.y * .10; r.piv.rotation.z = r.tz + ptr.x * .08;
    }
    this.band.rotation.y += dt * .02 * sp;
    if (this.win) {
      this.win.m.uniforms.uPar.value.set(ptr.x, ptr.y);
      this.win.m.uniforms.uGlow.value += ((this.winHover ? 1 : 0) - this.win.m.uniforms.uGlow.value) * Math.min(1, dt * 4);
    }
  }
  render() {
    if (this.mirror && this.mirror.visible) { /* Reflector renders itself in onBeforeRender */ }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    // force alpha = 1 on the visible canvas so it is fully opaque (the floor/beams blend alpha < 1)
    const r = this.renderer, gl = r.getContext(); r.setRenderTarget(null);
    gl.colorMask(false, false, false, true); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.colorMask(true, true, true, true);
    r.resetState();
  }
}

// a second, transparent canvas above the HTML panels: a few large out-of-focus petals drifting near the viewer
export class FrontPetals {
  constructor(canvas, n) {
    this.r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, premultipliedAlpha: false });
    this.r.setClearColor(0x000000, 0); this.scene = new THREE.Scene(); this.uScale = { value: 900 };
    this.p = makePetals(n, new THREE.Vector3(-900, -700, 260), new THREE.Vector3(1800, 1500, 500), this.uScale);
    this.p.material.uniforms.uOpacity.value = .42; this.p.material.uniforms.uSpeed.value = .8; this.scene.add(this.p);
  }
  resize(w, h, dpr) { this.r.setPixelRatio(Math.min(dpr, 1)); this.r.setSize(w, h, false); this.uScale.value = h * 1.1; }
  render(camera, t) { this.p.material.uniforms.uTime.value = t; this.r.render(this.scene, camera); }
}
