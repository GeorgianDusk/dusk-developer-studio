# Deployment automation boundary

## Position

Dusk Developer Studio may prepare and verify a deployment workflow, but it does not control a funded wallet or submit a contract deployment.

The local Studio may perform allowlisted local checks, constrained scaffolding, build guidance, read-only inspection, and command-shape generation. Wallet settings, funding, wallet signing, nonces, optional arguments, gas choices, submission, inclusion, and finality remain in the developer's trusted terminal.

## Supported assistance

The Studio may:

- show DuskDS Testnet deployment command shapes;
- show clearly labelled educational DuskEVM command shapes without implying a live Testnet;
- run allowlisted prerequisite checks through Local Actions;
- create constrained starter projects through Local Actions;
- verify build artifacts, VM-test evidence, and source identity;
- link to official wallet, network, tool, and explorer documentation;
- capture non-secret transaction hashes, contract addresses, contract IDs, artifact paths, and sanitized diagnostics supplied by the developer; and
- perform read-only post-deployment checks.

## Actions kept outside the Studio

The Studio must not:

- ask for a private key, mnemonic, seed phrase, wallet password, seeder, profile entropy, or API secret;
- read or unlock a wallet profile;
- sign a browser transaction;
- execute Rusk Wallet `contract-deploy` or `contract-call`;
- select fees, nonces, optional arguments, gas overrides, or funded accounts;
- submit, retry, or replace a transaction; or
- provide a mainnet deployment shortcut.

## DuskDS manual handoff

Deploy readiness derives from matching Setup, Access, Build, VM-test, and source-identity evidence.

The readiness result fails closed when required evidence is blocked, skipped, future-dated, expired, or bound to a different build. Access evidence is valid for 24 hours. Setup, Build, and source-binding evidence is valid for 30 days.

When readiness passes, the Studio presents a Testnet-only command shape with placeholders. The developer reviews and completes it in a trusted terminal, approves the wallet action there, waits for inclusion and finality, and returns to the Studio for read-only inspection.

Readiness is not proof of deployment, inclusion, finality, or data-driver availability.

## Requirements for any future wallet integration

Any proposal to expand this boundary requires a separate security and product review covering:

1. allowed wallet profile types and selection without secret exposure;
2. Testnet-only funding and network mismatch prevention;
3. fees, nonce handling, retries, and duplicate-submit protection;
4. node allowlists and wallet/node state consistency;
5. the exact non-secret deployment metadata stored locally and its deletion path;
6. deliberate human confirmation for every funded action;
7. failure, cancellation, timeout, and recovery behavior; and
8. independent testing with unfunded isolated accounts before any wider use.

## DuskEVM

DuskEVM Testnet is not live yet. Its deployment material remains educational and must not show live RPC, wallet, balance, submission, or inspection evidence until the real Testnet can be verified.
