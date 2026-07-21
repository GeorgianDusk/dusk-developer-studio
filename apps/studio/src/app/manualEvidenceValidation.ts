import type { EvidenceMetadata } from "./journeyProgress";
import { DUSKDS_TESTNET_NODE } from "./manualJourneyConfig";

export interface ValidationResult<T, F extends string = string> {
  value?: T;
  error?: string;
  field?: F;
}

export type BlockObservationField = "height" | "hash";

export function validateBlockObservation(heightInput: string, hashInput: string): ValidationResult<EvidenceMetadata, BlockObservationField> {
  const height = Number(heightInput.trim());
  if (!/^\d+$/.test(heightInput.trim()) || !Number.isSafeInteger(height) || height < 0) {
    return { error: "Enter the non-negative block height you observed.", field: "height" };
  }
  const hash = hashInput.trim().toLowerCase();
  if (!/^(?:0x)?[a-f0-9]{64}$/.test(hash)) {
    return { error: "Enter a 32-byte block hash as 64 hexadecimal characters, with or without 0x.", field: "hash" };
  }
  return {
    value: {
      source: "manual-confirmation",
      tool: "w3sper",
      blockHeight: height,
      blockHash: hash,
      endpoint: DUSKDS_TESTNET_NODE
    }
  };
}

export function validateRevision(input: string): ValidationResult<string, "revision"> {
  const revision = input.trim().toLowerCase();
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision)
    ? { value: revision }
    : { error: "Enter the full 40- or 64-character Git tree or commit ID printed by the Build command.", field: "revision" };
}

export type DriverObservationKind = "availability" | "schema" | "encode" | "decode";
export type DriverObservationField = "contractId" | "functionName" | "responseSha256";

export function validateDriverObservation(
  kind: DriverObservationKind,
  input: { contractId: string; functionName: string; responseSha256: string }
): ValidationResult<EvidenceMetadata, DriverObservationField> {
  const contractId = input.contractId.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contractId)) {
    return { error: "Enter the deployed 32-byte contract ID as 64 hexadecimal characters.", field: "contractId" };
  }
  const functionName = input.functionName.trim();
  if (kind === "encode" || kind === "decode") {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(functionName)) {
      return { error: "Enter the exact contract function name used for this encode or decode check.", field: "functionName" };
    }
  }
  const responseSha256 = input.responseSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(responseSha256)) {
    return { error: "Enter the SHA-256 of the exact response body as 64 hexadecimal characters.", field: "responseSha256" };
  }
  return {
    value: {
      source: "manual-confirmation",
      tool: "rpc",
      endpoint: DUSKDS_TESTNET_NODE,
      contractId,
      ...(kind === "encode" || kind === "decode" ? { functionName } : {}),
      responseSha256
    }
  };
}

function validateArtifactName(input: string, label: string): ValidationResult<string> {
  const name = input.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\.wasm$/i.test(name) || name.includes("..")) {
    return { error: `${label} must be a WASM basename without folders, such as counter_contract.wasm.` };
  }
  return { value: name };
}

function validateSha256(input: string, label: string): ValidationResult<string> {
  const hash = input.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash)
    ? { value: hash }
    : { error: `${label} SHA-256 must contain exactly 64 hexadecimal characters.` };
}

function validateSize(input: string, label: string): ValidationResult<number> {
  const size = Number(input.trim());
  return /^\d+$/.test(input.trim()) && Number.isSafeInteger(size) && size > 0 && size <= 100_000_000
    ? { value: size }
    : { error: `${label} size must be between 1 and 100,000,000 bytes.` };
}

export type BuildArtifactField =
  | "revision"
  | "contractName"
  | "contractSha256"
  | "contractSize"
  | "dataDriverName"
  | "dataDriverSha256"
  | "dataDriverSize";

export function validateBuildArtifacts(input: {
  revision: string;
  contractName: string;
  contractSha256: string;
  contractSize: string;
  dataDriverName: string;
  dataDriverSha256: string;
  dataDriverSize: string;
}): ValidationResult<EvidenceMetadata, BuildArtifactField> {
  const checks = [
    ["revision", validateRevision(input.revision)],
    ["contractName", validateArtifactName(input.contractName, "Contract artifact")],
    ["contractSha256", validateSha256(input.contractSha256, "Contract artifact")],
    ["contractSize", validateSize(input.contractSize, "Contract artifact")],
    ["dataDriverName", validateArtifactName(input.dataDriverName, "Data-driver artifact")],
    ["dataDriverSha256", validateSha256(input.dataDriverSha256, "Data-driver artifact")],
    ["dataDriverSize", validateSize(input.dataDriverSize, "Data-driver artifact")]
  ] as const;
  const failed = checks.find(([, result]) => result.error);
  if (failed?.[1].error) return { error: failed[1].error, field: failed[0] };
  return {
    value: {
      source: "manual-confirmation",
      revision: checks[0][1].value as string,
      contractArtifactName: checks[1][1].value as string,
      contractArtifactSha256: checks[2][1].value as string,
      contractArtifactSizeBytes: checks[3][1].value as number,
      dataDriverArtifactName: checks[4][1].value as string,
      dataDriverArtifactSha256: checks[5][1].value as string,
      dataDriverArtifactSizeBytes: checks[6][1].value as number
    }
  };
}
