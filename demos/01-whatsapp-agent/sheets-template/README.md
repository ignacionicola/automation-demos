# Spreadsheet template

The three tabs the agent reads. Import these CSVs into one Google Sheet, as
three tabs named exactly **`propiedades`**, **`negocio`** and **`faq`**.

They are generated from the JSON bundled in the workflow, so the spreadsheet
starts out as an exact copy of the demo catalogue — the agent behaves
identically before and after connecting it, which makes it easy to tell
whether the connection is working.

## How to import

1. Create a blank Google Sheet.
2. **File → Import → Upload → `propiedades.csv`**, choosing *Insert new
   sheet(s)*. Repeat for the other two.
3. Rename each tab to `propiedades`, `negocio` and `faq` (Sheets names them
   after the file, so they usually come out right).
4. Delete the empty `Sheet1` that Google creates.

Then follow the *Google Sheets setup* section in the demo's
[README](../README.md#3-google-sheets-setup) to share it with the service
account and point `SHEETS_DOCUMENT_ID` at it.

## `propiedades`

One row per listing. **`id` is the only required column** — a row without one
is skipped, which is what makes the empty rows at the bottom harmless. Every
other column can be left blank; the listing simply takes part in fewer
searches.

| Column | Notes |
|---|---|
| `id` | The reference code, e.g. `INM-101`. Shown to the customer as *Ref:* |
| `titulo` | Headline. Falls back to `Propiedad <id>` |
| `operacion` | `alquiler` or `venta`. Anything else is treated as unspecified |
| `tipo` | `departamento`, `casa`, `ph` or `local` |
| `ciudad` / `barrio` | Used for filtering. `barrio` also lets *"el de Las Flores"* resolve |
| `direccion` | Goes into the calendar event, so the agent knows where to go |
| `dormitorios` / `banios` | Whole numbers. Matched as *at least N* |
| `superficie_m2` | `75` or `75 m2`, both work |
| `cochera` | `sí` / `no`. `x`, `TRUE` and any other text count as yes |
| `precio` / `expensas` | `420000`, `420.000` or `$ 420.000` — all the same |
| `moneda` | `ARS` or `USD`. Defaults to `ARS` when there's a price |
| `descripcion` | One or two sentences |
| `destacados` | Separated by `\|`, `;`, `·` or line breaks |
| `foto` | **Public image URL.** See the warning below |

> **About `foto`:** WhatsApp fetches the image from Meta's servers, so the URL
> has to return the image itself. A Google Drive share link returns an HTML
> page instead and the photo silently fails to send. Use the URL of an image
> already published on the agency's website, or any host that serves the file
> directly. A row without a usable URL is not dropped — its details fall back
> into the text message.

## `negocio`

Two columns, `clave` and `valor`. Anything missing falls back to the built-in
default, so a half-filled tab is fine.

| `clave` | What it does |
|---|---|
| `nombre` | Signs the messages |
| `direccion` | Available as `{{direccion}}` in FAQ answers |
| `telefono` | Available as `{{telefono}}` |
| `logo` | Reserved; not used in messages yet |
| `hora_apertura` | **Validates bookings**, not just the text |
| `hora_cierre` | idem |
| `hora_cierre_sabado` | idem. `cerrado` means the agency doesn't open on Saturdays |

The hours are the point of this tab: they decide which bookings are accepted
*and* what every message says about opening times. Change `hora_cierre` to
`20` and the agent starts accepting 19:30 appointments and saying so — the two
cannot drift apart, because they read the same cell.

## `faq`

| Column | Notes |
|---|---|
| `id` | Anything unique. `faq-saludo` is special: it answers a bare "hola" |
| `pregunta` | Only for humans reading the sheet — it also adds weak matching signal |
| `claves` | Comma-separated keywords. **This is what actually matches** |
| `respuesta` | The answer. Supports `{{nombre}}`, `{{direccion}}`, `{{telefono}}` and `{{horarios}}` |

Matching is by keyword, not by LLM: it's instant, costs no tokens, and always
gives the same answer — which is what an agency wants for its own commission
and requirements. A question that matches nothing is handed to a human.

Keep `{{horarios}}` in the hours answer rather than typing the times out. That
way changing `hora_cierre` in `negocio` updates the answer too, instead of
leaving the agent contradicting itself.
