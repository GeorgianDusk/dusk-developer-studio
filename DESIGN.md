# Dusk Developer Studio Design System

## Design thesis

Dusk Developer Studio is a late-90s tactical cyber-RPG workstation for real developer tasks: a builder at a CRT after dark, with a technical manual beside the keyboard. The game reference appears through hard-edged framing, mission language, compact sprite-like state markers, disciplined mono typography, and one purposeful workstation scene. It must still behave like a modern developer tool.

The memorable move is the **mission console**: the selected Dusk path reads as the active build campaign, and each Setup -> Access -> Build -> Inspect step reads as a verifiable objective with evidence, not decorative game chrome.

## Principles

1. **Truth is the main visual hierarchy.** Verified, blocked, ready, skipped, source, maturity, network, and local boundaries remain visible and never rely on color alone.
2. **Game-tool, not arcade cabinet.** Use hard edges, one-pixel borders, compact status sprites, inset command surfaces, and restrained Dusk accents. Avoid fake hardware defects or novelty controls.
3. **Standard controls stay standard.** Buttons, links, inputs, navigation, focus, disabled states, and live regions remain familiar and keyboard-operable.
4. **Pixel energy is concentrated.** Mono display treatment belongs to major headings, compact status, code, and the workstation ornament. Body copy and controls use a legible UI sans stack.
5. **Density follows the task.** Overview is spacious enough to choose a path. Guide steps become denser around commands and evidence. Reference is a scannable list, not a card wall.
6. **Product truth is immutable.** Styling must not change evidence requirements, network policy, companion containment, wallet boundaries, or completion logic.

## Physical scene and color strategy

A developer uses the Studio at night beside a dim CRT and an open protocol manual. The room is dark, but the screen remains calm enough for a long debugging session.

Cool near-black surfaces carry the product. Blue identifies navigation and information, mint marks verified state and the primary safe action, amber marks readiness or caution, and rose marks blocked or dangerous state.

## Semantic tokens

| Role | Token | Value | Use |
| --- | --- | ---: | --- |
| Canvas | `--canvas` | `#05070b` | Browser and app background |
| Surface | `--surface` | `#0b1119` | Main panels and tool areas |
| Raised | `--surface-raised` | `#111b27` | Sticky evidence and status surfaces |
| Inset | `--surface-inset` | `#030509` | Code, fields, and CRT screen |
| Border | `--border` | `#2b3d50` | One-pixel structure |
| Strong border | `--border-strong` | `#55728d` | Current or selected structure |
| Text | `--text` | `#f3f6f1` | Primary copy |
| Muted text | `--text-muted` | `#a8b5c2` | Supporting copy |
| Quiet text | `--text-quiet` | `#83919e` | Metadata and disabled explanation |
| Focus | `--focus` | `#96caff` | Keyboard focus outline |
| Success | `--success` | `#72edb5` | Verified and primary safe actions |
| Warning | `--warning` | `#f0ca70` | Ready, caution, and retryable states |
| Danger | `--danger` | `#ff8da0` | Blocked and error states |
| Info | `--info` | `#7eb9f5` | Current path, links, and source context |
| Disabled | `--disabled` | `#7c8995` | Disabled control text |

Color is always paired with text, shape, icon, border treatment, or status wording.

## Type roles

- **UI and body:** `IBM Plex Sans`, `Segoe UI`, system sans; 16px default, 1.5-1.6 line height, and a 65-75ch prose ceiling.
- **Display:** `Cascadia Code`, `JetBrains Mono`, monospace; 40-48px desktop and 30-36px mobile, with balanced wrapping.
- **Section title:** UI sans, 20-24px, 700 weight.
- **Status and data:** mono, 11-12px; uppercase only for compact machine-like labels.
- **Code:** mono, 13px minimum, 1.55 line height, wrapping only when required to avoid overflow.

Controls, body copy, long guidance, and navigation never use pixel display typography.

## Spacing and grid

- Base unit: 4px. Primary steps: 8, 12, 16, 24, 32, 48, and 64.
- Desktop content maximum: 1360px.
- Guide desktop: objective rail `216px`, task surface `minmax(0, 1fr)`, evidence rail `312px`.
- At 1120px and below, evidence moves below the task surface.
- At 760px and below, the objective rail becomes a 2x2 mission grid.
- At 390px and 320px, controls remain inside the viewport with 12px gutters and no horizontal scrolling.
- Cards are reserved for path choice and repeated reference records. Nested task content uses dividers and inset regions.

## Borders, radii, and depth

- Default border: 1px solid semantic border token.
- Current or selected border: strong or info border plus an inset highlight; no wide glow.
- Panel and control radius: 2px. Compact badges may use 2px, never full pills.
- Depth comes from surface contrast and hard offset shadows on the single active or primary object.
- Do not use soft large shadows, glass blur, or gradient text.

## Icon and sprite language

