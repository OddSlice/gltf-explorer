# glTF Explorer

A browser-based 3D viewer for glTF models, built with plain HTML, CSS, and JavaScript using Three.js.

## What's been built

**Phase 1 — Project setup and basic scene**

- Project scaffolding with no build tools or frameworks
- Three.js loaded via CDN using an import map
- Full-window WebGL renderer with antialiasing and shadow support
- Perspective camera positioned at eye height (1.7 units)
- Grey floor plane for spatial reference
- Directional light with shadows and ambient fill light
- Responsive window resize handling
- Continuous render loop

**Phase 2 — GLTF drag-and-drop loader**

- Full-page drop zone with visual feedback shown before any model is loaded
- Supports dropping individual .gltf/.glb files or entire folders
- Folder drops recursively resolve associated textures and .bin buffers
- Uses a custom LoadingManager with blob URLs so GLTFLoader can resolve relative paths
- Auto-centers the model at the origin and raises it onto the floor
- Camera repositions to frame the loaded model based on its bounding box
- Floor plane scales to fit large models
- Loading spinner overlay while the model is being parsed
- Error handling with user-facing alerts
