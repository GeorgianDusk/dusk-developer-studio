const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/0x[a-fA-F0-9]{64}/g, "[redacted-private-key-like-hex]"],
  [/\b([A-Za-z0-9+/]{80,}={0,2})\b/g, "[redacted-long-token]"],
  [/(private[_-]?key|mnemonic|seeder|seed phrase|api[_-]?key|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]"]
];

export function redactSensitive(input: string): string {
  return SECRET_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), input);
}

export function safeJsonExport(value: unknown): string {
  return redactSensitive(JSON.stringify(value, null, 2));
}
