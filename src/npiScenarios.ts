import assert from "node:assert/strict";
import { WebDriver } from "selenium-webdriver";
import { NpiBotConfig } from "./npiConfig";
import { ModificacionMasivaNpiPage } from "./npiPage";
import { screenshot } from "./npiUtils";

export type NpiScenarioStatus = "PASSED" | "FAILED" | "SKIPPED";

export interface NpiScenarioResult {
  name: string;
  status: NpiScenarioStatus;
  durationMs: number;
  detail?: string;
  screenshot?: string;
}

export class Payroll2962Scenarios {
  private readonly page: ModificacionMasivaNpiPage;

  constructor(private readonly driver: WebDriver, private readonly config: NpiBotConfig) {
    this.page = new ModificacionMasivaNpiPage(driver, config);
  }

  async run(): Promise<NpiScenarioResult[]> {
    const results: NpiScenarioResult[] = [];
    results.push(await this.execute("Buscar y seleccionar NPI", async () => {
      const npis = await this.searchAndSelect();
      return `NPIs visibles: ${npis.join(", ")}`;
    }));
    results.push(await this.execute("Seleccionar todas las filas visibles", async () => {
      const npis = await this.page.search(this.searchOptions());
      assert.ok(npis.length > 0, "No hay filas para seleccionar");
      return `${await this.page.selectAllVisibleRows()} fila(s) seleccionada(s)`;
    }));
    results.push(await this.execute("Condición de Pago habilitada y persistente", async () => {
      await this.searchAndSelect();
      await this.page.assertConditionPaymentEnabled();
      await this.page.selectConditionPayment(this.config.conditionPayment);
      const before = await this.page.getConditionPayment();
      await this.page.fillObservation(`${this.config.observation} ${new Date().toISOString()}`.slice(0, 500));
      assert.equal(await this.page.getConditionPayment(), before, "Condición de Pago se perdió al completar otro bloque");
      return `Condición conservada: ${before}`;
    }));
    results.push(await this.execute("Un cambio no altera otros campos visibles", async () => {
      await this.searchAndSelect();
      const before = await this.page.snapshotVisibleEditableFields();
      await this.page.selectConditionPayment(this.config.conditionPayment);
      this.page.assertOnlyFieldsChanged(before, await this.page.snapshotVisibleEditableFields(), ["vFORMADEPAGO"]);
    }));
    results.push(await this.execute("Monto fijo conserva 0,01 en la UI", async () => {
      await this.searchAndSelect();
      await this.page.setFixedBilling(true);
      await this.page.fillFixedAmount("0,01");
      assert.equal(await this.page.getFixedAmountNumber(), 0.01);
    }));

    if (this.config.forbiddenActiveIds.length === 0) {
      results.push(this.skipped("Filtro Activas excluye NPIs inactivas conocidas", "Definí NPI_FORBIDDEN_ACTIVE_IDS para validar contra datos conocidos."));
    } else {
      results.push(await this.execute("Filtro Activas excluye NPIs inactivas conocidas", async () => {
        const npis = await this.page.search({ state: "A" });
        const forbidden = npis.filter((npi) => this.config.forbiddenActiveIds.includes(npi));
        assert.deepEqual(forbidden, [], `El filtro Activas devolvió NPIs prohibidas: ${forbidden.join(", ")}`);
      }));
    }

    if (!this.config.allowWrite || !this.config.npiNumber || !this.config.groupSubgroupValue || !this.config.categoryText) {
      results.push(this.skipped(
        "Validación de piso salarial al confirmar",
        "Requiere SUGUS_ALLOW_WRITE=true, NPI_TEST_NUMBER, NPI_GROUP_SUBGROUP_VALUE y NPI_CATEGORY_TEXT sobre una NPI descartable."
      ));
    } else {
      results.push(await this.execute("Validación de piso salarial al confirmar", async () => {
        await this.searchAndSelect();
        await this.page.selectGroupSubgroup(this.config.groupSubgroupValue!);
        await this.page.selectCategoryByText(this.config.categoryText!);
        const base = await this.page.getBaseMonthlySalary();
        const invalid = Math.max(0, base - this.config.salaryDecrement);
        assert.ok(invalid < base, "No se pudo construir un sueldo inferior al piso");
        await this.page.fillEffectiveMonthlySalary(invalid);
        await this.page.confirmAndAccept();
        const message = await this.page.waitForMessageContaining("remuneración mensual no puede ser menor");
        return `Piso ${base}; efectivo rechazado ${invalid}. Mensaje: ${message}`;
      }));
    }

    if (!this.config.allowWrite || !this.config.runFixedAmountSave) {
      results.push(this.skipped(
        "Confirmación de facturación a monto fijo",
        "Para intentar el guardado usar SUGUS_ALLOW_WRITE=true y NPI_RUN_FIXED_AMOUNT_SAVE=true sobre una NPI descartable."
      ));
    } else {
      results.push(await this.execute("Confirmación de facturación a monto fijo", async () => {
        await this.searchAndSelect();
        await this.page.setFixedBilling(true);
        await this.page.fillFixedAmount("0,01");
        await this.page.confirmAndAccept();
        return "La pantalla aceptó el guardado; la persistencia en BD queda fuera de esta validación UI.";
      }));
    }
    return results;
  }

  private searchOptions(): { state: "" | "A" | "I"; npiFrom?: string; npiTo?: string } {
    return { state: this.config.state, npiFrom: this.config.npiNumber, npiTo: this.config.npiNumber };
  }

  private async searchAndSelect(): Promise<string[]> {
    const npis = await this.page.search(this.searchOptions());
    await this.page.selectNpi(this.config.npiNumber);
    return npis;
  }

  private skipped(name: string, detail: string): NpiScenarioResult {
    return { name, status: "SKIPPED", durationMs: 0, detail };
  }

  private async execute(name: string, fn: () => Promise<string | void>): Promise<NpiScenarioResult> {
    const startedAt = Date.now();
    try {
      await this.driver.navigate().refresh();
      const detail = await fn();
      const result: NpiScenarioResult = { name, status: "PASSED", durationMs: Date.now() - startedAt, detail: detail || undefined };
      if (this.config.screenshotOnPass) {
        result.screenshot = await screenshot(this.driver, this.config.outputDir, `${Date.now()}-${name}-passed.png`);
      }
      return result;
    } catch (error) {
      let image: string | undefined;
      try {
        image = await screenshot(this.driver, this.config.outputDir, `${Date.now()}-${name}-failed.png`);
      } catch {
        image = undefined;
      }
      return {
        name,
        status: "FAILED",
        durationMs: Date.now() - startedAt,
        detail: error instanceof Error ? error.stack ?? error.message : String(error),
        screenshot: image
      };
    }
  }
}
