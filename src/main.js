import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ── Tunable constants ──────────────────────────────
const EYE_HEIGHT       = 1.7;   // camera height above the floor surface
const WALK_SPEED       = 4;     // units per second
const WALL_DISTANCE    = 0.5;   // min gap between player and walls
const FLOOR_RAY_HEIGHT = 10;    // how far above the player to start the down-ray
const FLOOR_RAY_LENGTH = 50;    // max distance the floor ray travels downward
const MAX_PIXEL_RATIO  = 1.5;   // cap device pixel ratio for performance
// ───────────────────────────────────────────────────

// ── DOM refs ──
const dropzone    = document.getElementById('dropzone');
const loaderEl    = document.getElementById('loader');
const loaderText  = document.getElementById('loader-text');
const progressBar = document.getElementById('progress-bar');
const progressPct = document.getElementById('progress-pct');
const hint        = document.getElementById('hint');
const hud         = document.getElementById('hud');
const loadNewBtn  = document.getElementById('load-new');

// ── State ──
let modelLoaded = false;
let currentModel = null;
let collisionMesh = null;    // single merged mesh used for all raycasts
let lastValidY = EYE_HEIGHT; // fallback height when no floor is detected

// ── Renderer ──
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
document.body.appendChild(renderer.domElement);

// ── Scene ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

// ── Camera ──
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, EYE_HEIGHT, 5);
camera.lookAt(0, 0, 0);

// ── Floor (scene helper — NOT included in collision) ──
let floorGeometry = new THREE.PlaneGeometry(20, 20);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ── Lights ──
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 10, 7);
dirLight.castShadow = true;
scene.add(dirLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

// ═══════════════════════════════════════════════════
//  First-person controls (PointerLockControls + WASD)
// ═══════════════════════════════════════════════════

const controls = new PointerLockControls(camera, renderer.domElement);

const keys = { forward: false, backward: false, left: false, right: false };

document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward  = true; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = true; break;
    case 'KeyA': case 'ArrowLeft':  keys.left     = true; break;
    case 'KeyD': case 'ArrowRight': keys.right    = true; break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    keys.forward  = false; break;
    case 'KeyS': case 'ArrowDown':  keys.backward = false; break;
    case 'KeyA': case 'ArrowLeft':  keys.left     = false; break;
    case 'KeyD': case 'ArrowRight': keys.right    = false; break;
  }
});

controls.addEventListener('unlock', () => {
  if (!modelLoaded) return;
  hint.hidden = false;
  loadNewBtn.hidden = false;
  hud.hidden = true;
});

hint.addEventListener('click', () => {
  controls.lock();
});
controls.addEventListener('lock', () => {
  hint.hidden = true;
  loadNewBtn.hidden = true;
  hud.hidden = false;
});

// ═══════════════════════════════════════════════════
//  Collision system (raycaster-based)
//
//  Performance strategy:
//    All GLTF meshes are merged into ONE BufferGeometry at load
//    time. Raycasts hit a single mesh instead of iterating hundreds.
//    Raycasters use firstHitOnly = true so they stop at the nearest
//    intersection. All scratch vectors are pre-allocated (zero GC).
//
//  Wall collision:
//    Four horizontal rays (±X, ±Z in world space) are cast from
//    the player's chest height. If any ray hits within WALL_DISTANCE,
//    the movement component along that axis is zeroed — the player
//    slides along walls instead of getting stuck.
//
//  Floor collision:
//    A single downward ray snaps the camera to whatever surface is
//    below. If nothing is hit, the last valid height is kept.
// ═══════════════════════════════════════════════════

const wallRaycaster  = new THREE.Raycaster();
const floorRaycaster = new THREE.Raycaster();
wallRaycaster.firstHitOnly  = true;
floorRaycaster.firstHitOnly = true;

// Pre-allocated scratch vectors (no per-frame allocations)
const _wallOrigin  = new THREE.Vector3();
const _floorOrigin = new THREE.Vector3();
const _down        = new THREE.Vector3(0, -1, 0);
const _forward     = new THREE.Vector3();
const _right       = new THREE.Vector3();
const _up          = new THREE.Vector3(0, 1, 0);
const _moveDir     = new THREE.Vector3();

