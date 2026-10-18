import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/* ------------------------------------------------------------------ *
 *  Joule–Lenz law: electrical current heats a conductor.
 *  Micro scale: electrons drift, scatter on lattice ions, transfer
 *  energy. Macro scale: wire temperature rises, glows, radiates.
 * ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const TAU = Math.PI * 2

/* ---------------- physical / visual constants ---------------- */
const WIRE_LEN = 17
const WIRE_R = 1.3
const LATTICE_R = 1.02
const SPACING = 0.55
const N_ELECTRONS = 130

const T_AMB = 22            // °C
const HEAT_CAP = 0.8        // J/K  (thin wire)
const COOL_K = 0.16         // W/K  (convection + radiation, lumped)
const I_MAX = 5
const R_MAX = 8
const P_MAX = I_MAX * I_MAX * R_MAX
const T_GLOW0 = 90          // °C where the wire starts to look warm
const T_GLOW_SPAN = 700

const state = {
  I: 3.2,
  R: 5.5,
  P: 0,
  Q: 0,
  t: 0,
  T: T_AMB,
  h: 0,
  paused: false,
  visT: 0,
}

/* ---------------- renderer ---------------- */
const canvas = $('#scene')
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.98

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x070b12, 0.018)

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  260,
)
const CAM_TARGET = new THREE.Vector3(0, 0.15, 0)
const CAM_DIR = new THREE.Vector3(5.4, 4.6, 17).normalize()
const CAM_DIST = 23
camera.position.copy(CAM_TARGET).addScaledVector(CAM_DIR, CAM_DIST)
camera.lookAt(CAM_TARGET)

/* ---------------- background gradient ---------------- */
function makeBackgroundTexture() {
  const c = document.createElement('canvas')
  c.width = 8
  c.height = 512
  const g = c.getContext('2d')
  const grd = g.createLinearGradient(0, 0, 0, 512)
  grd.addColorStop(0, '#0b1424')
  grd.addColorStop(0.42, '#080d16')
  grd.addColorStop(1, '#030509')
  g.fillStyle = grd
  g.fillRect(0, 0, 8, 512)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}
scene.background = makeBackgroundTexture()

/* ---------------- environment + lights ---------------- */
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.32
pmrem.dispose()

const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x080d14, 0.32)
scene.add(hemi)

const key = new THREE.DirectionalLight(0xcfe0ff, 1.15)
key.position.set(7, 11, 10)
scene.add(key)

const rim = new THREE.DirectionalLight(0x4f86ff, 0.8)
rim.position.set(-10, 5, -9)
scene.add(rim)

const heatLightA = new THREE.PointLight(0xff5a1f, 0, 26, 2)
heatLightA.position.set(-4.4, 0.1, 0)
scene.add(heatLightA)

const heatLightB = new THREE.PointLight(0xff5a1f, 0, 26, 2)
heatLightB.position.set(4.4, 0.1, 0)
scene.add(heatLightB)

const heatLightC = new THREE.PointLight(0xff5a1f, 0, 30, 2)
heatLightC.position.set(0, -2.2, 0)
scene.add(heatLightC)

/* ---------------- controls ---------------- */
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.copy(CAM_TARGET)
controls.enableDamping = true
controls.dampingFactor = 0.065
controls.enablePan = false
controls.rotateSpeed = 0.7
controls.zoomSpeed = 0.8
controls.minDistance = 9
controls.maxDistance = 50
controls.minPolarAngle = 0.52
controls.maxPolarAngle = 1.63
controls.minAzimuthAngle = -1.15
controls.maxAzimuthAngle = 1.15

/* ---------------- helpers ---------------- */
const heatStops = [
  [0.0, new THREE.Color('#1c0a04')],
  [0.3, new THREE.Color('#8c1c05')],
  [0.55, new THREE.Color('#ff4a00')],
  [0.78, new THREE.Color('#ffa02a')],
  [1.0, new THREE.Color('#ffd58e')],
]
function heatColor(h, out = new THREE.Color()) {
  h = clamp(h, 0, 1)
  for (let i = 0; i < heatStops.length - 1; i++) {
    const [p0, c0] = heatStops[i]
    const [p1, c1] = heatStops[i + 1]
    if (h <= p1) {
      const k = (h - p0) / (p1 - p0)
      return out.copy(c0).lerp(c1, k)
    }
  }
  return out.copy(heatStops[heatStops.length - 1][1])
}

