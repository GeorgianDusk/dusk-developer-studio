import type { DuskEvmNetwork } from "../config/network.schema";

export interface Eip1193Provider {
  request<T = unknown>(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<T>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjectedProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ethereum;
}

export async function getWalletChainId(provider: Eip1193Provider): Promise<string> {
  const chainId = await provider.request<unknown>({ method: "eth_chainId" });
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) {
    throw new Error("Wallet returned an invalid chain ID.");
  }
  return chainId.toLowerCase();
}

export async function getWalletAccounts(provider: Eip1193Provider, requestAccess = false): Promise<string[]> {
  const method = requestAccess ? "eth_requestAccounts" : "eth_accounts";
  const accounts = await provider.request<unknown>({ method });
  if (!Array.isArray(accounts)) throw new Error("Wallet returned an invalid account list.");
  return accounts.filter((account): account is string => typeof account === "string" && /^0x[a-fA-F0-9]{40}$/.test(account));
}

export async function getWalletBalance(provider: Eip1193Provider, address: string): Promise<{ wei: bigint; formatted: string }> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw new Error("A valid wallet address is required.");
  const raw = await provider.request<unknown>({ method: "eth_getBalance", params: [address, "latest"] });
  if (typeof raw !== "string" || !/^0x[0-9a-f]+$/i.test(raw)) throw new Error("Wallet returned an invalid balance.");
  const wei = BigInt(raw);
  const base = 10n ** 18n;
  const whole = wei / base;
  const fraction = (wei % base).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 6);
  return { wei, formatted: fraction ? `${whole}.${fraction}` : whole.toString() };
}

export async function addOrSwitchNetwork(provider: Eip1193Provider, network: DuskEvmNetwork): Promise<void> {
  const params = {
    chainId: network.chainIdHex,
    chainName: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: network.rpcUrls,
    blockExplorerUrls: [network.explorerUrl]
  };

  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: network.chainIdHex }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: number }).code) : undefined;
    if (code !== 4902) {
      throw error;
    }
    await provider.request({ method: "wallet_addEthereumChain", params: [params] });
  }
}