// The four cardinal world-space directions for wall checks
const wallDirections = [
  new THREE.Vector3( 0, 0, -1),  // +Z forward
  new THREE.Vector3( 0, 0,  1),  // -Z backward
  new THREE.Vector3(-1, 0,  0),  // left
  new THREE.Vector3( 1, 0,  0),  // right
];

function getBlockedDirections(position) {
  if (!collisionMesh) return null;

  _wallOrigin.set(position.x, position.y - 0.3, position.z);

  let blockedX = 0;  // -1, 0, or 1 to indicate which X side is blocked
  let blockedZ = 0;

  for (const dir of wallDirections) {
    wallRaycaster.set(_wallOrigin, dir);
    wallRaycaster.far = WALL_DISTANCE;

    const hits = wallRaycaster.intersectObject(collisionMesh);
    if (hits.length > 0) {
      if (dir.x !== 0) blockedX = dir.x;
      if (dir.z !== 0) blockedZ = dir.z;
    }
  }
  return { blockedX, blockedZ };
}

function getFloorY(position) {
  if (!collisionMesh) return null;

  _floorOrigin.set(position.x, position.y + FLOOR_RAY_HEIGHT, position.z);

  floorRaycaster.set(_floorOrigin, _down);
  floorRaycaster.far = FLOOR_RAY_LENGTH;

  const hits = floorRaycaster.intersectObject(collisionMesh);
  if (hits.length > 0) {
    return hits[0].point.y + EYE_HEIGHT;
  }
  return null;
}

// ── Movement (called every frame) ──
function updateMovement(delta) {
  if (!controls.isLocked) return;

  const speed = WALK_SPEED * delta;

  // Camera forward projected onto XZ
  camera.getWorldDirection(_forward);
  _forward.y = 0;
  _forward.normalize();

  _right.crossVectors(_forward, _up).normalize();

  _moveDir.set(0, 0, 0);
  if (keys.forward)  _moveDir.add(_forward);
  if (keys.backward) _moveDir.sub(_forward);
  if (keys.right)    _moveDir.add(_right);
  if (keys.left)     _moveDir.sub(_right);
  _moveDir.normalize().multiplyScalar(speed);

  // ── Wall collision: zero out blocked components ──
  if (collisionMesh && (_moveDir.x !== 0 || _moveDir.z !== 0)) {
    const { blockedX, blockedZ } = getBlockedDirections(camera.position);

    if (blockedX !== 0 && Math.sign(_moveDir.x) === blockedX) {
      _moveDir.x = 0;
    }
    if (blockedZ !== 0 && Math.sign(_moveDir.z) === blockedZ) {
      _moveDir.z = 0;
    }
  }

  // Apply horizontal movement
  camera.position.x += _moveDir.x;
  camera.position.z += _moveDir.z;

  // ── Floor collision: snap to surface ──
  const floorY = getFloorY(camera.position);
  if (floorY !== null) {
    camera.position.y = floorY;
    lastValidY = floorY;
  } else {
    camera.position.y = lastValidY;
  }
}

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render loop ──
const clock = new THREE.Clock();

function animate() {
  const delta = clock.getDelta();
  updateMovement(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// ═══════════════════════════════════════════════════
//  "Load new scan" button
// ═══════════════════════════════════════════════════

loadNewBtn.addEventListener('click', () => {
  if (currentModel) {
    scene.remove(currentModel);
    currentModel.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });
    currentModel = null;
  }

  if (collisionMesh) {
    collisionMesh.geometry.dispose();
    collisionMesh = null;
  }
  modelLoaded = false;
  lastValidY = EYE_HEIGHT;
  hint.hidden = true;
  hud.hidden = true;
  loadNewBtn.hidden = true;
  dropzone.hidden = false;

  floor.geometry.dispose();
  floor.geometry = new THREE.PlaneGeometry(20, 20);

  camera.position.set(0, EYE_HEIGHT, 5);
  camera.lookAt(0, 0, 0);
});

