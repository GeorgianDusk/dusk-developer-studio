# DuskEVM Foundry Counter Starter

Minimal Foundry starter for DuskEVM Testnet onboarding.

Licensed under Apache-2.0.

## Safety

- Example only.
- Unaudited.
- Not production-ready.
- No regulated-asset logic.
- No Hedger logic.
- No bridge or faucet logic.
- Do not paste private keys into commands or files.

## Commands

```bash
forge build
forge test
cast wallet import dusk-testnet-deployer --interactive
forge create src/Counter.sol:Counter --rpc-url dusk_evm_testnet --account dusk-testnet-deployer
```

## DuskEVM RPC Aliases

Configured in `foundry.toml`:

- `dusk_evm_testnet`: `https://rpc.testnet.evm.dusk.network`
- `dusk_evm_mainnet`: `https://rpc.evm.dusk.network`

Mainnet is included as reference metadata only. This starter is testnet-first.
