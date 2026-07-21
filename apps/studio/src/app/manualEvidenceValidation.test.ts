import { describe, expect, it } from "vitest";
import { validateBlockObservation, validateBuildArtifacts, validateDriverObservation, validateRevision } from "./manualEvidenceValidation";

describe("manual evidence validation", () => {
  it("accepts a bounded block observation without arbitrary terminal output", () => {
    expect(validateBlockObservation("123", `0x${"A".repeat(64)}`).value).toEqual({
      source: "manual-confirmation",
      tool: "w3sper",
      blockHeight: 123,
      blockHash: `0x${"a".repeat(64)}`,
      endpoint: "https://testnet.nodes.dusk.network"
    });
    expect(validateBlockObservation("-1", "secret")).toMatchObject({ field: "height", error: expect.stringMatching(/block height/i) });
    expect(validateBlockObservation("1", "secret")).toMatchObject({ field: "hash", error: expect.stringMatching(/block hash/i) });
  });

  it("accepts only full Git object identities", () => {
    expect(validateRevision("A".repeat(40)).value).toBe("a".repeat(40));
    expect(validateRevision("B".repeat(64)).value).toBe("b".repeat(64));
    expect(validateRevision("ABCDEF1")).toMatchObject({ field: "revision", error: expect.stringMatching(/full 40- or 64-character/i) });
    expect(validateRevision("C:\\Users\\person\\project")).toMatchObject({ field: "revision", error: expect.stringMatching(/Git tree or commit ID/i) });
  });

  it("binds driver observations to a contract, function, endpoint, and response digest", () => {
    const availability = validateDriverObservation("availability", {
      contractId: `0x${"A".repeat(64)}`,
      functionName: "",
      responseSha256: "D".repeat(64)
    });
    expect(availability.value).toMatchObject({
      contractId: "a".repeat(64),
      responseSha256: "d".repeat(64)
    });
    expect(availability.value).not.toHaveProperty("functionName");
    const result = validateDriverObservation("encode", {
      contractId: `0x${"A".repeat(64)}`,
      functionName: "increment_by",
      responseSha256: "B".repeat(64)
    });
    expect(result.value).toEqual({
      source: "manual-confirmation",
      tool: "rpc",
      endpoint: "https://testnet.nodes.dusk.network",
      contractId: "a".repeat(64),
      functionName: "increment_by",
      responseSha256: "b".repeat(64)
    });
    expect(validateDriverObservation("schema", {
      contractId: "../secret",
      functionName: "",
      responseSha256: "b".repeat(64)
    })).toMatchObject({ field: "contractId", error: expect.stringMatching(/contract ID/i) });
    expect(validateDriverObservation("decode", {
      contractId: "a".repeat(64),
      functionName: "bad-name",
      responseSha256: "b".repeat(64)
    })).toMatchObject({ field: "functionName", error: expect.stringMatching(/function name/i) });
  });

  it("captures only safe artifact basenames, hashes, and sizes", () => {
    const result = validateBuildArtifacts({
      revision: "a".repeat(40),
      contractName: "counter_contract.wasm",
      contractSha256: "b".repeat(64),
      contractSize: "4200",
      dataDriverName: "counter_driver.wasm",
      dataDriverSha256: "c".repeat(64),
      dataDriverSize: "8200"
    });
    expect(result.value).toMatchObject({
      revision: "a".repeat(40),
      contractArtifactName: "counter_contract.wasm",
      dataDriverArtifactName: "counter_driver.wasm"
    });
    expect(validateBuildArtifacts({
      revision: "a".repeat(40),
      contractName: "../secret.wasm",
      contractSha256: "b".repeat(64),
      contractSize: "4200",
      dataDriverName: "counter_driver.wasm",
      dataDriverSha256: "c".repeat(64),
      dataDriverSize: "8200"
    })).toMatchObject({ field: "contractName", error: expect.stringMatching(/without folders/i) });
  });
});
