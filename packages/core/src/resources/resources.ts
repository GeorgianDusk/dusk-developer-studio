import rawResources from "../../../../data/dusk/resources.json";
import rawTroubleshooting from "../../../../data/dusk/troubleshooting.json";
import rawCapabilities from "../../../../data/dusk/capabilities.json";
import { z } from "zod";

export const ResourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  summary: z.string(),
  url: z.string().url(),
  maturity: z.string(),
  tags: z.array(z.string())
});

export const TroubleshootingSchema = z.object({
  id: z.string(),
  title: z.string(),
  symptoms: z.array(z.string()),
  severity: z.enum(["low", "medium", "high"]),
  fix: z.string(),
  safeNextStep: z.string()
});

export const CapabilitySchema = z.object({
  id: z.string(),
  path: z.enum(["evm", "duskds", "both"]),
  title: z.string(),
  category: z.string(),
  summary: z.string(),
  beginnerUse: z.string(),
  safeNextStep: z.string(),
  maturity: z.string(),
  sourceStatus: z.string(),
  links: z.array(z.object({ label: z.string(), url: z.string().url() })),
  tags: z.array(z.string())
});

export type Resource = z.infer<typeof ResourceSchema>;
export type TroubleshootingItem = z.infer<typeof TroubleshootingSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;

export const RESOURCES: Resource[] = z.array(ResourceSchema).parse(rawResources);
export const TROUBLESHOOTING: TroubleshootingItem[] = z.array(TroubleshootingSchema).parse(rawTroubleshooting);
export const CAPABILITIES: Capability[] = z.array(CapabilitySchema).parse(rawCapabilities);

export function searchResources(query: string): Resource[] {
  const q = query.trim().toLowerCase();
  if (!q) return RESOURCES;
  return RESOURCES.filter((resource) =>
    [resource.title, resource.summary, resource.category, ...resource.tags].some((part) => part.toLowerCase().includes(q))
  );
}

export function searchTroubleshooting(query: string): TroubleshootingItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return TROUBLESHOOTING;
  return TROUBLESHOOTING.filter((item) =>
    [item.title, item.fix, item.safeNextStep, ...item.symptoms].some((part) => part.toLowerCase().includes(q))
  );
}

export function searchCapabilities(query: string): Capability[] {
  const q = query.trim().toLowerCase();
  if (!q) return CAPABILITIES;
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
    ].some((part) => part.toLowerCase().includes(q))
  );
}
