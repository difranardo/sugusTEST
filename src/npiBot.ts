import { By, until, WebDriver, WebElement } from "selenium-webdriver";
import { NpiBotConfig } from "./npiConfig";
import { clickWithJsFallback, sleep, waitVisible } from "./npiUtils";

export class NpiBot {
  constructor(private readonly driver: WebDriver, private readonly config: NpiBotConfig) {}

  async login(): Promise<void> {
    await this.driver.get(this.config.baseUrl);
    const username = await waitVisible(this.driver, By.id("vUSERNAME"), this.config.timeoutMs);
    const password = await waitVisible(this.driver, By.id("vUSERPASSWORD"), this.config.timeoutMs);
    const loginButton = await waitVisible(this.driver, By.id("LOGIN"), this.config.timeoutMs);
    await username.clear();
    await username.sendKeys(this.config.username);
    await password.clear();
    await password.sendKeys(this.config.password);
    await clickWithJsFallback(this.driver, loginButton);
    await this.driver.wait(until.elementLocated(By.id("MENUTOGGLE_MPAGE")), this.config.pageTimeoutMs);
  }

  async openMassNpiModification(): Promise<void> {
    try {
      await this.openThroughMenu();
    } catch (error) {
      if (!this.config.directNavigationFallback) throw error;
      const target = new URL("/payroll.npi.modificacionmasivanpi.aspx", await this.driver.getCurrentUrl()).toString();
      console.warn(`[NPI] No se pudo navegar por menú; usando URL directa: ${target}`);
      await this.driver.get(target);
    }

    await waitVisible(this.driver, By.id("BUSCAR"), this.config.pageTimeoutMs);
    const title = await waitVisible(this.driver, By.id("TITLE"), this.config.pageTimeoutMs);
    const normalizedTitle = (await title.getText()).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!normalizedTitle.includes("modificacion masiva") || !normalizedTitle.includes("npi")) {
      throw new Error(`Pantalla inesperada. Título encontrado: ${await title.getText()}`);
    }
  }

  private async openThroughMenu(): Promise<void> {
    const toggle = await waitVisible(this.driver, By.id("MENUTOGGLE_MPAGE"), this.config.menuTimeoutMs);
    await clickWithJsFallback(this.driver, toggle);
    await sleep(this.config.menuPauseMs);

    const npiMenu = await this.findDisplayed([
      By.css('a[data-k2btcode="NPI"]'),
      By.xpath("//a[.//span[normalize-space(.)='NPI']] | //span[normalize-space(.)='NPI']/ancestor::a[1]")
    ]);
    if ((await npiMenu.getAttribute("aria-expanded")) !== "true") {
      await clickWithJsFallback(this.driver, npiMenu);
      await sleep(this.config.menuPauseMs);
    }

    const option = await this.findDisplayed([
      By.css('a[data-k2btcode="Payroll.NPI.ModificacionMasivaNPI"]'),
      By.xpath("//a[.//span[contains(normalize-space(.),'Modificación Masiva NPI')]] | //span[contains(normalize-space(.),'Modificación Masiva NPI')]/ancestor::a[1]")
    ]);
    await clickWithJsFallback(this.driver, option);
    await sleep(this.config.afterClickPauseMs);
  }

  private async findDisplayed(locators: By[]): Promise<WebElement> {
    for (const locator of locators) {
      const elements = await this.driver.findElements(locator);
      for (const element of elements) {
        if (await element.isDisplayed()) return element;
      }
    }
    throw new Error("No se encontró una opción visible del menú NPI");
  }
}