function makeDotTexture() {
  const size = 64
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.22, 'rgba(255,255,255,0.85)')
  grd.addColorStop(0.55, 'rgba(255,255,255,0.22)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
const DOT_TEX = makeDotTexture()

function makeShadowTexture() {
  const s = 256
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(s / 2, s / 2, s * 0.02, s / 2, s / 2, s / 2)
  grd.addColorStop(0, 'rgba(0,0,0,0.75)')
  grd.addColorStop(0.35, 'rgba(0,0,0,0.4)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, s, s)
  return new THREE.CanvasTexture(c)
}

function signSprite(positive) {
  const S = 128
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  g.strokeStyle = '#c9e2f7'
  g.lineWidth = 11
  g.lineCap = 'round'
  g.shadowColor = 'rgba(120,200,255,0.55)'
  g.shadowBlur = 14
  g.beginPath()
  g.moveTo(34, 64)
  g.lineTo(94, 64)
  if (positive) {
    g.moveTo(64, 34)
    g.lineTo(64, 94)
  }
  g.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
  )
  sp.scale.set(1.35, 1.35, 1)
  return sp
}

/* ---------------- floor ---------------- */
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(95, 96),
  new THREE.MeshStandardMaterial({
    color: 0x070b12,
    roughness: 0.94,
    metalness: 0.08,
  }),
)
floor.rotation.x = -Math.PI / 2
floor.position.y = -4.3
scene.add(floor)

const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(WIRE_LEN * 1.25, 6.6),
  new THREE.MeshBasicMaterial({
    map: makeShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.95,
  }),
)
shadow.rotation.x = -Math.PI / 2
shadow.position.y = -4.28
scene.add(shadow)

const grid = new THREE.GridHelper(95, 95, 0x1d334d, 0x0f1a27)
grid.position.y = -4.26
grid.material.transparent = true
grid.material.opacity = 0.26
grid.material.depthWrite = false
scene.add(grid)

/* ---------------- conductor ---------------- */
const coreMat = new THREE.MeshStandardMaterial({
  color: 0x2c3d51,
  metalness: 0.95,
  roughness: 0.3,
  transparent: true,
  opacity: 0.17,
  depthWrite: false,
  emissive: new THREE.Color(0x000000),
  emissiveIntensity: 0,
  side: THREE.DoubleSide,
  envMapIntensity: 1,
})
const core = new THREE.Mesh(
  new THREE.CylinderGeometry(WIRE_R, WIRE_R, WIRE_LEN, 56, 1, true),
  coreMat,
)
core.rotation.z = Math.PI / 2
scene.add(core)

const shellMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uColor: { value: new THREE.Color('#4fd0ff') },
    uOpacity: { value: 0.3 },
    uPow: { value: 2.4 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uPow;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
      gl_FragColor = vec4(uColor, f * uOpacity);
    }
  `,
})
const shell = new THREE.Mesh(
  new THREE.CylinderGeometry(WIRE_R * 1.005, WIRE_R * 1.005, WIRE_LEN, 64, 1, true),
  shellMat,
)
shell.rotation.z = Math.PI / 2
scene.add(shell)

const auraMat = shellMat.clone()
auraMat.uniforms.uOpacity.value = 0.03
auraMat.uniforms.uPow.value = 3.6
const aura = new THREE.Mesh(
  new THREE.CylinderGeometry(WIRE_R * 1.8, WIRE_R * 1.8, WIRE_LEN * 1.02, 48, 1, true),
  auraMat,
)
aura.rotation.z = Math.PI / 2
scene.add(aura)

/* ---------------- lattice ---------------- */
const basePositions = []
const phases = []
const speeds = []

for (let x = -WIRE_LEN / 2 + 0.85; x <= WIRE_LEN / 2 - 0.85; x += SPACING) {
  const rowIndex = Math.round((x + WIRE_LEN) / SPACING)
  const off = rowIndex % 2 ? SPACING * 0.5 : 0
  for (let y = -LATTICE_R; y <= LATTICE_R; y += SPACING) {
    for (let z = -LATTICE_R; z <= LATTICE_R; z += SPACING) {
      const yy = y + off * 0.55
      const zz = z + off * 0.55
      if (Math.hypot(yy, zz) > LATTICE_R) continue
      basePositions.push(
        x + (Math.random() - 0.5) * 0.09,
        yy + (Math.random() - 0.5) * 0.09,
        zz + (Math.random() - 0.5) * 0.09,
      )
      phases.push(Math.random() * TAU)
      speeds.push(1.4 + Math.random() * 1.6)
    }
  }
}
const ionCount = phases.length
const ionsBase = new Float32Array(basePositions)
const ionsCurr = new Float32Array(ionCount * 3)

const ionMat = new THREE.MeshStandardMaterial({
  color: 0x50657c,
  roughness: 0.95,
  metalness: 0.0,
  emissive: new THREE.Color(0x000000),
  emissiveIntensity: 0,
  envMapIntensity: 0.15,
})
const ions = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.085, 10, 8),
  ionMat,
  ionCount,
)
ions.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
ions.frustumCulled = false
scene.add(ions)

// bond pairs (nearest neighbours)
const pairs = []
const maxBond = SPACING * 1.12
for (let i = 0; i < ionCount; i++) {
  for (let j = i + 1; j < ionCount; j++) {
    const dx = ionsBase[i * 3] - ionsBase[j * 3]
    const dy = ionsBase[i * 3 + 1] - ionsBase[j * 3 + 1]
    const dz = ionsBase[i * 3 + 2] - ionsBase[j * 3 + 2]
    if (dx * dx + dy * dy + dz * dz < maxBond * maxBond) pairs.push(i, j)
  }
}
const bondGeo = new THREE.BufferGeometry()
const bondPos = new Float32Array((pairs.length / 2) * 6)
bondGeo.setAttribute(
  'position',
  new THREE.BufferAttribute(bondPos, 3).setUsage(THREE.DynamicDrawUsage),
)
const bondMat = new THREE.LineBasicMaterial({
  color: 0x2a5a86,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const bonds = new THREE.LineSegments(bondGeo, bondMat)
bonds.frustumCulled = false
scene.add(bonds)

/* ---------------- electrons ---------------- */
const electronGeo = new THREE.SphereGeometry(0.056, 8, 6)
const electronMat = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0.05, 0.85, 1.15),
})
const electronsMesh = new THREE.InstancedMesh(
  electronGeo,
  electronMat,
  N_ELECTRONS,
)
electronsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
electronsMesh.frustumCulled = false
scene.add(electronsMesh)

const electrons = []
function randomDiscPoint(radius) {
  const a = Math.random() * TAU
  const r = Math.sqrt(Math.random()) * radius
  return [Math.cos(a) * r, Math.sin(a) * r]
}
for (let i = 0; i < N_ELECTRONS; i++) {
  const [y, z] = randomDiscPoint(0.88)
  electrons.push({
    pos: new THREE.Vector3(
      -WIRE_LEN / 2 + 1 + Math.random() * (WIRE_LEN - 2),
      y,
      z,
    ),
    vel: new THREE.Vector3(1.5, 0, 0),
  })
}
const dummyIon = new THREE.Object3D()
const dummyElectron = new THREE.Object3D()

/* ---------------- terminals ---------------- */
const metalMat = new THREE.MeshStandardMaterial({
  color: 0x8e9bab,
  metalness: 0.9,
  roughness: 0.52,
  envMapIntensity: 0.5,
})
const copperMat = new THREE.MeshStandardMaterial({
  color: 0xcf8b4d,
  metalness: 0.9,
  roughness: 0.5,
  envMapIntensity: 0.55,
})

function buildTerminal(sign) {
  const group = new THREE.Group()
  const x = sign * (WIRE_LEN / 2 + 0.35)

  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(1.92, 1.92, 1.65, 56),
    metalMat,
  )
  collar.rotation.z = Math.PI / 2
  group.add(collar)

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.94, 0.085, 12, 56),
    copperMat,
  )
  ring.rotation.y = Math.PI / 2
  group.add(ring)

  const innerRing = ring.clone()
  innerRing.position.x = -sign * 0.72
  group.add(innerRing)

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(1.55, 1.55, 0.14, 48),
    copperMat,
  )
  cap.rotation.z = Math.PI / 2
  cap.position.x = sign * 0.88
  group.add(cap)

  group.position.x = x
  scene.add(group)

  const label = signSprite(sign > 0)
  label.position.set(x, -2.95, 0)
  scene.add(label)

  return group
}
buildTerminal(1)
buildTerminal(-1)

/* ---------------- current arrows ---------------- */
const arrowMat = new THREE.MeshBasicMaterial({
  color: 0x5fd8ff,
  transparent: true,
  opacity: 0.5,
})
const arrows = []
const ARROW_N = 6
for (let i = 0; i < ARROW_N; i++) {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.115, 0.4, 12),
    arrowMat.clone(),
  )
  cone.rotation.z = -Math.PI / 2
  cone.position.set(-6.4 + i * 2.55, 2.15, 0)
  scene.add(cone)
  arrows.push(cone)
}

/* ---------------- particles ---------------- */
class ParticleField {
  constructor(max, texture, pixelRatio) {
    this.max = max
    this.list = []
    this.pos = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.siz = new Float32Array(max)
    this.alp = new Float32Array(max)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
    )
    geo.setAttribute(
      'aColor',
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage),
    )
    geo.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage),
    )
    geo.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage),
    )
    geo.setDrawRange(0, 0)

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: texture },
        uScale: { value: 340 * pixelRatio },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uScale / max(0.001, -mv.z), 1.0, 90.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(vColor, 1.0) * a * vAlpha;
        }
      `,
    })

    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 8
    this.geo = geo
    scene.add(this.points)
  }

  spawn(x, y, z, color, size, life, vx = 0, vy = 0, vz = 0, buoy = 0) {
    if (this.list.length >= this.max) return
    this.list.push({
      x, y, z, vx, vy, vz, buoy,
      life,
      maxLife: life,
      size,
      r: color.r,
      g: color.g,
      b: color.b,
    })
  }

  update(dt) {
    const list = this.list
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]
      p.life -= dt
      if (p.life <= 0) {
        list.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      p.vy += p.buoy * dt
    }

    let n = 0
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const k = p.life / p.maxLife
      const elapsed = 1 - k
      const alpha = Math.min(1, elapsed * 7) * k * 0.9
      const i3 = n * 3
      this.pos[i3] = p.x
      this.pos[i3 + 1] = p.y
      this.pos[i3 + 2] = p.z
      this.col[i3] = p.r
      this.col[i3 + 1] = p.g
      this.col[i3 + 2] = p.b
      this.siz[n] = p.size
      this.alp[n] = alpha
      n++
    }

    this.geo.setDrawRange(0, n)
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aColor.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
    this.geo.attributes.aAlpha.needsUpdate = true
  }

  clear() {
    this.list.length = 0
    this.geo.setDrawRange(0, 0)
  }
}

