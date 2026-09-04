# VEX CAD

A browser-based VEX IQ CAD editor focused on fast assembly, SmartSnap building, real-time collaboration, and student-friendly controls rather than traditional CAD complexity.

> Independent project. VEX and VEX IQ are trademarks of their respective owner(s). Built-in geometry is derived from publicly available VEX IQ STEP CAD data.

## Implemented

- Real VEX IQ geometry rendered with Three.js/WebGL2
- GPU instancing for repeated parts
- OpenCascade WebAssembly import for STEP/STP, IGES/IGS, and BREP/BRP
- Verified BREP attachment axes and SmartSnap ghost placement
- Fixed and revolute constraints with cycle prevention and propagation
- Click, multi-select and box selection
- Move/rotate transform gizmos and numeric transforms
- Undo/redo, save/open, autosave/recovery, hide/lock/isolate/fit
- Supabase-backed live collaboration with capability-secured room links, presence and durable snapshots
- Fault-isolated local editing when realtime or the parts library is unavailable
- Low / Balanced / High GPU profiles
- Cadasio-style material rendering using shared PBR materials rather than per-part bitmap textures
- Studio Plastic, Matte CAD and Glossy material presets
- ACES tone mapping, adjustable exposure and three-point studio lighting
- Optional soft contact-style floor shadows; Auto disables them in Low mode
- Material heuristics for plastic, rubber-like, transparent, electronics and shaft-like parts
- Configurable grid and axes visibility
- Settings panel with persistent local preferences and configurable keybinds
- Standard CAD navigation and an optional Roblox Studio-style control preset

## Roblox Studio control preset

Enable **Settings → Navigation → Roblox Studio**.

Default controls:

- **RMB + mouse** — free-look camera
- **W / A / S / D** — fly forward/left/back/right
- **Q / E** — down/up
- **Shift** — 3× fly speed
- **MMB + drag** — lateral pan
- **Mouse wheel** — camera forward/back
- **LMB + drag** — box selection
- **R** — cycle Move / Rotate
- **M** — Move tool
- **T** — Rotate tool
- **F** — frame selection
- **Delete** — delete selection

Movement keys, tool keys, camera speed, look sensitivity, pan sensitivity and invert-Y are configurable. Standard CAD controls remain the default preset.

## Rendering model

The official STEP assets do not depend on bitmap texture maps for their normal plastic appearance. VEX CAD therefore uses lightweight shared PBR materials and lighting:

```text
STEP / VXM geometry
      |
      +-- part color metadata
      +-- category/name material classification
      v
Three.js materials
      +-- plastic clear-coat
      +-- rubber-like matte response
      +-- transparent response
      +-- electronics/shaft variants
      v
ACES tone mapping + studio key/fill/rim lighting
```

Balanced and High use `MeshPhysicalMaterial`; Low uses a cheaper `MeshStandardMaterial` path. Shadows default to Auto and are disabled in Low mode.

## Collaboration architecture

The editor remains local-first. Multiplayer is an optional layer backed by the **Vex-IQ-ServerSide-Storage** Supabase project.

- room URLs use high-entropy capability tokens;
- only token hashes are stored server-side;
- direct table access is denied;
- public RPC wrappers validate access through private database functions;
- realtime failures do not stop local CAD editing.

## Deployment

The public app is currently deployed as an isolated `/vex-cad/` subsite of the Pages-enabled `msc-event-management` repository.

The deployment workflow:

1. checks out both repositories,
2. runs dependency-free core, collaboration and settings tests,
3. restores/generates the optimized VEX mesh cache,
4. vendors pinned Three.js, OpenCascade and Supabase browser runtimes,
5. stages VEX CAD in a versioned source directory to prevent mixed browser caches,
6. validates every shipped asset,
7. runs a real headless-Chrome WebGL smoke test,
8. verifies the library loads, Settings opens, Roblox controls move the camera, the transform-cycle key works, and a real VEX part can be placed,
9. publishes the combined GitHub Pages artifact.

## Performance safeguards

- lazy geometry loading
- `THREE.InstancedMesh` for repeated parts
- quantized render meshes
- per-part preprocessing triangle budget
- worker-based custom CAD import
- 90 MB CAD import guard
- render-on-demand
- capped device pixel ratio
- automatic Low profile on small-memory / low-core devices
- Low-mode standard materials and no automatic shadows
- WebGL context-loss warning with autosave protection

## Local tests

```bash
node --test tests/*.test.mjs
```

The production Pages workflow additionally runs the browser/WebGL smoke test.

## Short-term roadmap

- restore the full current 467-part official library in the hosted build instead of the smaller mirror fallback
- more exact attachment types beyond round cylinders
- square axle/socket topology recognition
- better gear/shaft semantics
- orthographic and named views
- BOM export and build instructions
- collision diagnostics
- seasonal field workspaces
- mechanism and gear animation
