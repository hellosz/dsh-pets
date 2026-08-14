# pet-packs Specification

## Purpose
TBD - created by archiving change add-pet-companion. Update Purpose after archive.
## Requirements
### Requirement: Petdex-compatible pack format

A pet pack SHALL be a folder containing a `pet.json` manifest and a spritesheet image. The manifest SHALL contain at least: `id`, `displayName`, `description`, `spritesheetPath`. The spritesheet SHALL use the petdex v1 layout: 8 rows × 9 columns of frames, each frame 192×208 pixels, with rows mapping to states in this exact order: row 0 `idle`, row 1 `running-right`, row 2 `running-left`, row 3 `waving`, row 4 `jumping`, row 5 `failed`, row 6 `waiting`, row 7 `running`, row 8 `review`.

The plugin SHALL ship with two built-in packs: `pikachu` and `charmander`.

#### Scenario: Built-in packs load

- **WHEN** the plugin starts with pet `pikachu` or `charmander` selected
- **THEN** the pack's `pet.json` and spritesheet load successfully
- **AND** all nine state rows are addressable by the animation renderer

#### Scenario: Spritesheet geometry validation

- **WHEN** a pack is loaded
- **THEN** its spritesheet dimensions are a multiple of 192×208
- **AND** packs with invalid dimensions are rejected without breaking the renderer

### Requirement: Idle animation uses real official frames

The `idle` row of the built-in `pikachu` and `charmander` packs SHALL be generated from the official fifth-generation animated sprites (PokeAPI `generation-v/black-white/animated/{25|4}.gif`, verified reachable), preserving the original frame sequence at a frame size scaled to 192×208 with transparency.

#### Scenario: Idle frames preserve original motion

- **WHEN** the idle animation plays
- **THEN** it reproduces the official sprite's breathing/blinking motion

### Requirement: Derived states for non-idle rows

The remaining state rows of the built-in packs SHALL be derived programmatically from the classic front sprite with transparency, using these transforms:
- `running-left` / `running-right`: horizontal mirroring plus per-frame horizontal offset
- `jumping`: per-frame vertical offset forming a bounce arc
- `waving`: per-frame rotation wiggle
- `failed`: desaturated blue-ish tint plus per-frame jitter
- `waiting`: per-frame scale forming a slow breathing pulse
- `running`: per-frame vertical bob
- `review`: per-frame slight tilt pulse

The derivation script SHALL be committed to the repository so packs are reproducible.

#### Scenario: All nine rows are non-empty

- **WHEN** a built-in pack is generated
- **THEN** each of the nine rows contains at least its defined frame count (idle 6, running-right 8, running-left 8, waving 4, jumping 5, failed 8, waiting 6, running 6, review 6)

#### Scenario: Transparency preserved

- **WHEN** any derived frame is rendered
- **THEN** the background remains transparent

### Requirement: Pack switching

The plugin SHALL allow switching the active pet between `pikachu` and `charmander` at runtime. Switching SHALL re-point the animation renderer to the selected pack's spritesheet without reloading the page.

#### Scenario: Switch reflects immediately

- **WHEN** the user switches the active pet
- **THEN** the renderer uses the new pack's spritesheet and frame table immediately

