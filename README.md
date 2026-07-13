# Sugus UAT Validator

Bot en TypeScript + Selenium para validar candidatos activos contra Sugus UAT.

## Instalacion

```powershell
npm install
```

Crear un `.env` tomando como base `.env.example` y completar `SUGUS_PASS`.

## Uso

### Candidatos

```powershell
npm run validate -- --excel "C:\Users\leo_d\Downloads\ACTIVOS.xlsx"
```

O usando el compilado:

```powershell
npm run build
npm run validate:dist -- --excel "C:\Users\leo_d\Downloads\ACTIVOS.xlsx"
```

Opciones utiles:

```powershell
npm run validate -- --excel "C:\ruta\ACTIVOS.xlsx" --limit 10
npm run validate -- --excel "C:\ruta\ACTIVOS.xlsx" --browser edge
npm run validate -- --excel "C:\ruta\ACTIVOS.xlsx" --headless=true
npm run validate -- --excel "C:\ruta\ACTIVOS.xlsx" --match-mode primary
npm run validate -- --excel "C:\ruta\ACTIVOS.xlsx" --candidatesPageTimeoutMs 120000
```

`strict` valida todos los tokens de nombres y apellidos del Excel. `primary` valida solo primer nombre y primer apellido.

Si la pantalla `Trabajar con Candidatos` tarda mucho, se pueden ajustar estas esperas en `.env`:

```env
SUGUS_CANDIDATES_MENU_PAUSE_MS=2000
SUGUS_CANDIDATES_AFTER_CLICK_PAUSE_MS=5000
SUGUS_CANDIDATES_PAGE_TIMEOUT_MS=120000
```

Durante esa carga el script imprime progreso cada 10 segundos. Si aparece `Sigo esperando Trabajar con Candidatos...`, no cortes la terminal: todavia esta dentro del timeout configurado.

En esa pantalla el panel de filtros puede quedar colapsado. El bot no necesita verlo abierto: usa los campos del DOM y dispara el boton `Buscar` igual.

### Liquidaciones

Para validar `Liquidaciones` > `Consulta de Liquidaciones` con el Excel de historico:

```powershell
npm run validate:liquidaciones -- --excel "C:\Users\leo_d\Downloads\Consulta_histórico_para IT.xlsx" --browser chrome --liquidacion 64968
```

Opciones utiles:

```powershell
npm run validate:liquidaciones -- --excel "C:\ruta\Consulta_histórico_para IT.xlsx" --liquidacion 64968
npm run validate:liquidaciones -- --excel "C:\ruta\Consulta_histórico_para IT.xlsx" --limitLiquidaciones 3
npm run validate:liquidaciones -- --excel "C:\ruta\Consulta_histórico_para IT.xlsx" --skipDetail
npm run validate:liquidaciones -- --excel "C:\ruta\Consulta_histórico_para IT.xlsx" --liquidacionesMenuTimeoutMs 120000
npm run validate:liquidaciones -- --excel "C:\ruta\Consulta_histórico_para IT.xlsx" --liquidacionesMenuPauseMs 5000
npm run validate:liquidaciones -- --excel "C:\ruta\Consulta_histórico_para IT.xlsx" --liquidacionesPageTimeoutMs 120000
```

El flujo busca por `Nro. Liquidacion gente`, valida que aparezcan los recursos del Excel y, salvo que uses `--skipDetail`, entra al detalle de cada fila para comparar conceptos e importes. Si el menu o la pantalla tardan, el bot espera hasta 120 segundos por defecto y muestra progreso cada 10 segundos. Si el detalle tiene una grilla distinta a la esperada, guarda captura y HTML en `reports/diagnostics`.

### Facturacion

Para validar `Facturacion` > `Facturas / NC / ND` con el Excel de cuenta corriente:

```powershell
npm run validate:facturacion -- --excel "C:\Users\leo_d\Downloads\cuenta corriente Mercado Uruguay 07-05-2026 (1).xlsx" --user acortazzo --pass "<password>"
```

Opciones utiles:

```powershell
npm run validate:facturacion -- --excel "C:\ruta\cuenta corriente.xlsx" --limit 10
npm run validate:facturacion -- --excel "C:\ruta\cuenta corriente.xlsx" --documentTypes FC
npm run validate:facturacion -- --excel "C:\ruta\cuenta corriente.xlsx" --documentTypes FC,NC,ND
npm run validate:facturacion -- --excel "C:\ruta\cuenta corriente.xlsx" --tipo A
npm run validate:facturacion -- --excel "C:\ruta\cuenta corriente.xlsx" --facturacionFechaDesde 01/01/2000
```

