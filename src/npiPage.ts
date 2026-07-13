import assert from "node:assert/strict";
import { By, Key, WebDriver } from "selenium-webdriver";
import { NpiBotConfig } from "./npiConfig";
import { clickWithJsFallback, normalizeText, parseLocalizedDecimal, sleep, waitEnabled, waitVisible } from "./npiUtils";

export interface NpiSearchOptions {
  state?: "" | "A" | "I";
  npiFrom?: string;
  npiTo?: string;
}

export interface NpiUiSnapshot {
  [id: string]: string;
}

export class ModificacionMasivaNpiPage {
  private readonly selectors = {
    searchButton: By.id("BUSCAR"),
    state: By.id("vESTADO"),
    npiFrom: By.id("vNPINRODES"),
    npiTo: By.id("vNPINROHAS"),
    noResults: By.id("I_NORESULTSFOUNDTEXTBLOCK_GRIDNPI"),
    selectAllGrid: By.id("vCHECKALL_GRIDNPI"),
    conditionPayment: By.id("vFORMADEPAGO"),
    fixedBilling: By.id("vFACTURMONTOFIJO"),
    fixedAmount: By.id("vIMPORTEFACTURACION"),
    observation: By.id("vCONVOBS"),
    effectiveMonthlySalary: By.id("vREMMEN"),
    baseMonthlySalary: By.id("span_vREMUNERACIONMES"),
    groupSubgroup: By.id("vCONVENIO1"),
    confirm: By.id("CONFIRMAR"),
    cancel: By.id("CANCELAR"),
    confirmDialogOk: By.css(".K2BT_ConfirmDialogOk"),
    errorViewer: By.css(".ErrorViewer")
  } as const;

  constructor(private readonly driver: WebDriver, private readonly config: NpiBotConfig) {}

  async search(options: NpiSearchOptions): Promise<string[]> {
    const state = await waitEnabled(this.driver, this.selectors.state, this.config.timeoutMs);
    await state.findElement(By.css(`option[value="${options.state ?? ""}"]`));
    await this.driver.executeScript(
      "arguments[0].value=arguments[1]; arguments[0].dispatchEvent(new Event('change',{bubbles:true}));",
      state,
      options.state ?? ""
    );
    if (options.npiFrom !== undefined) await this.replaceInput(this.selectors.npiFrom, options.npiFrom);
    if (options.npiTo !== undefined) await this.replaceInput(this.selectors.npiTo, options.npiTo);

    await clickWithJsFallback(
      this.driver,
      await waitEnabled(this.driver, this.selectors.searchButton, this.config.timeoutMs)
    );
    await sleep(this.config.afterClickPauseMs);
    await this.driver.wait(async () => {
      if ((await this.driver.findElements(By.css("#GridnpiContainerTbl tbody tr"))).length > 0) return true;
      for (const element of await this.driver.findElements(this.selectors.noResults)) {
        if (await element.isDisplayed()) return true;
      }
      return false;
    }, this.config.pageTimeoutMs);
    return this.getVisibleNpis();
  }

  async getVisibleNpis(): Promise<string[]> {
    const values: string[] = [];
    for (const element of await this.driver.findElements(By.css('[id^="span_vNPINRO_"]'))) {
      if (await element.isDisplayed()) values.push((await element.getText()).trim());
    }
    return values;
  }

  async selectNpi(npi?: string): Promise<string> {
    const npis = await this.getVisibleNpis();
    assert.ok(npis.length > 0, "La búsqueda no devolvió NPIs seleccionables");
    const target = npi ?? npis[0];
    const escapedTarget = target.replace(/'/g, "',\"'\",'");
    const literal = target.includes("'") ? `concat('${escapedTarget}')` : `'${target}'`;
    const npiSpan = await waitVisible(
      this.driver,
      By.xpath(`//span[starts-with(@id,'span_vNPINRO_') and normalize-space(.)=${literal}]`),
      this.config.timeoutMs
    );
    const row = await npiSpan.findElement(By.xpath("ancestor::tr[1]"));
    const checkbox = await row.findElement(By.css('input[id^="vMULTIROWITEMSELECTED_GRIDNPI_"]'));
    if (!(await checkbox.isSelected())) await clickWithJsFallback(this.driver, checkbox);
    assert.equal(await checkbox.isSelected(), true, `No se pudo seleccionar la NPI ${target}`);
    return target;
  }

