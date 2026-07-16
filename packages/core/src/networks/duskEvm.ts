import rawNetworks from "../../../../data/dusk/networks.evm.json";
import { DuskEvmNetworkSchema, DuskEvmNetworksSchema, type DuskEvmNetwork } from "../config/network.schema";

export const DUSK_EVM_NETWORKS: DuskEvmNetwork[] = DuskEvmNetworksSchema.parse(rawNetworks);

export function getDuskEvmNetwork(id: string): DuskEvmNetwork | undefined {
  return DUSK_EVM_NETWORKS.find((network) => network.id === id);
}

export function getDefaultDuskEvmNetwork(): DuskEvmNetwork {
  const network = DUSK_EVM_NETWORKS.find((item) => item.enabledByDefault);
  if (!network) {
    throw new Error("No enabled DuskEVM network is configured.");
  }
  return DuskEvmNetworkSchema.parse(network);
}

export function visibleNetworks(showDisabled = false): DuskEvmNetwork[] {
  return DUSK_EVM_NETWORKS.filter((network) => showDisabled || network.enabledByDefault);
}
