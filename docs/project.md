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

**Phase 3 — First-person controls**

- PointerLockControls for mouse-look (click to lock, Escape to release)
- WASD / arrow key movement at a walking pace (4 units/sec)
- Delta-time-based movement for consistent speed regardless of frame rate
- Camera locked to eye height (1.7 units) — no flying or falling
- "Click to explore" hint overlay shown after a model loads
- Hint reappears when pointer lock is released, hides on re-lock
- Camera starts at the center of the loaded model for immediate exploration

**Phase 4 — Polish and UX improvements**

- Dark grey/near-black background and floor for an immersive feel
- Loading progress bar with percentage readout driven by LoadingManager.onProgress
- Subtle controls HUD in the bottom-left corner (visible only while exploring)
- "Load new scan" button appears in the top-right when the mouse is unlocked
- Loading a new scan cleanly disposes of the previous model, resets floor and camera
- Drop zone, loader, hint, HUD, and button visibility are all managed as a coherent state machine
- Full-viewport responsive layout (html/body 100% width/height, canvas fills container)
- Dark-themed drop zone and loader overlays match the immersive palette

**Phase 5 — Wall and floor collision**

- Raycaster-based collision system in its own clearly commented section
- Four horizontal rays (±X, ±Z) detect walls; blocked axes are zeroed independently so the player slides along surfaces rather than sticking
- Downward ray from above the player snaps camera to whatever surface is below (floor, ramp, raised platform)
- If no floor is detected (player walks off the edge of the scan), the last valid height is preserved
- Collision only tests meshes from the loaded GLTF model — helper objects (scene floor, lights) are excluded
- All collision distances (WALL_DISTANCE, FLOOR_RAY_HEIGHT, FLOOR_RAY_LENGTH) and WALK_SPEED are tunable constants at the top of main.js
- Movement refactored to world-space vectors derived from camera direction, enabling correct collision checks regardless of look angle
- Collidable mesh list is rebuilt on each model load and cleared on "Load new scan"
