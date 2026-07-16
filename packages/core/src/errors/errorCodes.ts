export interface NormalizedError {
  code: string;
  title: string;
  message: string;
  recommendedAction: string;
}

export function normalizeWalletError(error: unknown): NormalizedError {
  const maybe = error as { code?: number | string; message?: string } | undefined;
  const code = maybe?.code?.toString();
  const message = maybe?.message ?? "Wallet request failed.";

  if (code === "4001") {
    return {
      code: "wallet-user-rejected",
      title: "Wallet request rejected",
      message,
      recommendedAction: "Review the requested network action, then retry if you trust it."
    };
  }

  if (code === "4902") {
    return {
      code: "wallet-chain-missing",
      title: "Network not added",
      message,
      recommendedAction: "Add DuskEVM Testnet to the wallet before switching."
    };
  }

  return {
    code: code ? `wallet-${code}` : "wallet-error",
    title: "Wallet error",
    message,
    recommendedAction: "Check wallet state, selected account, and network details."
  };
}
