# Dusk Developer Studio Design System

## Design thesis

Dusk Developer Studio is a late-90s tactical/cyber-RPG workstation for real developer tasks: a builder at a CRT after dark, with a technical manual beside the keyboard. The game reference appears through hard-edged framing, mission language, compact sprite-like state markers, disciplined mono typography, and one purposeful workstation scene. It must still behave like a modern developer tool.

The memorable move is the **mission console**: the selected Dusk path reads as the active build campaign, and each Setup → Access → Build → Inspect step reads as a verifiable objective with evidence—not as decorative game chrome.

## Principles

1. **Truth is the main visual hierarchy.** Verified, blocked, ready, skipped, source, maturity, and Testnet/local boundaries remain visible and never rely on color alone.
2. **Game-tool, not arcade cabinet.** Use hard edges, one-pixel borders, compact status sprites, inset command surfaces, and restrained Dusk accents. Avoid visual damage, fake hardware defects, or novelty controls.
3. **Standard controls stay standard.** Buttons, links, inputs, navigation, focus, disabled states, and live regions remain familiar and keyboard-operable.
4. **Pixel energy is concentrated.** Mono/display treatment belongs to major headings, compact status, code, and the workstation ornament. Body copy and controls use a legible UI sans stack.
5. **Density follows the task.** Overview is spacious enough to choose a path. Guide steps become denser around commands and evidence. Reference becomes a scannable list, not a card wall.
6. **Phase 2 truth is immutable.** Styling must not change evidence requirements, network policy, companion containment, signing policy, or completion logic.

## Physical scene and color strategy

A developer uses the Studio at night beside a dim CRT and an open protocol manual; the room is dark, but the screen is calm enough for a long debugging session. The color strategy is restrained: cool near-black surfaces carry the product, blue identifies navigation/information, mint marks verified/primary action, amber marks ready/warning, and rose marks blocked/danger.

## Semantic tokens

| Role | Token | Value | Use |
|---|---|---:|---|
| Canvas | `--canvas` | `#05070b` | Browser and app background |
| Surface | `--surface` | `#0b1119` | Main panels and tool areas |
| Raised | `--surface-raised` | `#111b27` | Sticky evidence/status surfaces |
| Inset | `--surface-inset` | `#030509` | Code, fields, CRT screen |
| Border | `--border` | `#2b3d50` | One-pixel structure |
| Strong border | `--border-strong` | `#55728d` | Current/selected structure |
| Text | `--text` | `#f3f6f1` | Primary copy |
| Muted text | `--text-muted` | `#a8b5c2` | Supporting copy; AA on canvas/surfaces |
| Quiet text | `--text-quiet` | `#83919e` | Metadata and disabled explanation |
| Focus | `--focus` | `#96caff` | 2px keyboard focus outline |
| Success | `--success` | `#72edb5` | Verified and primary safe actions |
| Warning | `--warning` | `#f0ca70` | Ready, caution, retryable states |
| Danger | `--danger` | `#ff8da0` | Blocked and destructive/error states |
| Info | `--info` | `#7eb9f5` | Current path, links, source context |
| Disabled | `--disabled` | `#7c8995` | Disabled control text plus reduced opacity |

Color is always paired with text, shape, icon, border treatment, or status wording. No state is color-only.

## Type roles

- **UI and body:** `IBM Plex Sans`, `Segoe UI`, system sans; 16px default, 1.5–1.6 line-height, 65–75ch prose ceiling.
- **Display:** `Cascadia Code`, `JetBrains Mono`, monospace; 40–48px desktop and 30–36px mobile, `-0.02em` minimum letter spacing, balanced wrapping.
- **Section title:** UI sans, 20–24px, 700 weight.
- **Status/data:** mono, 11–12px, uppercase only for compact machine-like labels.
- **Code:** mono, 13px minimum, 1.55 line-height, wrapping only when required to prevent viewport overflow.

Controls, body copy, long guidance, and navigation never use pixel/display typography.

## Spacing and grid

- Base unit: 4px. Primary steps: 8, 12, 16, 24, 32, 48, 64.
- Desktop content maximum: 1360px.
- Guide desktop: objective rail `216px`, task surface `minmax(0, 1fr)`, evidence rail `312px`.
- At 1120px and below, evidence moves below the task surface; at 760px and below, the objective rail becomes a 2×2 mission grid.
- At 390px and 320px, all controls remain inside the viewport with 12px gutters and no horizontal scrolling.
- Cards are reserved for path choice and repeated reference records. Nested task content uses dividers/inset regions, not card-inside-card stacks.

## Borders, radii, and depth

- Default border: 1px solid semantic border token.
- Current/selected border: 1px strong/info border plus an inset highlight; no wide glow.
- Panel radius: 2px. Controls: 2px. Compact badges may use 2px, never full pills.
- Depth comes from surface contrast and hard offset shadows (`3px 3px 0`) on the single active/primary object. No soft 16px+ shadows, glass blur, or gradient text.

## Icon and sprite language

- Lucide remains the standard icon set for copy, search, links, and navigation.
- Sprite-like state markers use a fixed 8×8 square plus readable text: solid for verified, outlined for ready, crossed for blocked, hollow for not started, and diagonally split for skipped.
- The Overview workstation ornament is decorative (`aria-hidden`) and built from crisp integer-scaled CSS blocks. It depicts one CRT, one seated developer, and one open manual; it contains no text or meaningful state.
- Meaningful status always exists in semantic HTML outside decorative artwork.

