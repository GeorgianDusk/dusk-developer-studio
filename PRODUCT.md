# Product

## Users

Dusk developers and curious builders choosing between DuskEVM and DuskDS. They may be experienced Solidity or Rust developers, or first-time Dusk builders who need a clear path, safe setup checks, source-backed guidance, and enough context to understand each decision.

## Product purpose

Dusk Developer Studio helps a builder choose the right Dusk path. DuskDS then moves through Setup, Access, Build, and Inspect with evidence; DuskEVM currently uses one pre-launch learning surface until Testnet activation is verified.

The product has two complementary surfaces:

- the **Hosted guide**, a static browser experience for path selection, education, public read-only checks, resources, and troubleshooting; and
- the **local Studio**, started with the `dusk-developer-studio` npm package for a paired local session, prerequisite checks, constrained starter creation, and local evidence.

Safe mode starts with `npx dusk-developer-studio`. Local Actions starts with `npx dusk-developer-studio local-actions`.

For DuskDS, Inspect is intentionally two-pass: verify one exact build, prepare a Testnet-only manual Rusk Wallet handoff, then return after finality to confirm contract metadata and data-driver reads. Success means a developer understands which path fits the project, what to do next, which tools and sources matter, and which actions remain deliberately manual.

DuskEVM Testnet is not live yet, so its journey remains educational and must not present live RPC, wallet, balance, deployment, or inspection evidence.

## Brand personality

Calm, precise, and capable. The interface should feel like a polished developer product: quiet enough to trust, structured enough for beginners, and technically clear enough for experienced builders.

## Product principles

- **Lead with path clarity.** Make DuskEVM versus DuskDS the primary decision before showing detailed tooling.
- **Teach by sequence without faking availability.** DuskDS makes the next Setup, Access, Build, or Inspect task obvious. The pre-launch DuskEVM surface explains the planned sequence without presenting four live stages or a completion score.
- **Explain before asking.** Dusk-specific terms, evidence, and failure categories need plain-language context.
- **Keep advanced detail available, not overwhelming.** Use collapsible explanations, grouped rows, and source labels.
- **Make local capability deliberate.** The Hosted guide never implies machine access. Safe and Local Actions remain visibly distinct.
- **Preserve wallet control.** Wallet settings, funding, signing, submission, and finality stay with the developer.
- **Show evidence, not confidence theatre.** Ready, blocked, verified, expired, and unavailable states must reflect real inputs.
- **Favor trustworthy restraint.** The UI should feel refined, fast, and source-backed rather than decorative or noisy.

## Anti-references

Avoid admin-console layouts, dense card walls, generic SaaS dashboards, marketing fluff, fake deployment success, unsupported faucet claims, or UI that makes educational features look like live automation.

Do not expose wallet secrets, browser signing, mainnet shortcuts, VPS scaffolding, arbitrary commands, hidden local access, or local actions from the Hosted guide.

## Accessibility and inclusion

Target WCAG 2.2 AA contrast for body text and controls. Support keyboard navigation, visible focus states, reduced motion, large tap targets, mobile reflow without horizontal overflow, and beginner-friendly labels that do not assume prior Dusk knowledge.
