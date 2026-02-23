import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ── Tunable constants ──────────────────────────────
const EYE_HEIGHT       = 1.7;   // camera height above the floor surface
const WALK_SPEED       = 4;     // units per second
const WALL_DISTANCE    = 0.5;   // min gap between player and walls
const FLOOR_RAY_HEIGHT = 10;    // how far above the player to start the down-ray
const FLOOR_RAY_LENGTH = 50;    // max distance the floor ray travels downward
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
let collidableMeshes = [];   // meshes from the GLTF that receive collision
let lastValidY = EYE_HEIGHT; // fallback height when no floor is detected

// ── Renderer ──
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
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
//  Wall collision:
//    Four horizontal rays (±X, ±Z in world space) are cast from
//    the player's chest height. If any ray hits a collidable mesh
//    within WALL_DISTANCE, the proposed movement component in that
//    direction is zeroed out — so the player slides along walls
//    instead of getting stuck.
//
//  Floor collision:
//    A single downward ray is cast from well above the player.
//    If it hits a collidable mesh, the player's Y is set so the
//    camera sits EYE_HEIGHT above that surface. If nothing is hit
//    (walked off the edge), the last valid height is kept.
// ═══════════════════════════════════════════════════

const wallRaycaster  = new THREE.Raycaster();
const floorRaycaster = new THREE.Raycaster();

// The four cardinal world-space directions for wall checks
const wallDirections = [
  new THREE.Vector3( 0, 0, -1),  // forward  (+Z camera looks -Z)
  new THREE.Vector3( 0, 0,  1),  // backward
  new THREE.Vector3(-1, 0,  0),  // left
  new THREE.Vector3( 1, 0,  0),  // right
];

/**
 * Returns a Set of blocked world-axis directions based on wall ray hits.
 * Each entry is one of the wallDirections references.
 */
function getBlockedDirections(position) {
  if (collidableMeshes.length === 0) return new Set();

  const blocked = new Set();
  const origin = new THREE.Vector3(position.x, position.y - 0.3, position.z);
  // Cast from chest height (eye minus a bit) so low walls are detected

  for (const dir of wallDirections) {
    wallRaycaster.set(origin, dir);
    wallRaycaster.far = WALL_DISTANCE;

    const hits = wallRaycaster.intersectObjects(collidableMeshes, false);
    if (hits.length > 0) {
      blocked.add(dir);
    }
  }
  return blocked;
}

/**
 * Returns the Y position the player should stand at, or null if no
 * floor surface was found beneath them.
 */
function getFloorY(position) {
  if (collidableMeshes.length === 0) return null;

  const origin = new THREE.Vector3(
    position.x,
    position.y + FLOOR_RAY_HEIGHT,
    position.z
  );
  const down = new THREE.Vector3(0, -1, 0);

  floorRaycaster.set(origin, down);
  floorRaycaster.far = FLOOR_RAY_LENGTH;

  const hits = floorRaycaster.intersectObjects(collidableMeshes, false);
  if (hits.length > 0) {
    return hits[0].point.y + EYE_HEIGHT;
  }
  return null;
}

// ── Movement (called every frame) ──
const moveDirection = new THREE.Vector3();

function updateMovement(delta) {
  if (!controls.isLocked) return;

  const speed = WALK_SPEED * delta;

  // Build a world-space movement vector from WASD input
  // Camera forward projected onto the XZ plane
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const right = new THREE.Vector3();
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

  moveDirection.set(0, 0, 0);
  if (keys.forward)  moveDirection.add(forward);
  if (keys.backward) moveDirection.sub(forward);
  if (keys.right)    moveDirection.add(right);
  if (keys.left)     moveDirection.sub(right);
  moveDirection.normalize().multiplyScalar(speed);

  // ── Wall collision: zero out blocked components ──
  if (collidableMeshes.length > 0 && (moveDirection.x !== 0 || moveDirection.z !== 0)) {
    const blocked = getBlockedDirections(camera.position);

    for (const dir of blocked) {
      // If movement has a component in the blocked direction, remove it
      // This gives the "slide along walls" feel
      if (dir.x !== 0 && Math.sign(moveDirection.x) === Math.sign(dir.x)) {
        moveDirection.x = 0;
      }
      if (dir.z !== 0 && Math.sign(moveDirection.z) === Math.sign(dir.z)) {
        moveDirection.z = 0;
      }
    }
  }

  // Apply horizontal movement
  camera.position.x += moveDirection.x;
  camera.position.z += moveDirection.z;

  // ── Floor collision: snap to surface ──
  const floorY = getFloorY(camera.position);
  if (floorY !== null) {
    camera.position.y = floorY;
    lastValidY = floorY;
  } else {
    // No floor detected — keep last valid height
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

  collidableMeshes = [];
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

  // ── Collect collidable meshes from the GLTF only ──
  collidableMeshes = [];
  model.traverse((child) => {
    if (child.isMesh) {
      collidableMeshes.push(child);
    }
  });

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