## Primitives

### App frame

Hard top command bar, content canvas, and compact footer receipt. The header contains the brand, one `Paths` return action, Reference, Troubleshoot, Local tools with its runtime state, and an optional read-only active-journey receipt. Path selection and path changing happen only on the Overview. Step navigation lives only in the objective rail.

### Global navigation and path context

Global controls have a 44px minimum target and use `aria-current` for the active route. The active DuskEVM or DuskDS journey is a read-only receipt, never a toggle. Overview path cards are navigation controls rather than pressed-state selectors, so no path appears chosen before activation. Hover never mimics current state.

### Quest step

Number, task label, one-line objective, and status marker. Active route and evidence status are separate concepts and receive separate styling.

### Command block

Inset surface, mono text, copy action, visible overflow handling, and no fake terminal prompt when the command is meant to be copied literally.

### Badges and tags

Square 2px corners, state marker, uppercase mono label. Never use color alone and never stretch into decorative pills.

### Fields and buttons

Native semantic elements, 44px minimum height, square 2px corners, visible focus outline, selected/disabled/loading states, and 180ms state transitions. Primary means safe next action—not merely visual prominence.

### Notices and diagnostics

Full-border or inset surfaces with status word, next action, provenance, and timestamp where relevant. No colored side stripe.

### Help and empty/error states

State what happened, why the product can or cannot know more, and the safest next action. Blocked external infrastructure remains blocked/retryable; no visual treatment implies success.

## Screen composition

### Overview

First viewport order: mission-console heading + workstation ornament on larger screens → DuskEVM/DuskDS choice → labeled comparison table → non-interactive four-stage preview. The path decision is the dominant task. Mobile omits the decorative workstation so the choices arrive sooner. The four-stage preview explains the model but cannot bypass path selection.

### EVM guide

Objective rail → task surface → evidence rail. Healthy states emphasize evidence recorded; blocked RPC/wallet states show a danger marker, readable recovery, and retry without changing layout.

### DuskDS guide

Same shell as EVM for transfer learning. Preflight/tool rows behave like a tactical equipment checklist: required vs optional and failure category remain explicit.

Inspect uses one continuous four-part task surface rather than adding a fifth journey stage: observe a latest block, bind the result to the exact Build source identity, review the derived manual deployment gate, then return after finality for post-deploy reads. Readiness is a computed status, never a success claim: Setup, Access, Build artifacts, VM tests, and source identity must agree before it reads as ready. The gate shows the oldest required observation and its refresh deadline; Access expires after 24 hours, while Setup, Build, and source-binding evidence expire after 30 days. Wallet settings, funding, signing, nonces, initialization arguments, gas overrides, submission, inclusion, and finality remain outside Studio.

Post-deploy inspection checks contract metadata first with separate Linux/macOS and Windows commands. Driver commands and schema/encode/decode confirmations stay disabled until saved metadata evidence for the same contract ID and source identity reports `driver_available: true`; deployment alone must never be presented as proof that a data driver was published. Identity changes clear dependent digests and confirmations, and the recovery action focuses the exact missing-driver guidance.

### Reference

Filter/search controls lead. Resources and capabilities are dense source-backed rows. Maturity/source/checked date form a compact receipt line. Mainnet/Devnet remain visually quieter reference records.

## Motion and sound

- No default sound and no future sound without explicit user opt-in and product approval.
- State transitions: 180ms `cubic-bezier(0.22, 1, 0.36, 1)` for border, color, background, and small transforms only.
- Primary hover may move by one pixel; active returns to origin. No bounce, flicker, continuous glow, parallax, or page-load choreography.
- `prefers-reduced-motion: reduce` removes transforms and reduces transitions to effectively instant.

## Responsive and accessibility contract

- WCAG 2.2 AA contrast for text and controls.
- 44×44px interactive targets where layout permits; never below 40px for compact repeated navigation at 320px.
- 2px visible `:focus-visible` outline with 2px offset on every interactive control.
- Keyboard order follows visual order; no focus traps or custom keyboard conventions.
- `aria-current="page"` identifies the active route. Overview path cards are ordinary navigation buttons and do not expose a selected state before activation.
- Async text uses scoped live regions already present in the journeys.
- 200% zoom and widths 320, 390, 760, 761, 1120, 1121, 1280, and 1440 must reflow without horizontal scroll, clipped text, or off-canvas controls.
- Decorative CSS art is hidden from assistive technology; all meaningful state has a text alternative.
- System-font fallbacks must preserve layout if IBM Plex/Cascadia/JetBrains fonts are unavailable.

## Anti-patterns

- No scanline overlay, flicker, CRT curvature distortion, chromatic aberration, or fake burn-in.
- No neon arcade palette, novelty cursor, custom scrollbar, or non-standard control.
- No decorative grid wallpaper, diagonal stripe background, gradient text, glass blur, or soft ghost-card shadow.
- No pixel font for body, labels, form fields, commands, or long guidance.
- No oversized marketing hero inside task routes.
- No duplicate path switch in the header and Overview, and no duplicate step navigation in both header and guide rail.
- No nested card wall, fake success state, hidden safety boundary, or game language that obscures developer meaning.

## Rollback

The Phase 3 implementation is token- and class-driven. Restoring the Phase 2 stylesheet and removing the decorative workstation component returns the previous theme without reverting journey logic, evidence state, local companion behavior, or product truth.