  async selectAllVisibleRows(): Promise<number> {
    const checkboxes = await this.driver.findElements(By.css('input[id^="vMULTIROWITEMSELECTED_GRIDNPI_"]'));
    assert.ok(checkboxes.length > 0, "No hay filas para seleccionar");
    const header = await waitVisible(this.driver, this.selectors.selectAllGrid, this.config.timeoutMs);
    if (!(await header.isSelected())) {
      await clickWithJsFallback(this.driver, header);
      await sleep(500);
    }
    for (const checkbox of checkboxes) {
      if (!(await checkbox.isSelected())) await clickWithJsFallback(this.driver, checkbox);
    }
    const selected = await Promise.all(checkboxes.map((checkbox) => checkbox.isSelected()));
    assert.ok(selected.every(Boolean), "No quedaron seleccionadas todas las filas visibles");
    return selected.length;
  }

  async assertConditionPaymentEnabled(): Promise<void> {
    const control = await waitVisible(this.driver, this.selectors.conditionPayment, this.config.timeoutMs);
    assert.equal(await control.isEnabled(), true, "Condición de Pago está bloqueada");
  }

  async selectConditionPayment(value: string): Promise<void> {
    const control = await waitEnabled(this.driver, this.selectors.conditionPayment, this.config.timeoutMs);
    await control.findElement(By.css(`option[value="${value}"]`));
    await this.driver.executeScript(
      "arguments[0].value=arguments[1]; arguments[0].dispatchEvent(new Event('change',{bubbles:true}));",
      control,
      value
    );
    assert.equal(await control.getAttribute("value"), value);
  }

  async getConditionPayment(): Promise<string> {
    return (await this.driver.findElement(this.selectors.conditionPayment).getAttribute("value")) ?? "";
  }

  async fillObservation(value: string): Promise<void> {
    await this.replaceInput(this.selectors.observation, value);
  }

  async setFixedBilling(enabled: boolean): Promise<void> {
    const checkbox = await waitEnabled(this.driver, this.selectors.fixedBilling, this.config.timeoutMs);
    if ((await checkbox.isSelected()) !== enabled) await clickWithJsFallback(this.driver, checkbox);
    assert.equal(await checkbox.isSelected(), enabled);
  }

  async fillFixedAmount(value: string): Promise<void> {
    await this.replaceInput(this.selectors.fixedAmount, value);
    await this.driver.findElement(this.selectors.fixedAmount).sendKeys(Key.TAB);
    await sleep(300);
  }

  async getFixedAmountNumber(): Promise<number> {
    return parseLocalizedDecimal((await this.driver.findElement(this.selectors.fixedAmount).getAttribute("value")) ?? "");
  }

  async selectGroupSubgroup(value: string): Promise<void> {
    const control = await waitEnabled(this.driver, this.selectors.groupSubgroup, this.config.timeoutMs);
    await control.findElement(By.css(`option[value^="${value}"]`));
    await this.driver.executeScript(
      "arguments[0].value=Array.from(arguments[0].options).find(o=>o.value.trim()===arguments[1])?.value||arguments[1]; arguments[0].dispatchEvent(new Event('change',{bubbles:true})); arguments[0].dispatchEvent(new Event('blur',{bubbles:true}));",
      control,
      value.trim()
    );
    await sleep(this.config.waitMs);
  }

  async selectCategoryByText(text: string): Promise<void> {
    const container = await waitVisible(this.driver, By.id("CATEGORIA1Container"), this.config.timeoutMs);
    await clickWithJsFallback(this.driver, await container.findElement(By.css(".K2BTEnhancedComboHeader")));
    const searchInputs = await container.findElements(By.css(".K2BTEnhancedComboSearchInput"));
    if (searchInputs.length > 0 && (await searchInputs[0].isDisplayed())) {
      await searchInputs[0].sendKeys(Key.chord(Key.CONTROL, "a"));
      await searchInputs[0].sendKeys(text);
    }
    const expected = normalizeText(text);
    await this.driver.wait(async () => {
      for (const item of await container.findElements(By.css(".K2BTEnhancedComboItem"))) {
        if (!(await item.isDisplayed())) continue;
        const actual = normalizeText(await item.getText());
        if (this.config.matchMode === "strict" ? actual === expected : actual.includes(expected)) return true;
      }
      return false;
    }, this.config.timeoutMs);
    for (const item of await container.findElements(By.css(".K2BTEnhancedComboItem"))) {
      if (!(await item.isDisplayed())) continue;
      const actual = normalizeText(await item.getText());
      if (this.config.matchMode === "strict" ? actual === expected : actual.includes(expected)) {
        await clickWithJsFallback(this.driver, item);
        await sleep(this.config.waitMs);
        return;
      }
    }
    throw new Error(`No se encontró la categoría "${text}"`);
  }

