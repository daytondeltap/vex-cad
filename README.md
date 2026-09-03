# VEX CAD

A high-performance, user-friendly CAD and collaborative robot-design application focused on **VEX IQ**.

> **Project status:** Planning / pre-development. No production CAD implementation has been started yet.

## Vision

VEX CAD should feel more like **building a VEX IQ robot digitally** than operating a traditional professional CAD package.

The goal is to combine:

- a very low learning curve
- real CAD/assembly structure underneath
- a smart VEX-aware parts system
- fast native 3D rendering
- live multi-user collaboration
- version history and linked subassemblies
- future mechanical animation and simulation

The application should be usable by a student within minutes, while still exposing precise controls for advanced teams when needed.

---

# Core Product Principles

## 1. Build, don't fight the CAD system

Common operations should be direct:

**Find part -> drag into workspace -> hover near a compatible connection -> preview snap -> click -> done.**

Users should not normally need to manually create coordinate systems, mate origins, or complex constraints.

## 2. Progressive UI

The default interface stays simple. Advanced controls only appear when requested.

Default workspace:

- searchable Parts panel
- large 3D viewport
- selected-part inspector
- assembly/subsystem tree
- undo/redo
- Share button
- Test/Simulation button reserved for future phases

Advanced options can expose:

- exact position and rotation
- constraint type
- degrees of freedom
- attachment-point metadata
- mechanical relationships
- diagnostic overlays

## 3. VEX-aware parts, not anonymous meshes

Every standard component should carry semantic metadata such as:

- part number
- category
- color variants
- mass/material information where available
- holes and their orientation
- pins and connectors
- axle sockets
- gear tooth count and axis
- wheel properties
- motor outputs
- supported attachment types

This semantic layer will power snapping, validation, animation, BOM generation, simulation, and smart search.

## 4. Local-first performance

Model editing and rendering should remain responsive without requiring a cloud round-trip.

Collaboration and cloud features should synchronize changes while the local client remains authoritative for immediate interaction.

## 5. Collaboration is a core feature

Real-time teamwork, model linking, version history, and subsystem workflows are part of the base architecture rather than later add-ons.

---

# Planned Technical Direction

Initial target architecture:

- **Native desktop application**
- **C++20/23**
- **Qt 6** for desktop UI/windowing
- **OpenCascade** or an equivalent CAD geometry kernel
- high-performance GPU renderer behind a renderer abstraction
- optimized render meshes separate from exact CAD geometry
- GPU instancing for repeated VEX components
- command/operation-based project history
- semantic VEX connection graph
- separate mechanical graph for future simulation

The exact renderer and collaboration backend remain design decisions until implementation begins.

---

# Feature Roadmap

## Phase 0 - Architecture and Parts Pipeline

**Goal:** establish the foundation before building the editor.

### Project architecture

- [ ] Define module boundaries
- [ ] CAD-core abstraction
- [ ] renderer abstraction
- [ ] scene/entity model
- [ ] command system
- [ ] undo/redo architecture
- [ ] project-file specification
- [ ] stable object UUIDs
- [ ] collaboration operation format
- [ ] mechanical graph specification

### VEX IQ parts pipeline

- [ ] Import the initial VEX IQ STEP library
- [ ] STEP -> optimized render-mesh conversion
- [ ] preserve exact CAD/BREP representation separately
- [ ] generate thumbnails
- [ ] categorize parts
- [ ] normalize part IDs and names
- [ ] metadata database
- [ ] color/variant support
- [ ] attachment-point representation
- [ ] automated hole/axis detection where practical
- [ ] human verification tool for generated attachment points

### Performance groundwork

- [ ] background model loading
- [ ] mesh cache
- [ ] identical-part GPU instancing
- [ ] frustum culling
- [ ] scalable selection/picking design
- [ ] large-assembly benchmark project

---

## Phase 1 - Core CAD / MVP

**Goal:** make it possible to design a complete VEX IQ robot comfortably.

