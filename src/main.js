import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ── Constants ──
const EYE_HEIGHT = 1.7;
const WALK_SPEED = 4;          // units per second

// ── DOM refs ──
const dropzone = document.getElementById('dropzone');
const loader   = document.getElementById('loader');
const hint     = document.getElementById('hint');

// ── Renderer ──
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// ── Scene ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

// ── Camera — eye height at 1.7 units ──
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, EYE_HEIGHT, 5);
camera.lookAt(0, 0, 0);

// ── Floor ──
const floorGeometry = new THREE.PlaneGeometry(20, 20);
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
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

// Track which movement keys are held
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

// Show hint again when pointer lock is released
controls.addEventListener('unlock', () => {
  if (hint && !hint.hidden) return;        // already visible
  if (dropzone && !dropzone.hidden) return; // still on drop screen
  hint.hidden = false;
});

// Click on the hint overlay to lock
hint.addEventListener('click', () => {
  controls.lock();
});
controls.addEventListener('lock', () => {
  hint.hidden = true;
});

// ── Movement helper — called every frame ──
const direction = new THREE.Vector3();

function updateMovement(delta) {
  if (!controls.isLocked) return;

  const speed = WALK_SPEED * delta;

  direction.set(0, 0, 0);
  if (keys.forward)  direction.z -= 1;
  if (keys.backward) direction.z += 1;
  if (keys.left)     direction.x -= 1;
  if (keys.right)    direction.x += 1;
  direction.normalize();

  if (direction.z !== 0) controls.moveForward(-direction.z * speed);
  if (direction.x !== 0) controls.moveRight(direction.x * speed);

  // Lock camera to eye height — no flying, no falling
  camera.position.y = EYE_HEIGHT;
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
//  Drag-and-drop GLTF loader
// ═══════════════════════════════════════════════════

// Drag visual feedback
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

// Drop handler
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');

  const items = [...e.dataTransfer.items];
  const fileMap = new Map();          // path → File
  let rootGltfPath = null;

  // Recursively read a directory entry
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
      // readEntries may return results in batches
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

  // Gather all files from the drop (handles both files and folders)
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

  // Show loader, hide dropzone
  dropzone.hidden = true;
  loader.hidden = false;

  try {
    await loadGltf(rootGltfPath, fileMap);
    // Model loaded — show the "click to explore" hint
    hint.hidden = false;
  } catch (err) {
    console.error(err);
    alert('Failed to load model: ' + err.message);
    dropzone.hidden = false;
  } finally {
    loader.hidden = true;
  }
});

// ── Load a GLTF from the collected file map ──
async function loadGltf(gltfPath, fileMap) {
  const gltfLoader = new GLTFLoader();

  // Build blob-URL manager so GLTFLoader can resolve relative paths
  // (textures, .bin buffers referenced by a .gltf file)
  const blobURLs = new Map();
  const baseDir = gltfPath.includes('/')
    ? gltfPath.substring(0, gltfPath.lastIndexOf('/') + 1)
    : '';

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    // url may be an absolute blob already
    if (url.startsWith('blob:')) return url;

    // Try to resolve relative to the gltf file
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

  // Create a blob URL for the root gltf/glb file
  const rootBlob = URL.createObjectURL(fileMap.get(gltfPath));

  const gltf = await gltfLoader.loadAsync(rootBlob);

  // Clean up blob URLs
  URL.revokeObjectURL(rootBlob);
  for (const url of blobURLs.values()) URL.revokeObjectURL(url);

  const model = gltf.scene;

  // Auto-center: compute bounding box, shift model so its center sits at the origin
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());

  model.position.sub(center);
  // Raise the model so its bottom sits on the floor
  model.position.y += size.y / 2;

  scene.add(model);

  // Position camera roughly in the middle of the model, at eye height
  camera.position.set(0, EYE_HEIGHT, 0);
  camera.lookAt(0, EYE_HEIGHT, -1);

  // Scale floor to fit the model
  const maxDim = Math.max(size.x, size.y, size.z);
  const floorSize = Math.max(20, maxDim * 3);
  floor.geometry.dispose();
  floor.geometry = new THREE.PlaneGeometry(floorSize, floorSize);
}