const dpr = Math.min(window.devicePixelRatio || 1, 2)
const heatParticles = new ParticleField(460, DOT_TEX, dpr)
const flashParticles = new ParticleField(200, DOT_TEX, dpr)

const FLASH_COLOR = new THREE.Color(0.75, 2.3, 3.1)
const heatTmp = new THREE.Color()
const flashTmp = new THREE.Color()

let heatAccum = 0

/* ---------------- composer ---------------- */
const composer = new EffectComposer(renderer)
composer.setPixelRatio(dpr)
composer.setSize(window.innerWidth, window.innerHeight)
composer.addPass(new RenderPass(scene, camera))

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5,
  0.5,
  0.9,
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

/* ---------------- camera framing ---------------- */
let lastNarrow = null
let userMovedCam = false
controls.addEventListener('start', () => {
  userMovedCam = true
})
controls.maxDistance = 70

const PANEL_SPACE = 380
const fitA = new THREE.Vector3(-10, 0, 0)
const fitB = new THREE.Vector3(10, 0, 0)
const fitCenter = new THREE.Vector3()
const fitScratch = new THREE.Vector3()

function applyProjection(narrow, w, h) {
  camera.fov = narrow ? 54 : 42
  camera.clearViewOffset()
  if (narrow) {
    camera.setViewOffset(w, h, 0, Math.round(h * 0.2), w, h)
  } else {
    camera.setViewOffset(w, h, Math.round(PANEL_SPACE / 2), 0, w, h)
  }
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

// Pick the camera distance that fits the conductor into the free area
// left of the side panel. Uses the real projection, so perspective is
// handled correctly at any aspect ratio.
function fitDistance(narrow, w) {
  const dir = narrow
    ? new THREE.Vector3(4.6, 3.6, 17).normalize()
    : CAM_DIR
  const freeLimit = ((w - PANEL_SPACE) / w) * 0.93
  const sizeLimit = 1050 / w
  const limit = narrow ? 0.93 : Math.min(freeLimit, sizeLimit)
  let lo = 10
  let hi = 70
  for (let i = 0; i < 30; i++) {
    const d = (lo + hi) / 2
    camera.position.copy(CAM_TARGET).addScaledVector(dir, d)
    camera.lookAt(CAM_TARGET)
    camera.updateMatrixWorld(true)
    const cx = fitScratch.copy(CAM_TARGET).project(camera).x
    const ax = fitScratch.copy(fitA).project(camera).x
    const bx = fitScratch.copy(fitB).project(camera).x
    const half = Math.max(Math.abs(ax - cx), Math.abs(bx - cx))
    if (half > limit) lo = d
    else hi = d
  }
  const d = (lo + hi) / 2
  camera.position.copy(CAM_TARGET).addScaledVector(dir, d)
  controls.target.copy(CAM_TARGET)
  controls.update()
}

function updateViewOffset(refit = false) {
  const w = window.innerWidth
  const h = window.innerHeight
  const narrow = w <= 900
  applyProjection(narrow, w, h)

  const breakpointChanged = narrow !== lastNarrow
  if (refit || breakpointChanged || !userMovedCam) {
    fitDistance(narrow, w)
  }
  lastNarrow = narrow
}
updateViewOffset()

/* ---------------- simulation ---------------- */
function simulate(dt) {
  const P = state.I * state.I * state.R
  state.P = P
  state.t += dt
  state.Q += P * dt
  state.T += ((P - COOL_K * (state.T - T_AMB)) / HEAT_CAP) * dt
  state.h = clamp((state.T - T_GLOW0) / T_GLOW_SPAN, 0, 1)
  state.visT += dt
}

function electronsDrift() {
  return 1.0 + 2.4 * (state.I / I_MAX)
}

function updateElectrons(dt) {
  const drift = electronsDrift()
  const collisionRate = 0.35 + 1.25 * (state.I / I_MAX)

  for (let i = 0; i < N_ELECTRONS; i++) {
    const e = electrons[i]

    e.vel.x += (drift - e.vel.x) * Math.min(1, dt * 2.6)
    e.vel.y += (-e.pos.y * 9 - e.vel.y * 2.4) * dt
    e.vel.z += (-e.pos.z * 9 - e.vel.z * 2.4) * dt

    e.pos.addScaledVector(e.vel, dt)

    const r = Math.hypot(e.pos.y, e.pos.z)
    if (r > 0.92) {
      const k = 0.92 / r
      e.pos.y *= k
      e.pos.z *= k
      e.vel.y *= -0.45
      e.vel.z *= -0.45
    }

    if (e.pos.x > WIRE_LEN / 2 - 0.2) {
      e.pos.x = -WIRE_LEN / 2 + 0.2
      const [y, z] = randomDiscPoint(0.88)
      e.pos.y = y
      e.pos.z = z
    }

    if (Math.random() < collisionRate * dt) {
      const strength = state.I / I_MAX
      flashTmp.copy(FLASH_COLOR).multiplyScalar(0.5 + 0.9 * strength * strength)
      flashParticles.spawn(
        e.pos.x,
        e.pos.y,
        e.pos.z,
        flashTmp,
        0.16 + 0.34 * strength * strength,
        0.16 + Math.random() * 0.1,
      )
      e.vel.set(
        drift * (0.25 + Math.random() * 0.75),
        (Math.random() * 2 - 1) * 2.6,
        (Math.random() * 2 - 1) * 2.6,
      )
    }

    dummyElectron.position.copy(e.pos)
    dummyElectron.updateMatrix()
    electronsMesh.setMatrixAt(i, dummyElectron.matrix)
  }
  electronsMesh.instanceMatrix.needsUpdate = true
}

function updateLattice() {
  const amp = 0.012 + 0.062 * state.h
  const t = state.visT

  for (let i = 0; i < ionCount; i++) {
    const i3 = i * 3
    const ph = phases[i]
    const sp = speeds[i]
    const a = Math.sin(t * sp + ph)
    const b = Math.cos(t * sp * 1.63 + ph * 1.7)
    ionsCurr[i3] = ionsBase[i3] + a * amp
    ionsCurr[i3 + 1] = ionsBase[i3 + 1] + b * amp
    ionsCurr[i3 + 2] = ionsBase[i3 + 2] + (a * 0.6 - b * 0.35) * amp

    dummyIon.position.set(ionsCurr[i3], ionsCurr[i3 + 1], ionsCurr[i3 + 2])
    dummyIon.updateMatrix()
    ions.setMatrixAt(i, dummyIon.matrix)
  }
  ions.instanceMatrix.needsUpdate = true

  for (let k = 0; k < pairs.length; k += 2) {
    const a = pairs[k] * 3
    const b = pairs[k + 1] * 3
    const o = (k / 2) * 6
    bondPos[o] = ionsCurr[a]
    bondPos[o + 1] = ionsCurr[a + 1]
    bondPos[o + 2] = ionsCurr[a + 2]
    bondPos[o + 3] = ionsCurr[b]
    bondPos[o + 4] = ionsCurr[b + 1]
    bondPos[o + 5] = ionsCurr[b + 2]
  }
  bondGeo.attributes.position.needsUpdate = true
}

function updateArrows(dt) {
  const speed = 0.7 + 2.6 * (state.I / I_MAX)
  const half = WIRE_LEN / 2 - 0.9
  for (const a of arrows) {
    a.position.x += speed * dt
    if (a.position.x > half) a.position.x -= half * 2
    a.material.opacity = 0.05 + 0.42 * (state.I / I_MAX)
  }
}

function spawnHeat(dt) {
  const rate = 4 + state.P * 0.2
  heatAccum += rate * dt
  let guard = 0
  while (heatAccum >= 1 && guard++ < 40) {
    heatAccum -= 1
    const ang = Math.random() * TAU
    const rad = WIRE_R * (0.92 + Math.random() * 0.12)
    const x = (Math.random() - 0.5) * (WIRE_LEN - 2.6)
    heatColor(Math.max(state.h, 0.26), heatTmp).multiplyScalar(1.1)
    heatParticles.spawn(
      x,
      Math.cos(ang) * rad,
      Math.sin(ang) * rad,
      heatTmp,
      0.26 + Math.random() * 0.46,
      1.2 + Math.random() * 1.5,
      (Math.random() - 0.5) * 0.35,
      0.5 + Math.random() * 0.85,
      (Math.random() - 0.5) * 0.35,
      0.25,
    )
  }
}

const COOL_SHELL = new THREE.Color('#4fd0ff')
const BOND_COLOR = new THREE.Color('#2b4d70')
const tmpColor = new THREE.Color()

function updateGlow() {
  const h = state.h
  const heat = heatColor(h, tmpColor)

  // conductor
  coreMat.emissive.copy(heat)
  coreMat.emissiveIntensity = 0.04 + 0.62 * Math.pow(h, 1.3)
  coreMat.opacity = 0.15 + 0.12 * h

  // glass shell: cool at rest, warm when hot
  shellMat.uniforms.uColor.value
    .copy(COOL_SHELL)
    .lerp(heat, Math.min(1, h * 1.7))
  shellMat.uniforms.uOpacity.value = 0.26 + 0.16 * h
  auraMat.uniforms.uColor.value.copy(heat).lerp(COOL_SHELL, 1 - h * 0.95)
  auraMat.uniforms.uOpacity.value = 0.015 + 0.1 * h

  // lattice glows from the inside
  ionMat.emissive.copy(heat)
  ionMat.emissiveIntensity = 1.7 * h

  // heat lights
  const li = 4.5 * h
  heatLightA.intensity = li
  heatLightB.intensity = li
  heatLightC.intensity = li * 0.55
  heatLightA.color.copy(heat)
  heatLightB.color.copy(heat)
  heatLightC.color.copy(heat)

  // bonds get warmer too
  bondMat.color.copy(BOND_COLOR).lerp(heat, h * 0.65)
}

/* ---------------- UI ---------------- */
const iEl = $('#i')
const rEl = $('#r')
const iVal = $('#i-val')
const rVal = $('#r-val')
const qVal = $('#q-val')
const pVal = $('#p-val')
const tVal = $('#t-val')
const pBar = $('#p-bar')
const pPct = $('#p-pct')
const timeVal = $('#time-val')
const formulaNow = $('#formula-now')
const playBtn = $('#play')
const playLabel = $('#play-label')
const playIcon = $('#play-icon')
const resetBtn = $('#reset')
const chartEl = $('#chart')
const chartCtx = chartEl.getContext('2d')

const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

function setFill(input) {
  const min = parseFloat(input.min)
  const max = parseFloat(input.max)
  const v = parseFloat(input.value)
  const pct = ((v - min) / (max - min)) * 100
  input.style.setProperty('--fill', pct.toFixed(1) + '%')
}

function syncSliders() {
  iVal.textContent = nf1.format(state.I) + ' А'
  rVal.textContent = nf1.format(state.R) + ' Ом'
  setFill(iEl)
  setFill(rEl)
}

iEl.addEventListener('input', () => {
  state.I = parseFloat(iEl.value)
  syncSliders()
  updateHUD()
})
rEl.addEventListener('input', () => {
  state.R = parseFloat(rEl.value)
  syncSliders()
  updateHUD()
})

function setPaused(p) {
  state.paused = p
  playLabel.textContent = p ? 'Продолжить' : 'Пауза'
  playIcon.innerHTML = p
    ? '<path d="M8 5.5v13l11-6.5z"/>'
    : '<rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/>'
}
playBtn.addEventListener('click', () => setPaused(!state.paused))

function resetAll() {
  state.t = 0
  state.Q = 0
  state.T = T_AMB
  state.h = 0
  state.visT = 0
  heatAccum = 0
  samples.length = 0
  chartQMax = 20
  for (const e of electrons) {
    e.pos.x = -WIRE_LEN / 2 + 1 + Math.random() * (WIRE_LEN - 2)
    const [y, z] = randomDiscPoint(0.88)
    e.pos.y = y
    e.pos.z = z
    e.vel.set(electronsDrift(), 0, 0)
  }
  heatParticles.clear()
  flashParticles.clear()
  updateHUD()
  drawChart()
}
resetBtn.addEventListener('click', resetAll)

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    setPaused(!state.paused)
  } else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
    resetAll()
  }
})

