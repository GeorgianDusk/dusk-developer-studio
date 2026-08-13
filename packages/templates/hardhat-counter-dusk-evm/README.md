# DuskEVM Hardhat Counter Starter

Minimal Hardhat 3 starter for DuskEVM Testnet onboarding.

## Safety boundary

- Example only, unaudited, and not production-ready.
- No regulated-asset, Hedger, bridge, or faucet logic.
- The deployment account and RPC are resolved only from Hardhat's encrypted keystore. Hardhat normally gives same-named environment variables precedence, so this starter fails closed if either reviewed variable is present in the process environment.
- Never paste a private key, mnemonic, or seed phrase into a command, file, or Studio.
- Use an encrypted Hardhat keystore or hardware-wallet workflow when you deliberately add a signer.

## Reproduce the local build

```bash
npm ci
npx hardhat compile
npx hardhat test
```

The starter pins Hardhat `3.13.0`, the Viem toolbox `5.0.7`, TypeScript `7.0.2`, Solidity `0.8.28`, and optimizer runs `200`. Its `duskEvmTestnet` network is an OP-style HTTP network for chain `745`; the RPC and account remain unresolved until a deliberate deploy.

## Signer-owned Testnet deployment

Re-run Studio's chain/progression check, then store both values interactively. Enter `https://rpc.testnet.evm.dusk.network` for the RPC prompt and a dedicated Testnet deployer key for the private-key prompt. Hardhat encrypts these values in its keystore; never pass either value on the command line.

Before invoking Hardhat, unset `DUSKEVM_TESTNET_RPC_URL` and `DUSKEVM_TESTNET_PRIVATE_KEY` in the current shell. The starter intentionally refuses to run while either value is supplied by the environment, preventing it from silently overriding the encrypted keystore.

```bash
npx hardhat keystore set DUSKEVM_TESTNET_RPC_URL
npx hardhat keystore set DUSKEVM_TESTNET_PRIVATE_KEY
npx hardhat ignition deploy ignition/modules/Counter.ts --network duskEvmTestnet
```

Before approving the deployment, compare the exact artifact and constructor arguments, then review the chain, account, value, and fee in the signing workflow you control. Follow the [official DuskEVM Quickstart](https://docs.dusk.network/developer/duskevm/quickstart/) for the current end-to-end handoff.