- Lucide is the standard icon set for copy, search, links, and navigation.
- Sprite-like state markers use a fixed 8x8 square plus readable text: solid for verified, outlined for ready, crossed for blocked, hollow for not started, and diagonally split for skipped.
- The Overview workstation ornament is decorative, uses crisp integer-scaled CSS blocks, and is hidden from assistive technology.
- Meaningful state always exists in semantic HTML outside decorative artwork.

## Primitives

### App frame

Use a hard top command bar, content canvas, and compact footer receipt. The header contains the brand, one `Paths` return action, Reference, Troubleshoot, Local tools with runtime state, and an optional read-only active-journey receipt.

Path selection and switching happen only on Overview. Step navigation lives only in the objective rail.

### Navigation and path context

Global controls have a 44px minimum target and use `aria-current` for the active route. The active DuskEVM or DuskDS journey is a read-only receipt, never a toggle. Overview path cards are navigation controls, so no path appears selected before activation.

### Quest step

Show number, task label, one-line objective, and status marker. Active route and evidence status are separate concepts and receive separate styling.

### Command block

Use an inset surface, mono text, a copy action, visible overflow handling, and no fake terminal prompt when the command is meant to be copied literally.

### Badges and tags

Use square corners, a state marker, and an uppercase mono label. Never use color alone or stretch badges into decorative pills.

### Fields and buttons

Use native semantic elements, a 44px minimum height, square corners, a visible focus outline, clear selected, disabled, and loading states, and short state transitions. Primary means the safest next action, not merely visual prominence.

### Notices and diagnostics

Use full-border or inset surfaces with a status word, next action, provenance, and timestamp where relevant. Avoid colored side stripes.

### Help and error states

State what happened, why the product can or cannot know more, and the safest next action. Blocked external infrastructure remains blocked and retryable; styling must not imply success.

## Screen composition

### Overview

First viewport order:

1. mission-console heading and workstation ornament on larger screens;
2. DuskEVM and DuskDS choice;
3. labelled comparison table; and
4. non-interactive four-stage preview.

The path decision is the dominant task. Mobile omits the decorative workstation so the choices arrive sooner. The stage preview explains the model but cannot bypass path selection.

### Guides

Use objective rail -> task surface -> evidence rail for the active DuskDS journey. Healthy states emphasize evidence recorded. Blocked network states show a readable reason, recovery action, and retry without changing layout.

DuskEVM is deliberately exempt from the four-stage evidence layout while Testnet is unavailable. Its single pre-launch learning surface may preview Setup, Access, Build, and Inspect, but it must not show a completion score, live wallet/RPC actions, or anything resembling a Testnet success state.

DuskDS preflight rows behave like a tactical equipment checklist: required versus optional, detected version, and failure category remain explicit.

DuskDS Inspect uses one continuous four-part task surface:

1. observe a latest block;
2. bind the result to the exact Build source identity;
3. review the manual deployment gate; and
4. return after finality for post-deploy reads.

Readiness is computed, never claimed. Setup, Access, Build artifacts, VM tests, and source identity must agree. Access evidence expires after 24 hours; Setup, Build, and source-binding evidence expires after 30 days.

Wallet settings, funding, signing, nonces, initialization arguments, gas overrides, submission, inclusion, and finality remain outside the Studio.

Post-deploy inspection checks contract metadata before enabling driver commands. Driver actions remain disabled until matching metadata reports `driver_available: true`.

### Reference

Lead with filter and search controls. Present resources and capabilities as dense source-backed rows. Maturity, source, and checked date form a compact receipt line.

## Motion and sound

- No default sound.
- Use a 180ms state transition for border, color, background, and small transforms only.
- Primary hover may move by one pixel; active returns to origin.
- No bounce, flicker, continuous glow, parallax, or page-load choreography.
- `prefers-reduced-motion: reduce` removes transforms and makes transitions effectively instant.

## Responsive and accessibility contract

- WCAG 2.2 AA contrast for text and controls.
- 44x44px interactive targets where layout permits; never below 40px for compact repeated navigation at 320px.
- A visible 2px `:focus-visible` outline with 2px offset on every interactive control.
- Keyboard order follows visual order; no focus traps or custom keyboard conventions.
- `aria-current="page"` identifies the active route.
- Async text uses scoped live regions.
- 200% zoom and widths 320, 390, 760, 761, 1120, 1121, 1280, and 1440 reflow without horizontal scrolling, clipped text, or off-canvas controls.
- Decorative CSS art is hidden from assistive technology.
- System-font fallbacks preserve layout when preferred fonts are unavailable.

## Anti-patterns

- No scanline overlay, flicker, CRT curvature distortion, chromatic aberration, or fake burn-in.
- No neon arcade palette, novelty cursor, custom scrollbar, decorative grid wallpaper, diagonal stripe background, glass blur, or gradient text.
- No pixel font for body, labels, form fields, commands, or long guidance.
- No oversized marketing hero inside task routes.
- No duplicate path switch in the header and Overview.
- No duplicate step navigation in both header and guide rail.
- No nested card wall, fake success state, hidden safety boundary, or game language that obscures developer meaning.
