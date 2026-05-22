export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeHeader(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function normalizeDocument(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function joinParts(parts: Array<unknown>): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function tokens(value: unknown): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

export function containsAllTokens(expected: unknown, actual: unknown): boolean {
  const expectedTokens = tokens(expected);
  const actualTokens = new Set(tokens(actual));
  return expectedTokens.length > 0 && expectedTokens.every((token) => actualTokens.has(token));
}