// ═══════════════════════════════════════════════════
//  Drag-and-drop GLTF loader
// ═══════════════════════════════════════════════════

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');

  const items = [...e.dataTransfer.items];
  const fileMap = new Map();
  let rootGltfPath = null;

  async function readEntry(entry, path = '') {
    if (entry.isFile) {
      const file = await new Promise((res) => entry.file(res));
      const fullPath = path + file.name;
      fileMap.set(fullPath, file);
      if (!rootGltfPath && /\.(gltf|glb)$/i.test(file.name)) {
        rootGltfPath = fullPath;
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let entries = [];
      let batch;
      do {
        batch = await new Promise((res) => reader.readEntries(res));
        entries = entries.concat(batch);
      } while (batch.length);
      for (const child of entries) {
        await readEntry(child, path + entry.name + '/');
      }
    }
  }

  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      await readEntry(entry);
    } else {
      const file = item.getAsFile();
      if (file) {
        fileMap.set(file.name, file);
        if (!rootGltfPath && /\.(gltf|glb)$/i.test(file.name)) {
          rootGltfPath = file.name;
        }
      }
    }
  }

  if (!rootGltfPath) {
    alert('No .gltf or .glb file found. Please drop a valid glTF model.');
    return;
  }

  dropzone.hidden = true;
  loaderEl.hidden = false;
  setProgress(0);

  try {
    await loadGltf(rootGltfPath, fileMap);
    modelLoaded = true;
    hint.hidden = false;
  } catch (err) {
    console.error(err);
    alert('Failed to load model: ' + err.message);
    dropzone.hidden = false;
  } finally {
    loaderEl.hidden = true;
  }
});

// ── Progress helper ──
function setProgress(pct) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  progressBar.style.width = clamped + '%';
  progressPct.textContent = clamped + ' %';
}

// ── Load a GLTF from the collected file map ──
async function loadGltf(gltfPath, fileMap) {
  const gltfLoader = new GLTFLoader();

  const blobURLs = new Map();
  const baseDir = gltfPath.includes('/')
    ? gltfPath.substring(0, gltfPath.lastIndexOf('/') + 1)
    : '';

  const manager = new THREE.LoadingManager();

  manager.onProgress = (_url, loaded, total) => {
    if (total > 0) setProgress((loaded / total) * 100);
  };

  manager.setURLModifier((url) => {
    if (url.startsWith('blob:')) return url;

    const candidates = [url, baseDir + url];
    for (const candidate of candidates) {
      if (fileMap.has(candidate)) {
        if (!blobURLs.has(candidate)) {
          blobURLs.set(candidate, URL.createObjectURL(fileMap.get(candidate)));
        }
        return blobURLs.get(candidate);
      }
    }
    return url;
  });

  gltfLoader.manager = manager;

  const rootBlob = URL.createObjectURL(fileMap.get(gltfPath));
  const gltf = await gltfLoader.loadAsync(rootBlob);

  URL.revokeObjectURL(rootBlob);
  for (const url of blobURLs.values()) URL.revokeObjectURL(url);

  setProgress(100);

  const model = gltf.scene;

  // Auto-center
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());

  model.position.sub(center);
  model.position.y += size.y / 2;

  scene.add(model);
  currentModel = model;

  // ── Build a single merged collision mesh from all GLTF geometry ──
  //    This is the key performance optimisation: raycasting against one
  //    merged BufferGeometry is orders of magnitude faster than testing
  //    hundreds of individual meshes every frame.
  const geometries = [];
  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (child.isMesh) {
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      // Ensure we only keep position data for collision (save memory)
      for (const key of Object.keys(geo.attributes)) {
        if (key !== 'position') geo.deleteAttribute(key);
      }
      geo.setIndex(null);  // de-index for mergeGeometries compatibility
      geometries.push(geo);
    }
  });

  if (geometries.length > 0) {
    const merged = mergeGeometries(geometries);
    collisionMesh = new THREE.Mesh(merged);
    // Not added to scene — used for raycasting only
    // Clean up temp clones
    geometries.forEach((g) => g.dispose());
  } else {
    collisionMesh = null;
  }

  // Position camera in the middle, at eye height
  camera.position.set(0, EYE_HEIGHT, 0);
  camera.lookAt(0, EYE_HEIGHT, -1);
  lastValidY = EYE_HEIGHT;

  // Scale floor to fit
  const maxDim = Math.max(size.x, size.y, size.z);
  const floorSize = Math.max(20, maxDim * 3);
  floor.geometry.dispose();
  floor.geometry = new THREE.PlaneGeometry(floorSize, floorSize);
}
