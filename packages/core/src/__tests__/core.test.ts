import { describe, expect, it, vi } from "vitest";
import {
  DUSK_EVM_NETWORKS,
  checkRpcHealth,
  explorerAddressUrl,
  explorerTxUrl,
  getDefaultDuskEvmNetwork,
  parseHexBlockNumber,
  redactSensitive,
  safeJsonExport,
  searchCapabilities,
  searchResources,
  searchTroubleshooting
} from "../index";

describe("DuskEVM network config", () => {
  it("loads source-labeled network metadata", () => {
    expect(DUSK_EVM_NETWORKS.length).toBeGreaterThanOrEqual(3);
    const testnet = getDefaultDuskEvmNetwork();
    expect(testnet.chainId).toBe(745);
    expect(testnet.chainIdHex).toBe("0x2e9");
    expect(testnet.enabledByDefault).toBe(true);
    expect(testnet.sourceUrl).toContain("docs.dusk.network");
  });
});

describe("RPC health", () => {
  it("returns healthy when the chain id matches", async () => {
    const fetchImpl = vi.fn(async (_url: string, request: RequestInit) => {
      const body = JSON.parse(String(request.body)) as { method: string };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: body.method === "eth_chainId" ? "0x2e9" : "0x10" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await checkRpcHealth(getDefaultDuskEvmNetwork(), fetchImpl);
    expect(result.status).toBe("healthy");
    expect(parseHexBlockNumber(result.blockNumberHex)).toBe(16);
  });

  it("detects wrong-chain responses", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ) as unknown as typeof fetch;

    const result = await checkRpcHealth(getDefaultDuskEvmNetwork(), fetchImpl);
    expect(result.status).toBe("wrong-chain");
    expect(result.actualChainIdHex).toBe("0x1");
  });
});

describe("explorer helpers", () => {
  const network = getDefaultDuskEvmNetwork();

  it("creates valid explorer links", () => {
    const address = "0x1111111111111111111111111111111111111111";
    const tx = `0x${"a".repeat(64)}`;
    expect(explorerAddressUrl(network, address)).toContain(`/address/${address}`);
    expect(explorerTxUrl(network, tx)).toContain(`/tx/${tx}`);
  });

  it("rejects malformed values", () => {
    expect(() => explorerAddressUrl(network, "0x123")).toThrow("Invalid EVM address");
    expect(() => explorerTxUrl(network, "0x123")).toThrow("Invalid transaction hash");
  });
});

describe("resource search", () => {
  it("finds funding, troubleshooting, and capability records", () => {
    expect(searchResources("bridge").some((item) => item.id === "duskevm-bridge")).toBe(true);
    expect(searchTroubleshooting("forge").some((item) => item.id === "foundry-missing")).toBe(true);
    expect(searchCapabilities("citadel").some((item) => item.id === "citadel-private-identity")).toBe(true);
    expect(searchCapabilities("hedger").some((item) => item.id === "duskevm-confidential-hedger")).toBe(true);
    expect(searchResources("Smart Contracts on DuskDS").some((item) => item.id === "duskds-smart-contracts")).toBe(true);
    expect(searchCapabilities("driver_available").some((item) => item.id === "duskds-data-drivers")).toBe(true);
    expect(searchTroubleshooting("driver_available").some((item) => item.id === "duskds-driver-unavailable-after-deploy")).toBe(true);
  });
});

