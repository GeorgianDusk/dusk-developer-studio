import type { DuskEvmNetwork } from "../config/network.schema";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const BLOCK_RE = /^0x[0-9a-f]+$/i;

export function isAddress(value: string): boolean {
  return ADDRESS_RE.test(value.trim());
}

export function isTxHash(value: string): boolean {
  return TX_HASH_RE.test(value.trim());
}

export function explorerAddressUrl(network: DuskEvmNetwork, address: string): string {
  if (!isAddress(address)) {
    throw new Error("Invalid EVM address.");
  }
  return `${network.explorerUrl.replace(/\/$/, "")}/address/${address.trim()}`;
}

export function explorerTxUrl(network: DuskEvmNetwork, txHash: string): string {
  if (!isTxHash(txHash)) {
    throw new Error("Invalid transaction hash.");
  }
  return `${network.explorerUrl.replace(/\/$/, "")}/tx/${txHash.trim()}`;
}

export function explorerBlockUrl(network: DuskEvmNetwork, blockNumberHex: string): string {
  if (!BLOCK_RE.test(blockNumberHex.trim())) throw new Error("Invalid block number.");
  return `${network.explorerUrl.replace(/\/$/, "")}/block/${BigInt(blockNumberHex.trim()).toString()}`;
}
