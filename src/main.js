import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── DOM refs ──
const dropzone = document.getElementById('dropzone');
const loader   = document.getElementById('loader');

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
camera.position.set(0, 1.7, 5);
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

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Render loop ──
function animate() {
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

  // Position camera: move back enough to see the whole model
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 1.5;
  camera.position.set(0, Math.max(1.7, size.y * 0.6), distance);
  camera.lookAt(0, size.y / 2, 0);

  // Scale floor to fit the model
  const floorSize = Math.max(20, maxDim * 3);
  floor.geometry.dispose();
  floor.geometry = new THREE.PlaneGeometry(floorSize, floorSize);
}
