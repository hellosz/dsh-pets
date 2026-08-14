# Pet Display Spec

## ADDED Requirements

### Requirement: Floating pet in shell overlay

The Client SHALL register a pet component in the `shell.overlay` Slot with a unique `id`, rendering a floating pet above all columns and outside their scroll containers. The overlay layer is click-through by default; the pet component SHALL keep its root wrapper click-through while the pet body itself opts back into pointer events.

The pet SHALL be draggable within the viewport; the position SHALL persist for the plugin's lifetime (in-memory). The pet SHALL default to the bottom-right corner of the viewport and SHALL never be clipped by the viewport edge.

#### Scenario: Pet renders above the UI

- **WHEN** the plugin is active and a page is open
- **THEN** a pet sprite is visible floating above the sidebar, conversation, and details columns

#### Scenario: Pet does not block interaction

- **WHEN** the user clicks or drags through the area around the pet
- **THEN** clicks pass through to the application underneath
- **AND** only clicks/drags on the pet body itself interact with the pet

#### Scenario: Pet is draggable

- **WHEN** the user drags the pet body
- **THEN** the pet follows the pointer
- **AND** its position is clamped to the viewport

### Requirement: State-driven animation

The pet SHALL render the spritesheet row matching the current pet state and SHALL advance frames according to the state's frame table (frame count and per-frame duration). The Client SHALL obtain the current state by calling the Host `pet/state` RPC, polling via the `timer` service with a cadence of no more than once per 600ms and throttled to avoid redundant calls.

State SHALL drive animation as follows:
- `idle` → breathing/blinking loop
- `running` → in-place run loop
- `running-left` / `running-right` → directional locomotion loop
- `waving` → greeting gesture, played once
- `jumping` → bounce, played once
- `failed` → sad/wobble loop
- `waiting` → patient breathing variant (distinct from idle)
- `review` → focused inspecting loop

#### Scenario: Animation switches with state

- **WHEN** the polled state changes from `running` to `waiting`
- **THEN** the displayed animation switches to the waiting row within one frame duration

#### Scenario: Poll cadence is bounded

- **WHEN** the Client is polling state
- **THEN** no more than one `pet/state` RPC is issued per 600ms per session

### Requirement: Pet interaction menu

Clicking the pet SHALL open a compact menu showing: the current state label, the active pet name, a pet switcher (Pikachu / Charmander), an enable/disable toggle, and a drag hint. Clicking outside the menu SHALL close it. The menu SHALL render within the overlay layer and SHALL not be clipped by the viewport.

#### Scenario: User switches pet

- **WHEN** the user selects the other pet in the menu
- **THEN** the pet sprite and its animation frames switch immediately
- **AND** the switch is reflected in the next `pet/state` snapshot

#### Scenario: User hides the pet

- **WHEN** the user toggles the pet off
- **THEN** the pet and its menu disappear
- **AND** the plugin stops polling the state RPC until re-enabled

### Requirement: Settings page

The Client SHALL register a `settings.section` page titled "Pet Companion" offering: pet selection (Pikachu / Charmander), pet size (small / medium / large, default medium), enable toggle, and a reset-position action. Settings SHALL take effect immediately and SHALL persist for the plugin lifetime in memory.

#### Scenario: Size change applies immediately

- **WHEN** the user changes the size to large
- **THEN** the pet sprite scales up immediately

#### Scenario: Reset position restores default

- **WHEN** the user clicks reset position
- **THEN** the pet moves back to the bottom-right corner
