# VEX CAD

A browser-based, high-performance VEX IQ CAD editor focused on fast assembly instead of traditional CAD complexity.

> Independent project. VEX and VEX IQ are trademarks of their respective owner(s). The built-in part library is generated from VEX's publicly available STEP CAD files with attribution to VEX Robotics.

## Current scope

Multiplayer/collaboration is intentionally **not** part of the current build.

### Implemented

- Real VEX IQ geometry generated from the official STEP library
- 467-part searchable VEX IQ library
- GPU rendering with Three.js/WebGL2
- Instanced rendering for repeated parts
- OpenCascade WebAssembly import for STEP/STP, IGES/IGS, and BREP/BRP
- Exact-BREP cylindrical attachment extraction for verified round-hole axes
- Heuristic shaft/socket attachment metadata for rotary parts
- SmartSnap ghost placement and compatible-attachment highlighting
- Fixed and revolute constraints
- Revolute angle control
- Constraint-cycle prevention
- Constraint propagation through assemblies
- Click selection, Ctrl/Cmd multi-selection, Shift-drag box selection
- Move and rotate gizmos
- Numeric position/rotation editing
- Duplicate, delete, hide, lock, isolate, fit-to-selection
- Undo/redo
- `.vxcad` project save/open
- Local autosave and recovery
- Imported custom CAD embedded into saved projects
- Low / Balanced / High rendering profiles
- Automatic low-quality selection for devices reporting <=4 GB RAM or <=4 logical CPU cores
- Render-on-demand, no shadows/post-processing, capped pixel ratio
- Per-part mesh triangle cap during library preprocessing
- Imported-CAD file-size and triangle-count guards
- WebGL context-loss warning with autosave protection

## Architecture

The deployed application is a static GitHub Pages site. There is no application server or database requirement.

```text
Official VEX IQ STEP archive
        |
        v
CadQuery / OpenCascade preprocessing (CI)
        |
        +-- exact BREP attachment metadata
        +-- quantized VXM render meshes
        v
GitHub Pages
        |
        +-- Three.js / WebGL2 editor
        +-- OpenCascade WASM custom CAD importer
```

Repeated parts are rendered with `THREE.InstancedMesh`, while exact project transforms and constraint state remain independent of the render batching layer.

## Deployment

Pushes to `main` run `.github/workflows/pages.yml`.

The workflow:

1. runs the dependency-free editor core tests,
2. restores the generated VEX mesh cache if available,
3. otherwise downloads the official VEX IQ STEP archive and generates the optimized mesh library,
4. vendors pinned Three.js and OpenCascade WebAssembly runtime files,
5. validates every generated mesh and attachment manifest,
6. publishes the static site to GitHub Pages.

If GitHub Pages has never been enabled for the repository, perform the one-time repository setting:

**Settings -> Pages -> Build and deployment -> Source -> GitHub Actions**

No Supabase project, API key, database, or other backend is required for the current build.

## Local validation

Core tests do not require npm packages:

```bash
node --test tests/*.test.mjs
```

Generate the part cache from an existing ZIP:

```bash
python tools/build_parts.py \
  --zip VEX-IQ-All-Parts-2024-11-08.zip \
  --out public/parts
node scripts/check-assets.mjs public/parts/manifest.json
```

The production workflow vendors its browser dependencies automatically.

## Performance targets

The editor is designed to degrade gracefully on school laptops and lower-end devices:

- geometry loads only when a part is actually used,
- identical parts share one GPU geometry and are drawn in an instance batch,
- library meshes are quantized before deployment,
- a single library part is hard-capped at 90,000 triangles during preprocessing,
- custom CAD is parsed in a worker,
- imports larger than 90 MB are rejected before WASM allocation,
- extremely high-triangle imports are rejected based on the active quality profile,
- rendering happens only when the view or scene changes,
- Low mode caps device pixel ratio at 1.0.

This cannot guarantee every possible STEP file or every old GPU will work, but the application is designed to fail with a clear error rather than intentionally attempting unsafe memory allocations.

## Short-term roadmap

- More verified attachment types beyond round BREP cylinders
- Axle/square-socket recognition using exact topology
- Better gear/shaft semantics
- Orthographic and named camera views
- BOM export
- Build-instruction generation
- Collision diagnostics
- Seasonal field workspaces
- Mechanical/gear animation

Multiplayer remains deferred until explicitly reintroduced.
