# Render Quality System Upgrade Plan

## Goal
Systematically improve in-game canvas rendering quality so it visually matches the DOM layer on desktop and mobile, while keeping performance stable.

## Current Problems
- Renderer is forced to `Phaser.CANVAS`, which amplifies bitmap blur during scaling.
- Resize logic is duplicated across boot/scene/coordinator, causing repeated resampling.
- No single source of truth for DPR, viewport policy, and scale behavior.
- No automated quality diagnostics to prevent regressions.

## Target Architecture
1. Renderer policy layer
- Prefer `WebGL` by default, fallback to `Canvas` only when unavailable.
- Centralized renderer choice with telemetry flags.

2. Viewport policy layer
- One `ViewportManager` owns viewport width/height, DPR cap, and resize events.
- All Phaser scaling operations go through this manager.

3. Render profile layer
- Profiles: desktop-high, desktop-balanced, mobile-balanced.
- Each profile defines DPR cap, smoothing mode, and zoom policy.

4. Diagnostics and quality gates
- Runtime diagnostics for renderer type, DPR, backing store size, CSS size.
- E2E assertions verify expected quality invariants.

## Phased Execution

### Phase 1: Foundation (Renderer + Profile)
- Add render profile helper with DPR cap logic.
- Switch Phaser type from hard-coded `CANVAS` to policy-based `AUTO`/`WEBGL` preference.
- Keep compatibility fallback for environments without WebGL.

Acceptance:
- App boots in both Chromium and Edge.
- Renderer type is observable at runtime.

### Phase 2: Viewport Unification
- Introduce `ViewportManager` in `src/`.
- Remove duplicated direct `scale.resize` calls from scene/coordinator where possible.
- Ensure exactly one resize pipeline handles `window resize` and initial layout.

Acceptance:
- No visual jumps on room enter/start/return.
- Canvas backing size remains consistent with policy.

### Phase 3: Scene/Presentation Alignment
- Update scene/presentation layout code to consume viewport manager dimensions.
- Reduce non-integer scaling paths for key HUD/action elements.
- Enable pixel snapping for camera/layout-critical elements.

Acceptance:
- Reduced blur contrast between canvas and DOM overlays in practical gameplay.

Status:
- Completed for render pipeline and integer layout alignment.
- Remaining gap is concentrated in canvas-drawn HUD/text panels rather than backing resolution.

### Phase 3.5: DOM Overlay Migration
- Move HUD cards, round state, battle log, and end-of-match panel from Phaser canvas into DOM overlay.
- Keep only battle imagery and effects inside Phaser.
- Reuse existing overlay layer so canvas no longer bears text-heavy UI rendering.

Acceptance:
- Text-heavy UI appears as sharp as the rest of the DOM layer.
- Canvas is limited to gameplay visuals and effects.

### Phase 4: Diagnostics + Tests
- Add quality diagnostics helper exposed in E2E.
- Add Playwright checks for:
  - renderer type
  - DPR and effective resolution
  - backing buffer vs CSS size ratio

Acceptance:
- Quality checks pass in CI for supported browser project(s).

## Rollout Strategy
1. Implement Phase 1 + build verification.
2. Implement Phase 2 + targeted E2E smoke.
3. Implement Phase 3 + gameplay visual checks.
4. Implement Phase 3.5 + verify HUD/log sharpness against DOM baseline.
5. Implement Phase 4 + enforce checks in CI.

## Risk Control
- Keep fallback path to Canvas for low-capability environments.
- Cap DPR to avoid GPU overdraw/memory spikes.
- Keep changes incremental and reversible by phase.

## Done Definition
- Renderer and viewport policy are centralized.
- Canvas-vs-DOM quality gap is materially reduced.
- Automated diagnostics prevent regressions.

## Current Status
- Phase 1 complete: render profile introduced, Phaser switched off hard-coded Canvas.
- Phase 2 complete: viewport management centralized with runtime diagnostics.
- Phase 3 complete: camera/layout/action sprite pixel snapping applied.
- Phase 4 partially complete: diagnostics E2E added and passing locally.
- Next step: Phase 3.5 DOM overlay migration for HUD, logs, and end screen.