El lector toma la tabla de cuenta corriente, usa `Mov descripcion` y `Numero`, y busca cada comprobante por `Tipo de Documento`, `T.` y `Numero`. Por defecto incluye facturas, e-tickets, notas de credito y notas de debito (`FC,ET,NC,CE,ND,DE`). Para validar solo facturas comunes, usar `--documentTypes FC`.

Si el link de menu cambia o carga lento, se pueden ajustar estas esperas:

```env
SUGUS_FACTURACION_MENU_PAUSE_MS=5000
SUGUS_FACTURACION_MENU_TIMEOUT_MS=120000
SUGUS_FACTURACION_AFTER_CLICK_PAUSE_MS=5000
SUGUS_FACTURACION_PAGE_TIMEOUT_MS=120000
SUGUS_FACTURACION_FECHA_DESDE=01/01/2000
```

### Modificación masiva de NPI (PAYROLL-2962)

El bot integrado inicia sesión en RANDY Test, navega por `NPI` > `Modificación Masiva NPI` y ejecuta validaciones funcionales sobre la pantalla:

```powershell
npm run validate:npi
```

Selectores de navegación confirmados:

- menú: `a[data-k2btcode="NPI"]`;
- opción: `a[data-k2btcode="Payroll.NPI.ModificacionMasivaNPI"]`;
- fallback directo: `/payroll.npi.modificacionmasivanpi.aspx`.

Configuración mínima en `.env`:

```env
SUGUS_URL=https://randy-test-uy.randstad.com.uy/login.aspx
SUGUS_USER=<usuario_qa>
SUGUS_PASS=<password_qa>
NPI_TEST_NUMBER=52
NPI_STATE=A
SUGUS_ALLOW_WRITE=false
```

La búsqueda respeta el orden de habilitación de Randy: `Tipo de servicio` → `Unidad de negocio` → `Posición a cubrir` → `Grupo/Subgrupo` → `Categoría` → `Empresa Usuaria` → `Planta` → `Sucursal de mantenimiento` → `Operador de cuenta` → `NPI desde/hasta` → `Estado` → `Buscar`. `NPI_TEST_NUMBER` y `NPI_STATE` son obligatorios. Antes del clic, el bot vuelve a leer todos los controles obligatorios y cancela la búsqueda si alguno está vacío o deshabilitado. Los valores específicos se configuran con las variables `NPI_*_VALUE` de `.env.example`; cuando una queda vacía, el bot selecciona la primera opción habilitada del combo correspondiente.

Con `SUGUS_ALLOW_WRITE=false` no se confirman operaciones que puedan persistir cambios. Las pruebas de piso salarial y guardado de monto fijo quedan en estado `SKIPPED`. Para habilitarlas se necesita una NPI descartable de QA y las variables documentadas en `.env.example`.

El resultado se guarda en `reports/payroll-2962/payroll-2962-report.json`; los fallos también generan una captura PNG en esa carpeta.

## Reportes

Cada corrida genera:

- `reports/sugus-report-YYYYMMDD-HHMMSS.csv`
- `reports/sugus-report-YYYYMMDD-HHMMSS.json`
- `reports/sugus-liquidaciones-report-YYYYMMDD-HHMMSS.csv`
- `reports/sugus-liquidaciones-report-YYYYMMDD-HHMMSS.json`
- `reports/sugus-facturacion-report-YYYYMMDD-HHMMSS.csv`
- `reports/sugus-facturacion-report-YYYYMMDD-HHMMSS.json`

Estados principales:

- `MATCH`: encontro candidato y coinciden datos esperados.
- `NOT_FOUND`: no encontro candidato por documento ni por nombre/apellido.
- `NAME_MISMATCH`: encontro el documento, pero nombre/apellido no coinciden.
- `DOCUMENT_MISMATCH`: encontro nombre/apellido, pero el documento no coincide.
- `ERROR`: fallo tecnico en esa fila y continuo con la siguiente.

## Flujo automatizado

1. Abre `SUGUS_URL`.
2. Loguea con `SUGUS_USER` y `SUGUS_PASS`.
3. Abre menu lateral.
4. Entra a `Candidatos` > `Trabajar con Candidatos`.
5. Por cada fila del Excel:
   - Busca primero por `Documento identidad`.
   - Valida nombre y apellido contra la grilla.
   - Si no encuentra por documento, intenta por nombre/apellido.
6. Guarda resumen y detalle en `reports/`.