  async getBaseMonthlySalary(): Promise<number> {
    await this.driver.wait(async () => {
      const value = parseLocalizedDecimal(await this.driver.findElement(this.selectors.baseMonthlySalary).getText());
      return Number.isFinite(value) && value > 0;
    }, this.config.timeoutMs);
    return parseLocalizedDecimal(await this.driver.findElement(this.selectors.baseMonthlySalary).getText());
  }

  async fillEffectiveMonthlySalary(value: number): Promise<void> {
    assert.ok(value >= 0, "La remuneración efectiva no puede ser negativa");
    await this.replaceInput(this.selectors.effectiveMonthlySalary, value.toFixed(2).replace(".", ","));
  }

  async confirmAndAccept(): Promise<void> {
    await clickWithJsFallback(this.driver, await waitEnabled(this.driver, this.selectors.confirm, this.config.timeoutMs));
    await clickWithJsFallback(this.driver, await waitVisible(this.driver, this.selectors.confirmDialogOk, this.config.timeoutMs));
    await sleep(this.config.afterClickPauseMs);
  }

  async waitForMessageContaining(expected: string): Promise<string> {
    const normalizedExpected = normalizeText(expected);
    await this.driver.wait(async () => {
      for (const viewer of await this.driver.findElements(this.selectors.errorViewer)) {
        if (normalizeText(await viewer.getText()).includes(normalizedExpected)) return true;
      }
      return false;
    }, this.config.timeoutMs);
    return (await Promise.all((await this.driver.findElements(this.selectors.errorViewer)).map((viewer) => viewer.getText())))
      .filter(Boolean).join(" | ");
  }

  async snapshotVisibleEditableFields(): Promise<NpiUiSnapshot> {
    return this.driver.executeScript<NpiUiSnapshot>(`
      const excludedIds=new Set(['vTIPOSERVICIO','vUNIDADDENEGOCIO','vNPINRODES','vNPINROHAS','vESTADO','BUSCAR','CONFIRMAR','CANCELAR','vCHECKALL_GRIDNPI','vSELECCIONARTODOS']);
      const visible=el=>{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&el.getClientRects().length>0};
      const result={};
      document.querySelectorAll('#CONTENTTABLE input,#CONTENTTABLE select,#CONTENTTABLE textarea').forEach(el=>{
        if(!el.id||excludedIds.has(el.id)||el.type==='hidden'||el.type==='button'||el.type==='submit'||el.id.startsWith('vMULTIROWITEMSELECTED_GRIDNPI_')||el.id.startsWith('vISVISIBLE_')||el.id.includes('GRIDSETTINGS')||el.disabled||!visible(el)) return;
        result[el.id]=el.type==='checkbox'?String(el.checked):String(el.value??'');
      }); return result;
    `);
  }

  assertOnlyFieldsChanged(before: NpiUiSnapshot, after: NpiUiSnapshot, allowedIds: string[]): void {
    const allowed = new Set(allowedIds);
    const unexpected = Object.entries(before)
      .filter(([id, value]) => after[id] !== undefined && !allowed.has(id) && after[id] !== value)
      .map(([id, value]) => `${id}: "${value}" -> "${after[id]}"`);
    assert.deepEqual(unexpected, [], `Se alteraron campos no solicitados en la UI:\n${unexpected.join("\n")}`);
  }

  private async replaceInput(locator: By, value: string): Promise<void> {
    const element = await waitEnabled(this.driver, locator, this.config.timeoutMs);
    await element.click();
    await element.sendKeys(Key.chord(Key.CONTROL, "a"));
    await element.sendKeys(value);
  }
}