/* ---------------- chart ---------------- */
let samples = []
let chartQMax = 20
let chartW = 300
let chartH = 86
let sampleAccum = 0

function fitChart() {
  const rect = chartEl.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  chartEl.width = Math.round(rect.width * ratio)
  chartEl.height = Math.round(rect.height * ratio)
  chartW = rect.width
  chartH = rect.height
  chartCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
  drawChart()
}

function drawChart() {
  const w = chartW
  const h = chartH
  const ctx = chartCtx
  ctx.clearRect(0, 0, w, h)

  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.055)'
  ctx.lineWidth = 1
  for (let i = 1; i <= 3; i++) {
    const y = Math.round((h * i) / 4) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  if (samples.length < 2) return

  const now = samples[samples.length - 1].t
  const window = 30
  const t0 = Math.max(0, now - window)
  const qMax = Math.max(1, chartQMax)

  const pts = samples.filter((s) => s.t >= t0)
  if (pts.length < 2) return

  const X = (t) => ((t - t0) / window) * w
  const Y = (q) => h - 3 - (q / qMax) * (h - 8)

  // area
  ctx.beginPath()
  ctx.moveTo(X(pts[0].t), h)
  for (const p of pts) ctx.lineTo(X(p.t), Y(p.q))
  ctx.lineTo(X(pts[pts.length - 1].t), h)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, 'rgba(255,150,60,0.28)')
  grad.addColorStop(1, 'rgba(255,150,60,0)')
  ctx.fillStyle = grad
  ctx.fill()

  // line
  ctx.beginPath()
  ctx.moveTo(X(pts[0].t), Y(pts[0].q))
  for (const p of pts) ctx.lineTo(X(p.t), Y(p.q))
  ctx.strokeStyle = '#ffb457'
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(255,150,50,0.65)'
  ctx.shadowBlur = 7
  ctx.stroke()
  ctx.shadowBlur = 0

  // head
  const last = pts[pts.length - 1]
  ctx.beginPath()
  ctx.arc(X(last.t), Y(last.q), 2.4, 0, TAU)
  ctx.fillStyle = '#ffe2b8'
  ctx.fill()
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  const P = state.I * state.I * state.R
  state.P = P

  qVal.textContent = nf0.format(state.Q)
  pVal.textContent = nf1.format(P)
  tVal.textContent = nf0.format(state.T)
  timeVal.textContent = nf1.format(state.t)

  const pct = clamp((P / P_MAX) * 100, 0, 100)
  pBar.style.width = pct.toFixed(1) + '%'
  pPct.textContent = Math.round(pct) + '%'
  formulaNow.textContent =
    'P = (' + nf1.format(state.I) + ')² · ' + nf1.format(state.R) +
    ' = ' + nf1.format(P) + ' Вт  ·  +' + nf1.format(P) + ' Дж/с'
}

