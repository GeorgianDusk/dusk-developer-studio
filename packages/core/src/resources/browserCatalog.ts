import rawCapabilities from "../../../../data/dusk/capabilities.json";
import rawNetworks from "../../../../data/dusk/networks.evm.json";
import rawResources from "../../../../data/dusk/resources.json";
import rawTroubleshooting from "../../../../data/dusk/troubleshooting.json";
import type { DuskEvmNetwork } from "../config/network.schema";
import type { Capability, Resource, TroubleshootingItem } from "./resources";

// The source-validation and assurance gates parse these reviewed files with the
// canonical Zod schemas. The browser consumes the already-validated static data
// without shipping the validator in the production JavaScript bundle.
export const DUSK_EVM_NETWORKS = rawNetworks as DuskEvmNetwork[];
export const RESOURCES = rawResources as Resource[];
export const TROUBLESHOOTING = rawTroubleshooting as TroubleshootingItem[];
export const CAPABILITIES = rawCapabilities as Capability[];

export type { Capability, DuskEvmNetwork, Resource, TroubleshootingItem };

export function getDefaultDuskEvmNetwork(): DuskEvmNetwork {
  const network = DUSK_EVM_NETWORKS.find((item) => item.enabledByDefault);
  if (!network) throw new Error("No enabled DuskEVM network is configured.");
  return network;
}

export function searchResources(query: string): Resource[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return RESOURCES;
  return RESOURCES.filter((resource) =>
    [resource.title, resource.summary, resource.category, ...resource.tags]
      .some((part) => part.toLowerCase().includes(normalized))
  );
}

export function searchTroubleshooting(query: string): TroubleshootingItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return TROUBLESHOOTING;
  return TROUBLESHOOTING.filter((item) =>
    [item.title, item.fix, item.safeNextStep, ...item.symptoms]
      .some((part) => part.toLowerCase().includes(normalized))
  );
}

export function searchCapabilities(query: string): Capability[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return CAPABILITIES;
  return CAPABILITIES.filter((capability) =>
    [
      capability.title,
      capability.category,
      capability.summary,
      capability.beginnerUse,
      capability.safeNextStep,
      capability.maturity,
      capability.sourceStatus,
      ...capability.tags
    ].some((part) => part.toLowerCase().includes(normalized))
  );
}
