const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/0x[a-fA-F0-9]{64}/g, "[redacted-private-key-like-hex]"],
  [/\b([A-Za-z0-9+/]{80,}={0,2})\b/g, "[redacted-long-token]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-jwt]"],
  [/\bauthorization\s*(?::|=)?\s*(?:basic|bearer)\s+[^\s,;]+/gi, "authorization=[redacted]"],
  [/\b(basic|bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [redacted]"],
  [/((?:"|')?)(mnemonic|seed[\s._-]*phrase)\1\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,;}\]&]+)/gi, "$1$2$1=[redacted]"],
  [/((?:"|')?)(private[\s._-]*key|mnemonic|seeder|seed[\s._-]*phrase|api[\s._-]*key|secret|password|passwd|authorization|auth[\s._-]*token|access[\s._-]*(?:token|key(?:[\s._-]*id)?)|refresh[\s._-]*token|session[\s._-]*token|token|cookie|credentials?)\1\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;}\]&]+)/gi, "$1$2$1=[redacted]"]
];

const WINDOWS_LOCAL_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/(^|[^A-Za-z0-9+.-])(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>|?*]+/g, "$1[redacted-local-path]"]
];

const POSIX_LOCAL_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/\/(?:Users|home|tmp|var|private|mnt)\/[^\r\n"']+/g, "[redacted-local-path]"]
];

const LOCAL_PATH_PATTERNS = [...WINDOWS_LOCAL_PATH_PATTERNS, ...POSIX_LOCAL_PATH_PATTERNS];

const WALLET_IDENTIFIER_PATTERNS: Array<[RegExp, string]> = [
  [/\b0x[a-fA-F0-9]{40}\b/g, "[redacted-wallet-identifier]"]
];

const SENSITIVE_KEYS = new Set([
  "apikey", "authorization", "authtoken", "cookie", "credential", "credentials", "key",
  "mnemonic", "password", "passwd", "privatekey", "secret", "seed", "seeder", "seedphrase",
  "token", "walletaddress", "accountaddress", "localpath", "filepath"
]);

const EXPORT_LIMITS = Object.freeze({
  maxDepth: 12,
  maxNodes: 4_096,
  maxObjectKeys: 256,
  maxArrayItems: 512,
  maxStringCharacters: 8_192,
  maxBytes: 128 * 1_024
});

const MAX_EMBEDDED_JSON_DEPTH = 3;

interface ExportState {
  nodes: number;
  ancestors: WeakSet<object>;
}

type SafeJsonValue = null | boolean | number | string | SafeJsonValue[] | { [key: string]: SafeJsonValue };

function normalizedKey(value: string): string {
  return value.normalize("NFKC").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(value: string): boolean {
  const normalized = normalizedKey(value);
  return SENSITIVE_KEYS.has(normalized)
    || /(?:apikey|auth(?:orization|token)|accesstoken|refreshtoken|sessiontoken|password|passwd|privatekey|mnemonic|seedphrase|credential|cookie|secret)/.test(normalized)
    || /(?:accesskey|address|account|balance|identifier|key|token)$/.test(normalized);
}

function redactLocalPathText(input: string): string {
  return LOCAL_PATH_PATTERNS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    input
  );
}

function redactWindowsLocalPathText(input: string): string {
  return WINDOWS_LOCAL_PATH_PATTERNS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    input
  );
}

function decodeUrlComponentOnce(value: string): { invalid: boolean; value: string } {
  try {
    return { invalid: false, value: decodeURIComponent(value) };
  } catch {
    return { invalid: true, value };
  }
}

function decodeUrlComponent(value: string, plusAsSpace: boolean): { complete: boolean; value: string } {
  let decoded = plusAsSpace ? value.replace(/\+/g, " ") : value;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decodeUrlComponentOnce(decoded);
    if (next.invalid) return { complete: false, value: decoded };
    if (next.value === decoded) return { complete: true, value: decoded };
    decoded = next.value;
  }
  const next = decodeUrlComponentOnce(decoded);
  return { complete: !next.invalid && next.value === decoded, value: decoded };
}

function redactUrlComponent(value: string, depth: number, forbiddenDecodedDelimiters = /[&;#]/): string {
  const decoded = decodeUrlComponent(value, true);
  if (!decoded.complete || forbiddenDecodedDelimiters.test(decoded.value)) {
    return "[redacted-unsafe-url-component]";
  }
  const redacted = redactWalletIdentifiers(
    redactLocalPaths(redactSensitive(decoded.value), depth + 1)
  );
  return redacted === decoded.value ? value : redacted;
}

function redactUrlParameters(value: string, depth: number): string {
  return value.split(/([&;])/).map((segment) => {
    if (segment === "&" || segment === ";" || segment.length === 0) return segment;
    const equalsIndex = segment.indexOf("=");
    if (equalsIndex < 0) return redactUrlComponent(segment, depth);

    const key = segment.slice(0, equalsIndex);
    const component = segment.slice(equalsIndex + 1);
    const decodedKey = decodeUrlComponent(key, true);
    if (!decodedKey.complete || /[&;#=]/.test(decodedKey.value)) return "[redacted-url-parameter]";
    const safeKey = redactUrlComponent(key, depth, /[&;#=]/);
    const redactedComponent = redactUrlComponent(component, depth);
    const isCompleteRedaction = /^\[redacted(?:-[a-z-]+)?\]$/i.test(redactedComponent);
    return isSensitiveKey(decodedKey.value) && !isCompleteRedaction
      ? `${safeKey}=[redacted]`
      : `${safeKey}=${redactedComponent}`;
  }).join("");
}

function redactTextPreservingUrls(
  input: string,
  redactNonUrlText: (value: string) => string,
  depth: number
): string {
  if (depth > 4) return "[redacted-nested-url-data]";
  const webUrlPattern = /(?:\b(?:https?|wss?):\/\/|(?<![:/])\/\/)[^\s"'<>]+/gi;
  let cursor = 0;
  let output = "";

  for (const match of input.matchAll(webUrlPattern)) {
    const index = match.index;
    output += redactNonUrlText(input.slice(cursor, index));
    output += redactWebUrl(match[0], depth);
    cursor = index + match[0].length;
  }

  return output + redactNonUrlText(input.slice(cursor));
}

function redactUrlPath(value: string, depth: number): string {
  const decoded = decodeUrlComponent(value, false);
  if (!decoded.complete || /[?#]/.test(decoded.value)) return "[redacted-unsafe-url-component]";
  const redacted = redactWalletIdentifiers(
    redactTextPreservingUrls(redactSensitive(decoded.value), redactWindowsLocalPathText, depth + 1)
  );
  return redacted === decoded.value ? value : redacted;
}

function isValidUrlHostPort(value: string): boolean {
  const containsControl = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (containsControl || /[\s,;=]/u.test(value)) return false;

  let rawHostname: string;
  let rawPort: string | undefined;
  if (value.startsWith("[")) {
    const match = /^(\[[^\]]+\])(?::(\d{1,5}))?$/.exec(value);
    if (!match) return false;
    [, rawHostname, rawPort] = match;
  } else {
    const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(value);
    if (!match) return false;
    [, rawHostname, rawPort] = match;
  }

  if (rawPort !== undefined && Number(rawPort) > 65_535) return false;

  try {
    const parsed = new URL(`https://${value}/`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    if (rawHostname.startsWith("[")) return /^\[[a-fA-F0-9:.%]+\]$/.test(parsed.hostname);

    const hostname = parsed.hostname.endsWith(".") ? parsed.hostname.slice(0, -1) : parsed.hostname;
    if (hostname.length === 0 || hostname.length > 253) return false;
    return hostname.split(".").every((label) =>
      label.length > 0
      && label.length <= 63
      && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
    );
  } catch {
    return false;
  }
}

function redactUrlAuthority(value: string): { decodedHost: string; safe: string; usable: boolean } {
  const decoded = decodeUrlComponent(value, false);
  if (!decoded.complete) {
    return { decodedHost: "", safe: "[redacted-url-authority]", usable: false };
  }
  const userInfoEnd = decoded.value.lastIndexOf("@");
  const host = userInfoEnd < 0 ? decoded.value : decoded.value.slice(userInfoEnd + 1);
  const safeHost = redactWindowsLocalPathText(host);
  if (safeHost !== host || /^[A-Za-z]:$/.test(host)) {
    const safe = userInfoEnd < 0
      ? "[redacted-local-path]"
      : "[redacted-url-userinfo]@[redacted-local-path]";
    return { decodedHost: host, safe, usable: true };
  }
  if (!isValidUrlHostPort(host)) {
    return { decodedHost: host, safe: "[redacted-url-authority]", usable: false };
  }
  const redacted = userInfoEnd < 0
    ? safeHost
    : `[redacted-url-userinfo]@${safeHost}`;
  return {
    decodedHost: host,
    safe: redacted === decoded.value ? value : redacted,
    usable: true
  };
}

function redactWebUrl(value: string, depth: number): string {
  const schemeEnd = value.indexOf("://") + 3;
  const authorityEndCandidate = value.slice(schemeEnd).search(/[/?#]/);
  const authorityEnd = authorityEndCandidate < 0 ? value.length : schemeEnd + authorityEndCandidate;
  const authority = value.slice(schemeEnd, authorityEnd);
  const authorityResult = redactUrlAuthority(authority);
  const remainder = value.slice(authorityEnd);
  if (!authorityResult.usable) {
    return `${value.slice(0, schemeEnd)}${authorityResult.safe}`;
  }
  if (
    /^[A-Za-z]:$/.test(authorityResult.decodedHost)
    || redactWindowsLocalPathText(authorityResult.decodedHost) !== authorityResult.decodedHost
  ) {
    return `${value.slice(0, schemeEnd)}${authorityResult.safe}`;
  }
  const safeAuthority = authorityResult.safe;
  const queryIndex = remainder.indexOf("?");
  const fragmentIndex = remainder.indexOf("#");
  const suffixIndex = queryIndex < 0
    ? fragmentIndex
    : fragmentIndex < 0 ? queryIndex : Math.min(queryIndex, fragmentIndex);

  if (suffixIndex < 0) {
    return `${value.slice(0, schemeEnd)}${safeAuthority}${redactUrlPath(remainder, depth)}`;
  }

  const path = redactUrlPath(remainder.slice(0, suffixIndex), depth);
  let suffix = remainder.slice(suffixIndex);
  if (suffix.startsWith("?")) {
    const hashIndex = suffix.indexOf("#");
    const query = hashIndex < 0 ? suffix.slice(1) : suffix.slice(1, hashIndex);
    const fragment = hashIndex < 0 ? "" : suffix.slice(hashIndex + 1);
    suffix = `?${redactUrlParameters(query, depth)}`
      + (hashIndex < 0 ? "" : `#${redactUrlParameters(fragment, depth)}`);
  } else {
    suffix = `#${redactUrlParameters(suffix.slice(1), depth)}`;
  }

  return `${value.slice(0, schemeEnd)}${safeAuthority}${path}${suffix}`;
}

function redactLocalPaths(input: string, depth = 0): string {
  return redactTextPreservingUrls(input, redactLocalPathText, depth);
}

function redactWalletIdentifiers(input: string): string {
  return WALLET_IDENTIFIER_PATTERNS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    input
  );
}

function redactEmbeddedJson(input: string, embeddedJsonDepth: number): string | undefined {
  if (embeddedJsonDepth >= MAX_EMBEDDED_JSON_DEPTH) return undefined;
  const trimmed = input.trim();
  const couldBeJson = (trimmed.startsWith("{") && trimmed.endsWith("}"))
    || (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!couldBeJson) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  const sanitized = sanitizeExportValue(
    parsed,
    { nodes: 0, ancestors: new WeakSet<object>() },
    0,
    embeddedJsonDepth + 1
  );
  const canonicalInput = JSON.stringify(parsed);
  const canonicalSanitized = JSON.stringify(sanitized);
  return canonicalSanitized === canonicalInput ? undefined : canonicalSanitized;
}

function redactExportString(input: string, embeddedJsonDepth = 0): string {
  if (input.length > EXPORT_LIMITS.maxStringCharacters) throw new Error("Diagnostics export contains an oversized string.");
  const sanitize = (value: string) => {
    const embeddedJson = redactEmbeddedJson(value, embeddedJsonDepth);
    return embeddedJson ?? redactWalletIdentifiers(redactLocalPaths(redactSensitive(value)));
  };
  const sanitized = sanitize(input);
  const decoded = decodeUrlComponent(sanitized, false);
  if (!decoded.complete) {
    return /%[a-fA-F0-9]{2}/.test(sanitized) ? "[redacted-unsafe-encoded-data]" : sanitized;
  }
  if (decoded.value === sanitized) return sanitized;
  const sanitizedDecoded = sanitize(decoded.value);
  return sanitizedDecoded === decoded.value ? sanitized : sanitizedDecoded;
}

function sanitizeExportValue(
  value: unknown,
  state: ExportState,
  depth: number,
  embeddedJsonDepth = 0
): SafeJsonValue {
  if (depth > EXPORT_LIMITS.maxDepth) throw new Error("Diagnostics export exceeded its depth limit.");
  state.nodes += 1;
  if (state.nodes > EXPORT_LIMITS.maxNodes) throw new Error("Diagnostics export exceeded its node limit.");

  if (value === null) return null;
  if (typeof value === "string") return redactExportString(value, embeddedJsonDepth);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") throw new Error("Diagnostics export contains an unsupported value.");
  if (state.ancestors.has(value)) throw new Error("Diagnostics export contains a cycle.");

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > EXPORT_LIMITS.maxArrayItems) throw new Error("Diagnostics export exceeded its array limit.");
      return value.map((item) => sanitizeExportValue(item, state, depth + 1, embeddedJsonDepth));
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("Diagnostics export contains an unsupported object.");
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > EXPORT_LIMITS.maxObjectKeys) throw new Error("Diagnostics export exceeded its object-key limit.");
    const sanitized = Object.create(null) as Record<string, SafeJsonValue>;
    for (const [key, item] of entries) {
      sanitized[key] = isSensitiveKey(key)
        ? "[redacted]"
        : sanitizeExportValue(item, state, depth + 1, embeddedJsonDepth);
    }
    return sanitized;
  } finally {
    state.ancestors.delete(value);
  }
}

export function redactSensitive(input: string): string {
  return SECRET_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), input);
}

export function safeJsonExport(value: unknown): string {
  const sanitized = sanitizeExportValue(value, { nodes: 0, ancestors: new WeakSet<object>() }, 0);
  const output = JSON.stringify(sanitized, null, 2);
  if (new TextEncoder().encode(output).byteLength > EXPORT_LIMITS.maxBytes) {
    throw new Error("Diagnostics export exceeded its byte limit.");
  }
  return output;
}
