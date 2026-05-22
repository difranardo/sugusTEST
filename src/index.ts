import { loadConfig } from "./config";
import { readCandidates } from "./excel";
import { describeCandidate } from "./matching";
import { writeReports, summarize } from "./reporter";
import { SugusBot } from "./sugusBot";
import { ValidationResult } from "./types";

async function main(): Promise<void> {
  const config = loadConfig();
  const allCandidates = await readCandidates(config.excelPath);
  const startRow = config.startRow ?? 2;
  const candidatesFromStart = allCandidates.filter((candidate) => candidate.rowNumber >= startRow);
  const candidates = config.limit && config.limit > 0 ? candidatesFromStart.slice(0, config.limit) : candidatesFromStart;

  console.log(`Excel: ${config.excelPath}`);
  console.log(`Candidatos a validar: ${candidates.length}`);
  console.log(`Browser: ${config.browser} | headless=${config.headless} | match-mode=${config.matchMode}`);

  const bot = new SugusBot(config);
  const results: ValidationResult[] = [];

  try {
    await bot.start();
    console.log("Abriendo Sugus UAT y logueando...");
    await bot.login();
    console.log("Navegando a Candidatos > Trabajar con Candidatos...");
    await bot.openCandidatesPage();

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const prefix = `[${index + 1}/${candidates.length}] fila ${candidate.rowNumber}`;

      try {
        const result = await bot.validateCandidate(candidate);
        results.push(result);
        console.log(`${prefix} ${result.status}: ${describeCandidate(candidate)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          candidate,
          status: "ERROR",
          matched: false,
          reason: "Fallo tecnico validando esta fila.",
          foundCount: 0,
          error: message
        });
        console.log(`${prefix} ERROR: ${describeCandidate(candidate)} -> ${message}`);
      }
    }
  } finally {
    await bot.stop();
  }

  const reportPaths = writeReports(results, config.outputDir);
  const summary = summarize(results);
  const matched = summary.MATCH;
  const notMatched = results.length - matched;

  console.log("");
  console.log("Resumen:");
  console.log(`  Matchearon: ${matched}`);
  console.log(`  No matchearon: ${notMatched}`);
  console.log(`  MATCH: ${summary.MATCH}`);
  console.log(`  NOT_FOUND: ${summary.NOT_FOUND}`);
  console.log(`  NAME_MISMATCH: ${summary.NAME_MISMATCH}`);
  console.log(`  DOCUMENT_MISMATCH: ${summary.DOCUMENT_MISMATCH}`);
  console.log(`  MULTIPLE_MATCHES: ${summary.MULTIPLE_MATCHES}`);
  console.log(`  ERROR: ${summary.ERROR}`);
  console.log("");
  console.log(`CSV: ${reportPaths.csvPath}`);
  console.log(`JSON: ${reportPaths.jsonPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
