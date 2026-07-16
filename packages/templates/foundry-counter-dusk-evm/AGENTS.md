# AGENTS

This is a generated local DuskEVM Testnet example.

Rules:
- Do not add private keys, mnemonics, seeders, or API secrets.
- Keep this example unaudited and not production-ready.
- Do not add regulated-asset, Hedger, bridge, or faucet logic here.
- Use Foundry keystore accounts for deployment.

Safe deploy pattern:

```bash
cast wallet import dusk-testnet-deployer --interactive
forge create src/Counter.sol:Counter --rpc-url dusk_evm_testnet --account dusk-testnet-deployer
```
