import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

for (const variable of ["DUSKEVM_TESTNET_RPC_URL", "DUSKEVM_TESTNET_PRIVATE_KEY"]) {
  if (process.env[variable]) {
    throw new Error(`${variable} must not come from the process environment; remove it and use Hardhat's encrypted keystore.`);
  }
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    duskEvmTestnet: {
      type: "http",
      chainType: "op",
      chainId: 745,
      url: configVariable("DUSKEVM_TESTNET_RPC_URL"),
      accounts: [configVariable("DUSKEVM_TESTNET_PRIVATE_KEY")]
    }
  }
});
