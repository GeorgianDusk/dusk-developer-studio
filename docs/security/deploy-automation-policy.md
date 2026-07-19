# Deploy Automation Policy

Date: 2026-07-19
Status: hosted-production guardrail; DuskEVM remains pre-launch

## Position

The public Studio may automate local checks, scaffolding, build commands, read-only inspection, and command-shape generation only through the user's loopback companion. It must not automate signing, funded wallet use, or native contract deployment until a product owner approves an explicit policy.

## Allowed Now

- Show DuskDS deploy command shapes and clearly labeled educational DuskEVM
  command shapes that do not imply a live Testnet.
- Generate local starter projects through allowlisted local-agent routes.
- Run preflight checks for required and optional tooling.
- Link to official docs and explorers.
- Capture non-secret transaction hashes, contract addresses, contract IDs, artifact paths, and diagnostics when the user provides them.

## Not Allowed Yet

- Asking the user to paste private keys or seed material into the Studio.
- Browser-based contract signing.
- Local-agent commands that read wallet secrets, unlock accounts, or sign transactions.
- Automated Rusk Wallet `contract-deploy` or `contract-call` execution.
- Mainnet deployment shortcuts.

## Minimum Approval Gates Before Automation

1. Wallet profile policy: which profile type is allowed, where it lives, and how it is selected without exposing secrets.
2. Funding policy: how the Studio detects testnet-only balance and prevents accidental mainnet use.
3. Fee and nonce policy: how fees, deploy nonce, retries, and duplicate-submit protection are explained and confirmed.
4. Network policy: which node URLs are allowed and how mismatched wallet/node state is detected.
5. Audit policy: what local deployment metadata may be saved, how it avoids secrets, and how a user can delete it.
6. Human confirmation policy: every signing action must require a deliberate, visible confirmation outside the Studio unless a separate reviewed signer integration is approved.

## Next Safe Product Step

The deploy readiness assistant is implemented. It derives readiness from the exact recorded Setup, Access, Build, VM-test, and source-identity evidence; rejects blocked, skipped, future-dated, or expired evidence; fixes the command shape to DuskDS Testnet; and leaves all wallet, funding, nonce, optional argument, gas, signing, submission, inclusion, and finality decisions in the user's terminal. Access evidence is valid for 24 hours; Setup, Build, and source binding are valid for 30 days.

The next safe step is evidence collection, not more automation: verify the final candidate through the Phase 5 independent reviews and genuine pilot sessions. Any future wallet or deployment execution still requires every approval gate above and a separate reviewed implementation.
