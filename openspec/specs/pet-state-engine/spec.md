# pet-state-engine Specification

## Purpose
TBD - created by archiving change add-pet-companion. Update Purpose after archive.
## Requirements
### Requirement: Event-to-state mapping

The pet state engine SHALL listen to DSH Host lifecycle events and derive a pet state per session. The state set SHALL be: `idle`, `running`, `waiting`, `review`, `failed`, `waving`, `jumping`, `running-left`, `running-right`.

The engine SHALL apply the following priority order when multiple events are active for the same session: `waiting` > `failed` > `review` > `running` > `idle`. When events at the same priority overlap, the most recent event SHALL win.

The engine SHALL map events as follows:
- `approval/request` → `waiting` (highest priority, signals the user must act)
- `agent/error` → `failed`
- `agent/turn-stopping` → `review` (a turn completed, awaiting user review)
- `agent/status` with `running` → `running`
- `tools/execute` / `tools/result` → `running` while a tool dispatch is in flight
- `subagent/start` / `workflow/start` → `running`
- no active signal → `idle`

#### Scenario: Approval request preempts running state

- **WHEN** the agent is in `running` state and an `approval/request` event fires for the same session
- **THEN** the session state becomes `waiting`
- **AND** subsequent `tools/execute` events do not downgrade the state below `waiting`

#### Scenario: Turn completion enters review state

- **WHEN** `agent/turn-stopping` fires for a session
- **THEN** the session state becomes `review`
- **AND** the state stays `review` for at least 8 seconds unless a higher-priority event fires

#### Scenario: Error surfaces as failed state

- **WHEN** `agent/error` fires for a session
- **THEN** the session state becomes `failed` until the next agent activity

#### Scenario: Idle default

- **WHEN** no event has fired for a session, or all prior signals have expired
- **THEN** the session state is `idle`

### Requirement: Per-session state snapshot via RPC

The engine SHALL expose a read-only state snapshot for the active session through a Package-private RPC method `pet/state` (registered via `harness.handle`). The snapshot SHALL be plain JSON containing: session id, current state id, state label, pet id, and a monotonically increasing revision number.

The engine SHALL keep state only in memory for the lifetime of the plugin and SHALL NOT write to durable storage. State SHALL be removed when the session is disposed (`session/disposed`).

#### Scenario: Client polls current state

- **WHEN** the Client calls `pet/state` with a session id
- **THEN** the engine returns `{ sessionId, state, label, petId, revision }` as lossless JSON
- **AND** `state` is one of the nine defined states

#### Scenario: State revision advances

- **WHEN** the state for a session changes
- **THEN** the revision number increments by one

#### Scenario: Disposed session cleanup

- **WHEN** `session/disposed` fires for a session
- **THEN** the engine removes that session's state entry and returns `idle` for unknown sessions

### Requirement: Non-intrusive observation

The engine SHALL only observe events; it SHALL NOT modify, veto, or replace any DSH event payload or execution flow. All listeners SHALL be registered with `ctx.on` and SHALL be removed when the plugin stops or updates.

#### Scenario: Listeners cleaned up on stop

- **WHEN** the plugin is stopped or updated
- **THEN** no engine listener remains registered on any DSH event

#### Scenario: Unknown events degrade gracefully

- **WHEN** an event payload is missing expected fields or an unrecognized status value arrives
- **THEN** the engine ignores the event and keeps the previous state, without throwing