### 3D workspace

- [ ] perspective camera
- [ ] orthographic camera
- [ ] orbit
- [ ] pan
- [ ] zoom
- [ ] standard front/back/top/bottom/left/right views
- [ ] grid and axes
- [ ] frame selection
- [ ] frame full assembly

### Parts browser

- [ ] category browser
- [ ] instant text search
- [ ] recent parts
- [ ] favorites
- [ ] part preview
- [ ] drag-and-drop insertion
- [ ] keyboard-driven insertion

### Selection and manipulation

- [ ] click selection
- [ ] multi-select
- [ ] box selection
- [ ] move gizmo
- [ ] rotate gizmo
- [ ] precise numeric transforms
- [ ] duplicate
- [ ] delete
- [ ] hide/show
- [ ] isolate selection
- [ ] lock object

### Smart Build snapping

- [ ] hole-to-pin snapping
- [ ] hole-to-hole alignment
- [ ] axle-to-socket snapping
- [ ] connector snapping
- [ ] beam alignment
- [ ] rotational snap increments
- [ ] magnetic ghost previews
- [ ] compatible connection highlighting
- [ ] snap candidate cycling
- [ ] temporary snap disable modifier

### Constraints

Internally support real assembly constraints while presenting simple language to users.

- [ ] fixed
- [ ] revolute
- [ ] axial
- [ ] slider
- [ ] hole connection
- [ ] axle connection
- [ ] constraint inspection
- [ ] broken/invalid constraint diagnostics

### Assembly organization

- [ ] assembly tree
- [ ] groups
- [ ] named subassemblies
- [ ] collapse/expand hierarchy
- [ ] subsystem visibility
- [ ] color/tag organization

### Essential tooling

- [ ] unlimited undo/redo for current session
- [ ] autosave
- [ ] crash recovery
- [ ] recent projects
- [ ] New / Open / Save / Save As
- [ ] collision/intersection detection
- [ ] measurement tool
- [ ] automatic Bill of Materials
- [ ] configurable keyboard shortcuts
- [ ] searchable command palette

### Export

- [ ] STL export
- [ ] image/screenshot export
- [ ] BOM export
- [ ] investigate STEP export
- [ ] investigate GLTF/GLB export

---

## Phase 2 - Collaboration and Versioning

**Goal:** provide collaboration designed specifically for robotics teams.

### Live collaboration

- [ ] project sharing
- [ ] viewer/editor permissions
- [ ] simultaneous editing
- [ ] named collaborator cursors
- [ ] live selection highlights
- [ ] user presence indicators
- [ ] follow collaborator camera
- [ ] comments attached to parts/subsystems
- [ ] mentions
- [ ] activity feed

### Local-first synchronization

- [ ] offline edits
- [ ] queued changes
- [ ] automatic reconnect/sync
- [ ] conflict-safe operation merging
- [ ] explicit conflict UI when automatic merging is unsafe

### Subsystem collaboration

- [ ] optional subsystem ownership
- [ ] show who is working on each subsystem
- [ ] soft edit awareness rather than unnecessary hard locking
- [ ] subsystem-specific comments

### Version history

- [ ] automatic versions
- [ ] named checkpoints
- [ ] restore version
- [ ] before/after visual comparison
- [ ] change summaries
- [ ] per-user contribution history
- [ ] branches
- [ ] branch comparison
- [ ] merge workflow

### Linked models

Allow separate models to remain linked inside a larger robot.

Example:

```text
CompetitionRobot
  |- Drivetrain @ v14
  |- Intake @ v7
  `- Lift @ v22