/* ---------------- resize ---------------- */
let viewportW = window.innerWidth
let viewportH = window.innerHeight

function onResize() {
  const w = window.innerWidth
  const h = window.innerHeight
  viewportW = w
  viewportH = h
  renderer.setSize(w, h)
  composer.setSize(w, h)
  updateViewOffset()
  fitChart()
}
window.addEventListener('resize', onResize)
window.addEventListener('load', onResize)

// Some browsers resize the tab before the script attaches its listener.
// A cheap per-frame check keeps the renderer and the framing in sync.
function checkViewport() {
  if (window.innerWidth !== viewportW || window.innerHeight !== viewportH) {
    onResize()
  }
}

/* ---------------- loop ---------------- */
const timer = new THREE.Timer()
timer.connect(document)
let hudAccum = 0

function tick() {
  timer.update()
  const raw = timer.getDelta()
  const dt = Math.min(raw, 0.05)

  if (!state.paused) {
    simulate(dt)
    updateElectrons(dt)
    updateLattice()
    updateArrows(dt)
    spawnHeat(dt)
    heatParticles.update(dt)
    flashParticles.update(dt)

    sampleAccum += dt
    if (sampleAccum >= 0.12) {
      sampleAccum = 0
      samples.push({ t: state.t, q: state.Q })
      if (samples.length > 600) samples.shift()
      chartQMax = Math.max(chartQMax, state.Q * 1.06)
      drawChart()
    }

    hudAccum += dt
    if (hudAccum >= 0.1) {
      hudAccum = 0
      updateHUD()
    }
  }

  checkViewport()
  updateGlow()
  controls.update()
  composer.render()
}

/* ---------------- boot ---------------- */
syncSliders()
state.P = state.I * state.I * state.R
updateHUD()

// debug / tinkering hook
window.__joule = {
  state,
  reset: resetAll,
  step(seconds) {
    const n = Math.ceil(seconds * 60)
    for (let i = 0; i < n; i++) {
      simulate(1 / 60)
      if (i % 7 === 0) {
        samples.push({ t: state.t, q: state.Q })
        if (samples.length > 600) samples.shift()
        chartQMax = Math.max(chartQMax, state.Q * 1.06)
      }
    }
    updateHUD()
    drawChart()
  },
}
requestAnimationFrame(() => {
  fitChart()
  renderer.setAnimationLoop(tick)
})
