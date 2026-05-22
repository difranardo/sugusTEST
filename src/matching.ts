import { Candidate, MatchMode, SugusGridRow } from "./types";
import { containsAllTokens, normalizeDocument } from "./normalize";

export function candidateNameMatches(candidate: Candidate, row: SugusGridRow, mode: MatchMode): boolean {
  const expectedFirstNames = mode === "primary" ? candidate.firstName : candidate.expectedFirstNames;
  const expectedLastNames = mode === "primary" ? candidate.firstSurname : candidate.expectedLastNames;
  return containsAllTokens(expectedFirstNames, row.firstNames) && containsAllTokens(expectedLastNames, row.lastNames);
}

export function candidateDocumentMatches(candidate: Candidate, row: SugusGridRow): boolean {
  if (!candidate.document) {
    return false;
  }
  return candidate.document === normalizeDocument(row.document);
}

export function describeCandidate(candidate: Candidate): string {
  const document = candidate.document ? ` doc ${candidate.document}` : " sin doc";
  return `${candidate.expectedLastNames}, ${candidate.expectedFirstNames}${document}`;
}

