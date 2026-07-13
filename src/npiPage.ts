import assert from "node:assert/strict";
import { By, Key, WebDriver, WebElement } from "selenium-webdriver";
import { Select } from "selenium-webdriver/lib/select";
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
    serviceType: By.id("vTIPOSERVICIO"),
    businessUnit: By.id("vUNIDADDENEGOCIO"),
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
    const npiFrom = options.npiFrom?.trim() || this.config.npiNumber;
    const npiTo = options.npiTo?.trim() || this.config.npiNumber;
    const state = options.state || this.config.state;

    console.log("[NPI] 1/12 Tipo de servicio");
    await this.selectRequiredFilter(
      this.selectors.serviceType,
      "Tipo de servicio",
      this.config.serviceTypeValue
    );

    console.log("[NPI] 2/12 Unidad de negocio");
    await this.selectRequiredFilter(
      this.selectors.businessUnit,
      "Unidad de negocio",
      this.config.businessUnitValue
    );

    console.log("[NPI] 3/12 Posición a cubrir");
    await this.selectRequiredByLabel(
      ["vPOSICIONACUBRIR", "vPOSICION", "vPUESTO"],
      "Posición a Cubrir",
      this.config.positionValue
    );

    console.log("[NPI] 4/12 Grupo/Subgrupo");
    await this.selectRequiredFilter(
      this.selectors.groupSubgroup,
      "Grupo/Subgrupo",
      this.config.groupSubgroupValue
    );

    console.log("[NPI] 5/12 Categoría");
    await this.selectCategoryForSearch(this.config.categoryText);

    console.log("[NPI] 6/12 Empresa Usuaria");
    await this.selectRequiredByLabel(
      ["vEMPRESAUSUARIA", "vEMPRESAUSUARIO", "vEMPRESA"],
      "Empresa Usuaria",
      this.config.userCompanyValue
    );

    console.log("[NPI] 7/12 Planta");
    await this.selectRequiredByLabel(
      ["vPLANTA", "vPLANTANRO", "vPLANTACOD"],
      "Planta",
      this.config.plantValue
    );

    console.log("[NPI] 8/12 Sucursal de mantenimiento");
    await this.selectRequiredByLabel(
      ["vSUCURSALMANTENIMIENTO", "vSUCMANTENIMIENTO", "vSUCMANT"],
      "Suc. de Manten.",
      this.config.maintenanceBranchValue
    );

    console.log("[NPI] 9/12 Operador de cuenta");
    await this.selectRequiredByLabel(
      ["vOPERADORCUENTA", "vOPERADORCTA", "vOPERCUENTA"],
      "Operador Cta.",
      this.config.accountOperatorValue
    );

    console.log("[NPI] 10/12 NPI desde y hasta");
    await this.replaceInput(this.selectors.npiFrom, npiFrom);
    await this.waitForInputValue(this.selectors.npiFrom, npiFrom);
    await this.replaceInput(this.selectors.npiTo, npiTo);
    await this.waitForInputValue(this.selectors.npiTo, npiTo);

    console.log("[NPI] 11/12 Estado");
    await this.selectByExactValue(this.selectors.state, state, "Estado");

    await this.assertRequiredSearchFieldsComplete();
    console.log("[NPI] 12/12 Buscar");
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
    await this.selectByExactValue(this.selectors.conditionPayment, value, "Condición de Pago");
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
    const control = await this.waitForSelectWithOptions(this.selectors.groupSubgroup, "Grupo/Subgrupo");
    const options = await control.findElements(By.css("option"));
    let actualValue: string | undefined;
    for (const option of options) {
      const candidate = (await option.getAttribute("value")).trim();
      if (candidate === value.trim() || candidate.startsWith(value.trim())) {
        actualValue = candidate;
        break;
      }
    }
    if (!actualValue) throw new Error(`Grupo/Subgrupo no contiene el valor ${value}`);
    await new Select(control).selectByValue(actualValue);
    await this.blurAfterSelection(control);
    await this.waitForSelectValue(this.selectors.groupSubgroup, actualValue, "Grupo/Subgrupo");
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

  private async selectCategoryForSearch(text?: string): Promise<void> {
    try {
      const container = await waitVisible(this.driver, By.id("CATEGORIA1Container"), this.config.emptyComboWaitMs);
      await clickWithJsFallback(this.driver, await container.findElement(By.css(".K2BTEnhancedComboHeader")));
      const searchInputs = await container.findElements(By.css(".K2BTEnhancedComboSearchInput"));
      if (text && searchInputs.length > 0 && (await searchInputs[0].isDisplayed())) {
        await searchInputs[0].sendKeys(Key.chord(Key.CONTROL, "a"));
        await searchInputs[0].sendKeys(text);
      }
      const expected = text ? normalizeText(text) : "";
      const item = (await this.driver.wait(async () => {
        for (const candidate of await container.findElements(By.css(".K2BTEnhancedComboItem"))) {
          if (!(await candidate.isDisplayed())) continue;
          const actual = normalizeText(await candidate.getText());
          if (!actual || actual === "ninguno") continue;
          if (!expected || (this.config.matchMode === "strict" ? actual === expected : actual.includes(expected))) {
            return candidate;
          }
        }
        return false;
      }, this.config.emptyComboWaitMs, "Categoría no se habilitó o no cargó opciones")) as WebElement;
      await clickWithJsFallback(this.driver, item);
      await sleep(this.config.waitMs);
    } catch {
      this.warnEmptyCombo("Categoría");
    }
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

  private async selectRequiredFilter(locator: By, label: string, configuredValue?: string): Promise<string> {
    let control: WebElement;
    try {
      control = await this.waitForSelectWithOptions(locator, label, false, this.config.emptyComboWaitMs);
    } catch {
      this.warnEmptyCombo(label);
      return "";
    }
    const currentValue = (await control.getAttribute("value"))?.trim() ?? "";
    let target = configuredValue?.trim() || currentValue;

    if (!target) {
      for (const option of await control.findElements(By.css("option"))) {
        const value = (await option.getAttribute("value"))?.trim() ?? "";
        if (value && (await option.isEnabled())) {
          target = value;
          break;
        }
      }
    }

    if (!target) throw new Error(`${label} no tiene una opción habilitada para continuar`);
    await new Select(control).selectByValue(target);
    await this.blurAfterSelection(control);
    await this.waitForSelectValue(locator, target, label);
    await sleep(this.config.waitMs);
    return target;
  }

  private async selectByExactValue(locator: By, value: string, label: string): Promise<void> {
    const control = await this.waitForSelectWithOptions(locator, label, true);
    const optionValues = await Promise.all(
      (await control.findElements(By.css("option"))).map((option) => option.getAttribute("value"))
    );
    if (!optionValues.includes(value)) {
      throw new Error(`${label} no contiene el valor "${value}". Disponibles: ${optionValues.join(", ")}`);
    }
    await new Select(control).selectByValue(value);
    await this.blurAfterSelection(control);
    await this.waitForSelectValue(locator, value, label);
    await sleep(this.config.waitMs);
  }

  private async waitForSelectWithOptions(
    locator: By,
    label: string,
    allowOnlyEmpty = false,
    timeoutMs = this.config.pageTimeoutMs
  ) {
    await this.driver.wait(async () => {
      try {
        const control = await this.driver.findElement(locator);
        if (!(await control.isDisplayed()) || !(await control.isEnabled())) return false;
        const options = await control.findElements(By.css("option"));
        if (allowOnlyEmpty) return options.length > 0;
        for (const option of options) {
          if (((await option.getAttribute("value"))?.trim() ?? "") && (await option.isEnabled())) return true;
        }
        return false;
      } catch {
        return false;
      }
    }, timeoutMs, `${label} no se habilitó o no cargó opciones`);
    return waitEnabled(this.driver, locator, this.config.timeoutMs);
  }

  private async waitForSelectValue(locator: By, expected: string, label: string): Promise<void> {
    await this.driver.wait(async () => {
      try {
        return ((await this.driver.findElement(locator).getAttribute("value")) ?? "") === expected;
      } catch {
        return false;
      }
    }, this.config.timeoutMs, `${label} no conservó el valor ${expected}`);
  }

  private async waitForInputValue(locator: By, expected: string): Promise<void> {
    await this.driver.wait(async () => {
      try {
        const element = await this.driver.findElement(locator);
        return (await element.isEnabled()) && ((await element.getAttribute("value")) ?? "").trim() === expected.trim();
      } catch {
        return false;
      }
    }, this.config.timeoutMs);
  }

  private async assertRequiredSearchFieldsComplete(): Promise<void> {
    const requiredLabels = [
      "Tipo Servicio",
      "Unidad de Negocio",
      "Posición a Cubrir",
      "Grupo/Subgrupo",
      "Categoría",
      "Empresa Usuaria",
      "Planta",
      "Suc. de Manten.",
      "Operador Cta."
    ];
    const missing = await this.driver.executeScript<string[]>(`
      const normalize=value=>(value||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      const labels=arguments[0];
      const controls=Array.from(document.querySelectorAll('select'));
      return labels.filter(label=>{
        const expected=normalize(label);
        const control=controls.find(select=>{
          const linked=select.id ? document.querySelector('label[for="'+CSS.escape(select.id)+'"]') : null;
          const context=(linked?.textContent||'')+' '+(select.parentElement?.innerText||'');
          return normalize(context).includes(expected);
        });
        return !control || !String(control.value||'').trim() || control.disabled;
      });
    `, requiredLabels);
    for (const field of [
      { locator: this.selectors.npiFrom, label: "NPI desde" },
      { locator: this.selectors.npiTo, label: "NPI hasta" },
      { locator: this.selectors.state, label: "Estado" }
    ]) {
      const element = await waitEnabled(this.driver, field.locator, this.config.timeoutMs);
      if (!((await element.getAttribute("value")) ?? "").trim()) missing.push(field.label);
    }
    if (missing.length > 0) {
      console.warn(`[NPI] Se continúa con combos vacíos o deshabilitados: ${missing.join(", ")}`);
    } else {
      console.log("[NPI] Todos los campos disponibles están completos; se permite Buscar");
    }
  }

  private async selectRequiredByLabel(candidateIds: string[], label: string, configuredValue?: string): Promise<string> {
    const findControl = async () => this.driver.executeScript<import("selenium-webdriver").WebElement | null>(`
      const normalize=value=>(value||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      for (const id of arguments[0]) { const found=document.getElementById(id); if(found?.tagName==='SELECT') return found; }
      const expected=normalize(arguments[1]);
      const selects=Array.from(document.querySelectorAll('select'));
      return selects.find(select=>{
        const linked=select.id ? document.querySelector('label[for="'+CSS.escape(select.id)+'"]') : null;
        const own=normalize(linked?.textContent||'');
        if(own===expected||own.includes(expected)) return true;
        const lines=(select.parentElement?.innerText||'').split(/\\r?\\n/).slice(0,3).join(' ');
        return normalize(lines).includes(expected);
      })||null;
    `, candidateIds, label);

    let control: WebElement;
    try {
      control = (await this.driver.wait(async () => {
        const candidate = await findControl();
        if (!candidate) return false;
        try {
          if (!(await candidate.isEnabled())) return false;
          for (const option of await candidate.findElements(By.css("option"))) {
            if (((await option.getAttribute("value")) ?? "").trim() && (await option.isEnabled())) return candidate;
          }
        } catch {
          return false;
        }
        return false;
      }, this.config.emptyComboWaitMs, `${label} no se encontró, no se habilitó o no cargó opciones`)) as WebElement;
    } catch {
      this.warnEmptyCombo(label);
      return "";
    }

    const current = ((await control.getAttribute("value")) ?? "").trim();
    let target = configuredValue?.trim() || current;
    if (!target) {
      for (const option of await control.findElements(By.css("option"))) {
        const value = ((await option.getAttribute("value")) ?? "").trim();
        if (value && (await option.isEnabled())) { target = value; break; }
      }
    }
    if (!target) throw new Error(`${label} no tiene una opción válida`);
    await new Select(control).selectByValue(target);
    await this.blurAfterSelection(control);
    await sleep(this.config.waitMs);

    await this.driver.wait(async () => {
      const refreshed = await findControl();
      return refreshed ? ((await refreshed.getAttribute("value")) ?? "").trim() === target : false;
    }, this.config.timeoutMs, `${label} no conservó el valor ${target}`);
    return target;
  }

  private async blurAfterSelection(element: import("selenium-webdriver").WebElement): Promise<void> {
    try {
      await element.sendKeys(Key.TAB);
    } catch {
      try {
        await this.driver.executeScript("arguments[0].blur();", element);
      } catch {
        // El AJAX puede reemplazar el control inmediatamente después del cambio.
      }
    }
  }

  private warnEmptyCombo(label: string): void {
    console.warn(`[NPI] ${label} sigue vacío/deshabilitado después de ${this.config.emptyComboWaitMs} ms; continúo.`);
  }
}