```

- [ ] insert linked project/subassembly
- [ ] pin linked version
- [ ] update available indicator
- [ ] preview changes before updating
- [ ] update linked model
- [ ] keep current version
- [ ] detach linked model

---

## Phase 3 - VEX-Specific Productivity Features

**Goal:** outperform generic CAD software by understanding the actual robotics workflow.

### Smarter search

Support queries such as:

- `long blue beam`
- `small gear`
- `thing that holds an axle`

Planned capabilities:

- [ ] fuzzy search
- [ ] synonym search
- [ ] compatibility-aware results
- [ ] natural-language part search
- [ ] **What fits here?** command for selected holes/sockets

### Automatic build instructions

- [ ] derive a first-pass build sequence from project operations
- [ ] interactive instruction-step editor
- [ ] merge/split/reorder steps
- [ ] exploded-step views
- [ ] parts needed per step
- [ ] rotate/zoom instruction camera
- [ ] PDF instruction export
- [ ] shareable digital instruction mode

### Engineering Notebook mode

- [ ] project timeline
- [ ] automatically capture meaningful design changes
- [ ] before/after screenshots
- [ ] changed-parts summary
- [ ] contributor/date metadata
- [ ] student-entered reasoning/notes
- [ ] export notebook entries

The app should document work that actually occurred, not fabricate student reasoning.

### Competition tools

- [ ] season profiles
- [ ] import official field models
- [ ] place robot on field
- [ ] sizing-envelope visualization
- [ ] configurable dimensional checks
- [ ] competition-parts filtering
- [ ] game-object library
- [ ] competition workspace presets

Any legality checker must remain advisory and defer to the current official game manual.

---

## Phase 4 - Mechanical Intelligence and Animation

**Goal:** make the robot mechanically understandable before introducing full physics.

### Mechanical graph

Maintain two related representations:

```text
Geometry Graph       Mechanical Graph
beam                 motor
  |                    |
beam                 shaft
  |                    |
motor                gear
                       |
                     wheel
