import type { EvidenceMetadata } from "./journeyProgress";
import { DUSKDS_TESTNET_NODE } from "./manualJourneyConfig";

export interface ValidationResult<T> {
  value?: T;
  error?: string;
}

export function validateBlockObservation(heightInput: string, hashInput: string): ValidationResult<EvidenceMetadata> {
  const height = Number(heightInput.trim());
  if (!/^\d+$/.test(heightInput.trim()) || !Number.isSafeInteger(height) || height < 0) {
    return { error: "Enter the non-negative block height you observed." };
  }
  const hash = hashInput.trim().toLowerCase();
  if (!/^(?:0x)?[a-f0-9]{64}$/.test(hash)) {
    return { error: "Enter a 32-byte block hash as 64 hexadecimal characters, with or without 0x." };
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

export function validateRevision(input: string): ValidationResult<string> {
  const revision = input.trim().toLowerCase();
  return /^[a-f0-9]{7,64}$/.test(revision)
    ? { value: revision }
    : { error: "Enter the 7-64 character Git tree or commit ID printed by the Build command." };
}

export type DriverObservationKind = "schema" | "encode" | "decode";

export function validateDriverObservation(
  kind: DriverObservationKind,
  input: { contractId: string; functionName: string; responseSha256: string }
): ValidationResult<EvidenceMetadata> {
  const contractId = input.contractId.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(contractId)) {
    return { error: "Enter the deployed 32-byte contract ID as 64 hexadecimal characters." };
  }
  const functionName = input.functionName.trim();
  if (kind !== "schema" && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(functionName)) {
    return { error: "Enter the exact contract function name used for this encode or decode check." };
  }
  const responseSha256 = input.responseSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(responseSha256)) {
    return { error: "Enter the SHA-256 of the exact response body as 64 hexadecimal characters." };
  }
  return {
    value: {
      source: "manual-confirmation",
      tool: "rpc",
      endpoint: DUSKDS_TESTNET_NODE,
      contractId,
      ...(kind === "schema" ? {} : { functionName }),
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

export function validateBuildArtifacts(input: {
  revision: string;
  contractName: string;
  contractSha256: string;
  contractSize: string;
  dataDriverName: string;
  dataDriverSha256: string;
  dataDriverSize: string;
}): ValidationResult<EvidenceMetadata> {
  const checks = [
    validateRevision(input.revision),
    validateArtifactName(input.contractName, "Contract artifact"),
    validateSha256(input.contractSha256, "Contract artifact"),
    validateSize(input.contractSize, "Contract artifact"),
    validateArtifactName(input.dataDriverName, "Data-driver artifact"),
    validateSha256(input.dataDriverSha256, "Data-driver artifact"),
    validateSize(input.dataDriverSize, "Data-driver artifact")
  ] as const;
  const failed = checks.find((result) => result.error);
  if (failed?.error) return { error: failed.error };
  return {
    value: {
      source: "manual-confirmation",
      revision: checks[0].value as string,
      contractArtifactName: checks[1].value as string,
      contractArtifactSha256: checks[2].value as string,
      contractArtifactSizeBytes: checks[3].value as number,
      dataDriverArtifactName: checks[4].value as string,
      dataDriverArtifactSha256: checks[5].value as string,
      dataDriverArtifactSizeBytes: checks[6].value as number
    }
  };
}
