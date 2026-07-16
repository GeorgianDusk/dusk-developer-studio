import type { CommandPlatform } from "@dusk/core";
import type { StepRoute } from "./journeyProgress";
import type { CompanionRelease } from "./responseSchemas";

export type RouteId = "overview" | StepRoute | "reference" | "troubleshooting" | "companion" | "settings";
export type Tone = "good" | "warn" | "neutral" | "danger";

export type CompanionStatus =
  | { state: "checking"; message: string }
  | { state: "available"; message: string; capabilitiesEnabled: boolean; release?: CompanionRelease }
  | { state: "mismatch"; message: string; release?: CompanionRelease }
  | { state: "unavailable"; message: string };

export interface StepInfo {
  id: StepRoute;
  number: string;
  label: string;
  title: string;
  intent: string;
  done: string[];
}

export interface ScaffoldEvidence {
  ok: boolean;
  projectName: string;
  structureVerified: boolean;
  files: string[];
  rustToolchain?: string;
  platform?: CommandPlatform;
}