```

- [ ] shafts
- [ ] gears
- [ ] motors
- [ ] wheels
- [ ] linked rotational systems
- [ ] sliders
- [ ] mechanism groups

### Gear intelligence

- [ ] automatic gear-mesh detection
- [ ] tooth-count metadata
- [ ] gear ratio calculation
- [ ] compound ratio calculation
- [ ] rotation-direction calculation
- [ ] driven/driving gear visualization
- [ ] highlight mechanical power path
- [ ] detect obviously incompatible meshing

### Mechanism animation

- [ ] manually rotate a mechanism
- [ ] propagate rotation through connected shafts
- [ ] gear animation
- [ ] wheel animation
- [ ] slider animation
- [ ] mechanism range-of-motion preview
- [ ] animation speed controls
- [ ] detect constraint conflicts during animation

---

## Phase 5 - Mechanical Simulation

**Goal:** graduate from kinematic visualization to useful robotics simulation.

### Motor model

- [ ] motor RPM
- [ ] torque
- [ ] motor direction
- [ ] gear reduction
- [ ] estimated output speed
- [ ] estimated output torque
- [ ] motor load visualization

### Robot properties

- [ ] total mass
- [ ] center of mass
- [ ] weight distribution
- [ ] drivetrain geometry
- [ ] theoretical wheel speed
- [ ] estimated robot speed

### Physics

- [ ] gravity
- [ ] rigid-body collision
- [ ] contact handling
- [ ] wheel traction
- [ ] wheel slip
- [ ] drivetrain simulation
- [ ] mechanism loading
- [ ] configurable simulation quality/performance

### Field simulation

- [ ] official field environment
- [ ] game-object physics
- [ ] robot driving
- [ ] mechanism interaction with game objects
- [ ] camera presets
- [ ] replay

---

## Phase 6 - Programming and Autonomous Simulation

**Long-term research roadmap.**

- [ ] virtual VEX IQ devices
- [ ] simulated motors and sensors
- [ ] code-to-simulation interface
- [ ] autonomous-path visualization
- [ ] autonomous test runs
- [ ] sensor visualization
- [ ] telemetry graphs
- [ ] compare simulated versus expected motion
- [ ] reusable test scenarios

---

# Potential Differentiators

The project should not attempt to beat Fusion or Onshape at every type of CAD. It should aim to be **much better for VEX IQ robot design**.

Key differentiators:

1. **VEX-native Smart Build** - components understand their compatible physical connections.
2. **Beginner-friendly UI with advanced depth** - simple by default, precise when needed.
3. **Local-first native performance** - fast editing even without an internet connection.
4. **Robotics-team collaboration** - live editing, subsystem awareness, comments, versions, and branches.
5. **Linked robot subsystems** - drivetrain, intake, lift, etc. can be developed independently and combined safely.
6. **Mechanical understanding** - gears, shafts, motors, and wheels have actual meaning rather than being anonymous geometry.
7. **Automatic build instructions** - turn a model into something teammates can physically reproduce.
8. **Engineering Notebook support** - turn real project history into useful documentation.
9. **Competition-aware workflows** - fields, sizing, game objects, and season-specific workspaces.
10. **Simulation-ready architecture from day one** - avoid rewriting the entire application when mechanical simulation arrives.

---

# Proposed Project Structure

```text
vex-cad/
|- app/                  # Application lifecycle and project management
|- cad/                  # Geometry/kernel integration
|- scene/                # Entities, transforms, hierarchy, selection
|- renderer/             # GPU rendering, picking, overlays
|- vex/                  # VEX-specific semantic model
|  |- parts/
|  |- connections/
|  |- mechanical/
|  `- competition/
|- constraints/          # Assembly constraint model/solver
|- collaboration/        # Operations, sync, presence, versions
|- simulation/           # Future simulation modules
|- ui/                   # Desktop interface
|- persistence/          # Project files, autosave, migration
|- import-export/        # STEP/STL/GLTF/etc.
|- tools/                # Parts preprocessing/verification utilities
|- tests/
|- docs/
`- assets/
```

The final layout may change once implementation begins, but the separation between **CAD**, **rendering**, **VEX semantics**, **collaboration**, and **simulation** should remain.

---

# Project File Concept

Planned project extension (placeholder):

```text
.vxiq
```

A project should reference standard parts by stable ID instead of embedding duplicate geometry for every instance.

Conceptually:

```text
project metadata
instances
constraints
subassemblies
linked models
history metadata
thumbnail
custom assets
```

This should keep robot project files compact even when the assembly contains hundreds of repeated parts.

---

# Initial UX Target

A first-time user should be able to:

1. open the app
2. create a project
3. search for a VEX IQ part
4. drag it into the scene
5. drag another part near it
6. see valid attachment points highlight
7. click a ghost preview to connect it
8. orbit around the assembly
9. undo/redo freely
10. save and share the robot

without needing a CAD tutorial first.

---

# Non-Goals for the First Release

The first usable release should **not** be delayed by:

- full rigid-body physics
- motor thermal simulation
- autonomous code simulation
- structural finite-element analysis
- a complete custom-part parametric modeler
- attempting to replace every feature in Fusion/Onshape

Those systems should be enabled by the architecture without becoming MVP blockers.

---

# Current Assets

The initial development planning uses a VEX IQ parts archive supplied for the project containing STEP models. The parts pipeline will treat this as the starting dataset, with a future controlled process for updating and validating the library.

---

# Repository Practice

As development begins:

- keep this README synchronized with major architecture/features
- use issues for feature-sized work
- keep changes modular
- preserve project compatibility through explicit file-format migrations
- add tests for CAD operations, connection rules, project loading, and collaboration operations
- avoid silently breaking existing project files

---

# Status

**Current milestone: Phase 0 - Planning and architecture.**

Next major decisions before coding:

- final desktop platform targets
- renderer choice
- exact CAD kernel integration
- collaboration backend
- authentication model
- project-file format v1
- smart-part metadata schema
- initial subset of VEX IQ parts used to validate Smart Build

---

## Trademark / Project Note

This is an independent software project. VEX and VEX IQ are trademarks of their respective owner(s). Any future public release should clearly distinguish this project from official VEX Robotics software and comply with applicable asset/licensing requirements.
