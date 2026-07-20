import type { BuilderPath } from "./journeyProgress";
import {
  DUSKDS_FORGE_COMMIT,
  DUSKDS_RUST_TOOLCHAIN,
  DUSKDS_TEMPLATE_ID,
  DUSKDS_TEMPLATE_LOCK_SHA256,
  type ManualPlatform
} from "./manualJourneyConfig";

export interface PreflightTool {
  name: string;
  command: string;
  ok: boolean;
  required: boolean;
  version?: string;
  error?: string;
  failureKind?: "missing" | "unsupported" | "timeout" | "version-mismatch" | "execution-failed";
  installHint?: string;
}

export interface PreflightResult {
  ok: boolean;
  checkedAt: string;
  path: BuilderPath;
  tools: PreflightTool[];
}

export interface CompanionHealth {
  ok: boolean;
  service: string;
  paired: boolean;
  capabilitiesEnabled: boolean;
  release?: CompanionRelease;
}

export interface CompanionRelease {
  product: string;
  version: string;
  commit: string;
  channel: "hosted" | "npm" | "source-dev";
}

export interface PairingResult { ok: boolean; paired: boolean; expiresInSeconds: number; }

export interface ScaffoldEvidence {
  ok: boolean;
  projectName: string;
  projectPath: string;
  recovered?: boolean;
  structureVerified: boolean;
  files: string[];
  rustToolchain: string;
  runtimeOs: ManualPlatform;
  template: string;
  templateSource: string;
  templateRevision: string;
  templateLockSha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length <= max;
}

function optionalBoundedString(value: unknown, max = 512): boolean {
  return value === undefined || boundedString(value, max);
}

export function isCompanionHealth(value: unknown): value is CompanionHealth {
  return isRecord(value)
    && value.ok === true
    && boundedString(value.service, 64)
    && typeof value.paired === "boolean"
    && typeof value.capabilitiesEnabled === "boolean"
    && (value.release === undefined || (isRecord(value.release)
      && boundedString(value.release.product, 64)
      && boundedString(value.release.version, 64)
      && boundedString(value.release.commit, 64)
      && ["hosted", "npm", "source-dev"].includes(String(value.release.channel))));
}

export function isPairingResult(value: unknown): value is PairingResult {
  return isRecord(value) && value.ok === true && value.paired === true
    && typeof value.expiresInSeconds === "number" && Number.isSafeInteger(value.expiresInSeconds)
    && value.expiresInSeconds > 0 && value.expiresInSeconds <= 86_400;
}

export function isPreflightResult(value: unknown): value is PreflightResult {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !boundedString(value.checkedAt, 64)
      || (value.path !== "evm" && value.path !== "duskds") || !Array.isArray(value.tools)
      || value.tools.length > 64) return false;
  return value.tools.every((tool) => isRecord(tool)
    && boundedString(tool.name, 64)
    && boundedString(tool.command, 256)
    && typeof tool.ok === "boolean"
    && typeof tool.required === "boolean"
    && optionalBoundedString(tool.version, 128)
    && optionalBoundedString(tool.error)
    && optionalBoundedString(tool.installHint)
    && (tool.failureKind === undefined || ["missing", "unsupported", "timeout", "version-mismatch", "execution-failed"].includes(String(tool.failureKind))));
}

export function isScaffoldEvidence(value: unknown): value is ScaffoldEvidence {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !boundedString(value.projectName, 96)
      || !boundedString(value.projectPath, 1_024)
      || !(/^([a-zA-Z]:[\\/]|\/)/.test(value.projectPath)) || /[\0\r\n]/.test(value.projectPath)
      || (value.recovered !== undefined && typeof value.recovered !== "boolean")
      || typeof value.structureVerified !== "boolean" || !Array.isArray(value.files)
      || value.files.length > 256 || !value.files.every((file) => boundedString(file, 256))) return false;
  return value.rustToolchain === DUSKDS_RUST_TOOLCHAIN
    && (value.runtimeOs === "windows" || value.runtimeOs === "linux" || value.runtimeOs === "macos")
    && (value.runtimeOs === "windows"
      ? /^[a-zA-Z]:[\\/]/.test(value.projectPath)
      : value.projectPath.startsWith("/"))
    && value.template === DUSKDS_TEMPLATE_ID
    && value.templateSource === "https://github.com/dusk-network/forge"
    && value.templateRevision === DUSKDS_FORGE_COMMIT
    && value.templateLockSha256 === DUSKDS_TEMPLATE_LOCK_SHA256;
}
