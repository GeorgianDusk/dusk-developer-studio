import { z } from "zod";

export const NativeCurrencySchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().positive()
});

export const DuskEvmNetworkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  chainId: z.number().int().positive(),
  chainIdHex: z.string().regex(/^0x[0-9a-f]+$/i),
  nativeCurrency: NativeCurrencySchema,
  rpcUrls: z.array(z.string().url()).min(1),
  wssUrls: z.array(z.string().url()).default([]),
  explorerUrl: z.string().url(),
  blockTimeSeconds: z.number().positive(),
  enabledByDefault: z.boolean(),
  maturity: z.enum(["testnet", "mainnet-reference", "devnet-reference", "unconfirmed"]),
  sourceLabel: z.string().min(1),
  sourceUrl: z.string().url(),
  warning: z.string().min(1)
});

export const DuskEvmNetworksSchema = z.array(DuskEvmNetworkSchema).min(1);

export type NativeCurrency = z.infer<typeof NativeCurrencySchema>;
export type DuskEvmNetwork = z.infer<typeof DuskEvmNetworkSchema>;