describe("redaction", () => {
  it("redacts private-key-like values and secrets", () => {
    const privateKeyLike = `0x${"a".repeat(64)}`;
    const text = `private_key=${privateKeyLike} api_key=supersecret`;
    const redacted = redactSensitive(text);
    expect(redacted).not.toContain("supersecret");
    expect(redacted).toContain("[redacted]");
  });

  it("sanitizes diagnostics structurally before serializing", () => {
    const walletAddress = `0x${"b".repeat(40)}`;
    const exported = safeJsonExport({
      release: { version: "0.1.0", commit: "c".repeat(40) },
      api_key: "supersecret",
      AWS_SECRET_ACCESS_KEY: "cloud-secret",
      walletPassword: "hunter2",
      nested: {
        sessionToken: "token-value",
        description: "workspace C:\\Users\\person\\wallet",
        observedValue: walletAddress
      },
      ...JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    });
    const parsed = JSON.parse(exported) as Record<string, unknown>;

    expect(parsed.release).toEqual({ version: "0.1.0", commit: "c".repeat(40) });
    expect(parsed.api_key).toBe("[redacted]");
    expect(parsed.walletPassword).toBe("[redacted]");
    expect(exported).not.toMatch(/supersecret|cloud-secret|hunter2|token-value|person/);
    expect(exported).not.toContain(walletAddress);
    expect(exported).toContain("[redacted-local-path]");
    expect(exported).toContain("[redacted-wallet-identifier]");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("preserves web URLs while redacting Windows and UNC paths", () => {
    const urls = [
      "https://docs.dusk.network/developer/overview/",
      "http://127.0.0.1:8788/health",
      "http://[::1]:8788/health",
      "ws://127.0.0.1:8788/events",
      "//docs.dusk.network/developer/overview/",
      "wss://rpc.example/ws"
    ];
    const exported = safeJsonExport({
      urls,
      notes: [
        "path=C:\\Users\\person\\wallet",
        "unc=\\\\server\\share\\project"
      ]
    });

    for (const url of urls) expect(exported).toContain(url);
    expect(exported).toContain("path=[redacted-local-path]");
    expect(exported).toContain("unc=[redacted-local-path]");
    expect(exported).not.toMatch(/person|server|share|project/);
  });

  it("preserves web URLs containing reserved POSIX directory names", () => {
    const urls = [
      "https://example.test/Users/alice/profile",
      "https://example.test/home/alice/project",
      "http://example.test/tmp/build/output",
      "wss://example.test/var/run/socket",
      "https://example.test/private/data",
      "https://example.test/mnt/storage"
    ];
    const exported = safeJsonExport({ urls });

    expect((JSON.parse(exported) as { urls: string[] }).urls).toEqual(urls);
  });

  it("redacts local POSIX and file paths while keeping URL secrets redacted", () => {
    const walletAddress = `0x${"d".repeat(40)}`;
    const longToken = "t".repeat(96);
    const exported = safeJsonExport({
      localPaths: "home=/home/user/project cache=/tmp/build",
      filePaths: "file:///home/user/project and file:///Users/person/project",
      sensitiveUrls: [
        `https://example.test/home/${walletAddress}`,
        `https://example.test/tmp/value?token=${longToken}`,
        "wss://example.test/var/run?api_key=supersecret"
      ]
    });

    expect(exported).not.toMatch(/\/home\/user|\/tmp\/build|\/Users\/person/);
    expect(exported).not.toMatch(new RegExp(`${walletAddress}|${longToken}|supersecret`));
    expect(exported).toContain("file://[redacted-local-path]");
    expect(exported).toContain("https://example.test/home/[redacted-wallet-identifier]");
    expect(exported).toContain("https://example.test/tmp/value?token=[redacted]");
    expect(exported).toContain("wss://example.test/var/run?api_key=[redacted]");
  });

  it("redacts URL userinfo and local paths embedded in URL parameters", () => {
    const exported = safeJsonExport({
      url: "https://alice:hunter2@example.test/callback?path=C:\\Users\\alice\\wallet&next=https%3A%2F%2Fexample.test%2Fhome%2Falice#unc=\\\\server\\share\\wallet"
    });

    expect(exported).not.toMatch(/alice:hunter2|Users|server|share|wallet/);
    expect(exported).toContain("https://[redacted-url-userinfo]@example.test/callback");
    expect(exported).toContain("path=[redacted-local-path]");
    expect(exported).toContain("next=https%3A%2F%2Fexample.test%2Fhome%2Falice");
    expect(exported).toContain("unc=[redacted-local-path]");
  });

  it("redacts raw and encoded local paths or nested userinfo in URL pathnames", () => {
    const exported = safeJsonExport({
      urls: [
        "https://example.test/files/C:\\Users\\alice\\wallet",
        "https://example.test/files/\\\\server\\share\\wallet",
        "https://example.test/files/C%3A%5CUsers%5Calice%5Cwallet",
        "https://example.test/files/%5C%5Cserver%5Cshare%5Cwallet",
        "https://example.test/redirect/https://alice:hunter2@example.test/"
      ]
    });

    expect(exported).not.toMatch(/alice:hunter2|Users|server|share|wallet/);
    expect(exported.match(/\[redacted-local-path\]/g)).toHaveLength(4);
    expect(exported).toContain("https://example.test/redirect/https://[redacted-url-userinfo]@example.test/");
  });

  it("redacts double-encoded paths and nested credential URLs in parameters", () => {
    const twice = (value: string) => encodeURIComponent(encodeURIComponent(value));
    const exported = safeJsonExport({
      url: `https://example.test/callback?unc=${twice("\\\\server\\share\\wallet")}&home=${twice("/home/alice/wallet")}&next=${twice("https://alice:hunter2@example.test/")}`
    });

    expect(exported).not.toMatch(/alice:hunter2|server|share|wallet/);
    expect(exported.match(/\[redacted-local-path\]/g)).toHaveLength(2);
    expect(exported).toContain("next=https://[redacted-url-userinfo]@example.test/");
  });

  it("fails closed for malformed URL encoding in paths, queries, and fragments", () => {
    const exported = safeJsonExport({
      urls: [
        "https://example.test/files/%ZZC:\\Users\\alice\\wallet",
        "https://example.test/?x=%E0%A4%A%5C%5Cserver%5Cshare%5Cwallet",
        "https://example.test/#x=%E0%A4%Ahttps%3A%2F%2Falice%3Ahunter2%40example.test%2F"
      ]
    });

    expect(exported).not.toMatch(/alice:hunter2|Users|server|share|wallet/);
    expect(exported.match(/\[redacted-unsafe-url-component\]/g)).toHaveLength(3);
  });

  it("redacts local paths and encoded userinfo in URL authorities", () => {
    const twice = (value: string) => encodeURIComponent(encodeURIComponent(value));
    const exported = safeJsonExport({
      urls: [
        "https://C:\\Users\\alice\\wallet",
        `https://${twice("C:\\Users\\alice\\wallet")}`,
        "https://\\\\server\\share\\wallet",
        `https://${twice("\\\\server\\share\\wallet")}`,
        "https://%ZZC:\\Users\\alice\\wallet",
        "https://alice:hunter2@C:\\Users\\bob\\wallet",
        `https://${twice("alice:hunter2@example.test")}/`
      ]
    });

    expect(exported).not.toMatch(/alice:hunter2|Users|server|share|wallet|bob/);
    expect(exported.match(/\[redacted-local-path\]/g)).toHaveLength(5);
    expect(exported).toContain("https://[redacted-url-authority]");
    expect(exported).toContain("https://[redacted-url-userinfo]@example.test/");
  });

  it("fails closed when decoding introduces structural URL delimiters", () => {
    const exported = safeJsonExport({
      urls: [
        "https://example.test%3Fpassword%3Dhunter2",
        "https://example.test/path%3Fpassword%3Dhunter2",
        "https://example.test/?x=ok%26password%3Dhunter2",
        "https://example.test/#x=ok%26password%3Dhunter2",
        "https://example.test%2Fhome%2Falice%2Fwallet",
        "https://C:/Users/alice/wallet"
      ]
    });

    expect(exported).not.toMatch(/hunter2|home|Users|alice|wallet/);
    expect(exported.match(/\[redacted-url-authority\]/g)).toHaveLength(2);
    expect(exported.match(/\[redacted-unsafe-url-component\]/g)).toHaveLength(3);
    expect(exported).toContain("https://[redacted-local-path]");
  });

  it("rejects decoded authorities that are not a valid host and numeric port", () => {
    const exported = safeJsonExport({
      urls: [
        "https://example.test%40alice%3Ahunter2",
        "https://example.test%3Dpassword%3Dhunter2",
        "https://example.test%20password%3Dhunter2",
        "https://example.test%40host%3A443%3Apassword%3Dhunter2",
        "https://example.test:abc",
        "https://example.test:443:password=hunter2",
        "https://example.test%00password%3Dhunter2",
        "https://example.test%2Cpassword%3Dhunter2",
        "https://example.test%3Bpassword%3Dhunter2"
      ]
    });

    expect(exported).not.toMatch(/hunter2|alice:|password/);
    expect(exported.match(/\[redacted-url-authority\]/g)).toHaveLength(9);
  });

  it("redacts userinfo in ws and protocol-relative URLs at every nesting surface", () => {
    const exported = safeJsonExport({
      urls: [
        "ws://alice:hunter2@inner.test/path",
        "//alice:hunter2@inner.test/path",
        "https://example.test/?next=ws%3A%2F%2Falice%3Ahunter2%40inner.test%2F",
        "https://example.test/?next=%2F%2Falice%3Ahunter2%40inner.test%2F",
        "https://example.test/redirect/ws://alice:hunter2@inner.test/",
        "https://example.test/#next=%2F%2Falice%3Ahunter2%40inner.test%2F"
      ]
    });

    expect(exported).not.toMatch(/alice:hunter2/);
    expect(exported.match(/\[redacted-url-userinfo\]/g)).toHaveLength(6);
  });

  it("redacts fully encoded URLs, credentials, and local paths", () => {
    const encoded = safeJsonExport({
      values: [
        "https%3A%2F%2Falice%3Ahunter2%40example.test%2F",
        "authorization%3A%20Bearer%20hunter2",
        "C%3A%5CUsers%5Calice%5Cwallet"
      ]
    });
    const safeEncoded = "https%3A%2F%2Fexample.test%2Fhome%2Falice";

    expect(encoded).not.toMatch(/alice:hunter2|Bearer%20hunter2|Users|wallet/);
    expect(encoded).toContain("[redacted-url-userinfo]");
    expect(encoded).toContain("authorization=[redacted]");
    expect(encoded).toContain("[redacted-local-path]");
    expect(safeJsonExport({ value: safeEncoded })).toContain(safeEncoded);
  });

  it("redacts decoded header and dotted credential forms in URL components", () => {
    const exported = safeJsonExport({
      urls: [
        "https://example.test/?x=authorization%20Bearer%20hunter2",
        "https://example.test/?x=api.key%3Dhunter2",
        "https://example.test/path/api.key%3Dhunter2"
      ]
    });

    expect(exported).not.toMatch(/hunter2/);
    expect(exported).toContain("authorization=[redacted]");
    expect(exported.match(/api\.key=\[redacted\]/g)).toHaveLength(2);
  });

  it("redacts complete mnemonic values and quoted serialized credentials", () => {
    const mnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident";
    const exported = safeJsonExport({
      values: [
        `mnemonic=${mnemonic}`,
        `seed phrase: ${mnemonic}`,
        `seed_phrase: abandon ability able\nabout above absent absorb abstract absurd abuse access accident`,
        '{"password":"hunter2","status":"ready"}',
        "{'api.key':'supersecret','status':'ready'}"
      ]
    });

    expect(exported).not.toMatch(/abandon|ability|accident|hunter2|supersecret/);
    expect(exported.match(/\[redacted\]/g)).toHaveLength(5);
    expect(exported).toContain("status");
    expect(exported).toContain("ready");
  });

  it("redacts complete Windows, UNC, and POSIX paths containing spaces", () => {
    const exported = safeJsonExport({
      paths: [
        "C:\\Users\\Alice Smith\\wallet.json",
        "\\\\server\\Alice Smith\\wallet.json",
        "/home/Alice Smith/wallet.json",
        "/Users/Alice Smith/wallet.json",
        "C:\\Users\\Smith, Alice\\wallet.json",
        "/home/Smith; Alice/wallet.json"
      ]
    });

    expect(exported).not.toMatch(/Alice|Smith|wallet/);
    expect(exported.match(/\[redacted-local-path\]/g)).toHaveLength(6);
  });

  it("structurally redacts escaped keys and nested serialized JSON", () => {
    const slash = String.fromCharCode(92);
    const escapedKeyJson = `{"pass${slash}u0077ord":"hunter2","status":"ready"}`;
    const nestedJson = JSON.stringify({
      nested: JSON.stringify({ "api.key": "nested-secret", status: "ready" })
    });
    const exported = safeJsonExport({ values: [escapedKeyJson, nestedJson] });

    expect(exported).not.toMatch(/hunter2|nested-secret/);
    expect(exported.match(/\[redacted\]/g)).toHaveLength(2);
    expect(exported).toContain("ready");
  });

  it("fails closed when diagnostics exceed structural or byte bounds", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => safeJsonExport(cyclic)).toThrow(/cycle/);
    expect(() => safeJsonExport(Array.from({ length: 513 }, () => true))).toThrow(/array limit/);
    expect(() => safeJsonExport({ value: "x".repeat(8_193) })).toThrow(/oversized string/);
    const boundedText = "safe diagnostic value ".repeat(350).slice(0, 7_000);
    const byteHeavy = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`item${index}`, boundedText]));
    expect(() => safeJsonExport(byteHeavy)).toThrow(/byte limit/);
  });
});
