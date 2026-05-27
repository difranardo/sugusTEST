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
npm run validate:liquidaciones -- --excel "C:\ruta\Consulta_histórico_para IT.xlsx" --liquidacionesPageTimeoutMs 120000
```

El flujo busca por `Nro. Liquidacion gente`, valida que aparezcan los recursos del Excel y, salvo que uses `--skipDetail`, entra al detalle de cada fila para comparar conceptos e importes. Si el detalle tiene una grilla distinta a la esperada, guarda captura y HTML en `reports/diagnostics`.

## Reportes

Cada corrida genera:

- `reports/sugus-report-YYYYMMDD-HHMMSS.csv`
- `reports/sugus-report-YYYYMMDD-HHMMSS.json`
- `reports/sugus-liquidaciones-report-YYYYMMDD-HHMMSS.csv`
- `reports/sugus-liquidaciones-report-YYYYMMDD-HHMMSS.json`

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
