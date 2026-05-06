# Modo: scan — Portal Scanner (Descubrimiento de Ofertas)

Escanea portales de empleo configurados, filtra por relevancia de título, y añade nuevas ofertas al pipeline para evaluación posterior.

## Ejecución recomendada

Ejecutar como subagente para no consumir contexto del main:

```
Agent(
    subagent_type="general-purpose",
    prompt="[contenido de este archivo + datos específicos]",
    run_in_background=True
)
```

## Configuración

Leer `portals.yml` que contiene:
- `search_queries`: Lista de queries WebSearch con `site:` filters por portal (descubrimiento amplio)
- `tracked_companies`: Empresas específicas con `careers_url` para navegación directa
- `role_terms`: Variantes de "Software Entwickler" (Gate 1 del shortlist)
- `ai_signals`: Términos AI/KI que deben aparecer en título O descripción (Gate 2)
- `title_filter.negative` + `seniority_boost`: filtros de ruido y señales de junior/entry

## Shortlist logic (Phase 1 — DACH Software Entwickler + AI/KI)

Una oferta entra al pipeline sólo si pasa AMBOS gates. **El nombre de la empresa se ignora** — pequeñas startups, Mittelstand, y empresas con careers page propia están todas en scope.

**Gate 1 — Role match (título):**
- El título contiene alguno de los términos de `role_terms` (case-insensitive, whole-word para acrónimos).
- Ej: "Software Entwickler", "Softwareentwickler", "Software Engineer", "Fullstack Developer", "Python Entwickler", "Backend Engineer", "KI-Entwickler", "AI Engineer", etc.

**Gate 2 — AI signal (título O descripción):**
- El título O la descripción del puesto contiene algún término de `ai_signals`.
- Acrónimos cortos ("AI", "KI", "ML", "LLM", "GPT") deben matchear como palabra completa — nunca como substring de "HTML", "KIA", "AirBnB", etc.
- Si el título ya contiene un signal (p.ej. "AI Engineer", "KI-Entwickler") → Gate 2 pasa sin necesidad de leer la descripción.

**Filtro negativo adicional:** 0 términos de `title_filter.negative` en el título (Intern, Praktikant, Werkstudent, Ausbildung, iOS, Android, COBOL, etc.).

### Implementación en dos pasadas

**Pasada 1 (rápida, sólo títulos)** — aplicar en todos los niveles:
- `role_terms` matchea en título → candidato a Gate 1 ✓
- `ai_signals` matchea en título → Gate 2 ✓ → **Shortlist inmediato**
- `role_terms` matchea pero `ai_signals` no → candidato parcial → Pasada 2
- No matchea `role_terms` → `skipped_title`

**Pasada 2 (description drill-down)** — sólo para los candidatos parciales de Pasada 1:
- **Nivel 1 (Playwright tracked_companies):** hacer click o `browser_navigate` a la URL del listing, `browser_snapshot`, buscar `ai_signals` en el texto completo. Secuencial, nunca paralelo.
- **Nivel 2 (Greenhouse API):** la API ya devuelve `content` con el JD completo — buscar `ai_signals` allí (sin fetch extra).
- **Nivel 3 (WebSearch):** la verificación de liveness (paso 7.5) ya hace `browser_navigate` + `browser_snapshot` a cada URL nueva. **Extender esa verificación** para también escanear el body por `ai_signals` ANTES de añadir a pipeline. Sin doble fetch.
- Si `ai_signals` aparece en la descripción → **Shortlist**. Si no → `skipped_no_ai_signal` (nuevo status).

### DACH broad scan — queries de Phase 1

Las nuevas queries en `portals.yml` (sección "Phase 1 — DACH broad scans") cubren el gap de empresas pequeñas alemanas:
- **ATSes DACH:** Personio, Recruitee, Softgarden, JOIN.com, Teamtailor, Workwise. Cada query `site:jobs.personio.de ...` hace match contra cientos de empresas hospedadas en ese ATS de una sola vez.
- **Boards DACH:** arbeitnow, Gründerszene, Berlin Startup Jobs, Munich Startup, Kununu, Jobware, Stellenanzeigen.de, Die Zeit Jobs, XING.
- **Self-hosted careers:** queries con `inurl:karriere OR inurl:stellen OR inurl:jobs site:.de` para empresas con su propia página de carrera sin ATS.
- **Cluster regional Leonberg/Stuttgart:** CyberValley, UnternehmerTUM, BW (Stuttgart/Karlsruhe/Tübingen/Heilbronn/Böblingen).

Todas estas queries tiran resultados de muchas empresas desconocidas. El filtro role_terms + ai_signals se encarga de reducir el ruido.

## Estrategia de descubrimiento (3 niveles)

### Nivel 1 — Playwright directo (PRINCIPAL)

**Para cada empresa en `tracked_companies`:** Navegar a su `careers_url` con Playwright (`browser_navigate` + `browser_snapshot`), leer TODOS los job listings visibles, y extraer título + URL de cada uno. Este es el método más fiable porque:
- Ve la página en tiempo real (no resultados cacheados de Google)
- Funciona con SPAs (Ashby, Lever, Workday)
- Detecta ofertas nuevas al instante
- No depende de la indexación de Google

**Cada empresa DEBE tener `careers_url` en portals.yml.** Si no la tiene, buscarla una vez, guardarla, y usar en futuros scans.

### Nivel 2 — Greenhouse API (COMPLEMENTARIO)

Para empresas con Greenhouse, la API JSON (`boards-api.greenhouse.io/v1/boards/{slug}/jobs`) devuelve datos estructurados limpios. Usar como complemento rápido de Nivel 1 — es más rápido que Playwright pero solo funciona con Greenhouse.

### Nivel 3 — WebSearch queries (DESCUBRIMIENTO AMPLIO)

Los `search_queries` con `site:` filters cubren portales de forma transversal (todos los Ashby, todos los Greenhouse, etc.). Útil para descubrir empresas NUEVAS que aún no están en `tracked_companies`, pero los resultados pueden estar desfasados.

**Prioridad de ejecución:**
1. Nivel 1: Playwright → todas las `tracked_companies` con `careers_url`
2. Nivel 2: API → todas las `tracked_companies` con `api:`
3. Nivel 3: WebSearch → todos los `search_queries` con `enabled: true`

Los niveles son aditivos — se ejecutan todos, los resultados se mezclan y deduplicar.

### Consultas alemanas (DACH-Markt)

Cuando el candidato tiene `language.modes_dir: modes/de` en `config/profile.yml`, incluir queries con keywords alemanas:
- "KI Ingenieur Berlin"
- "Machine Learning Engineer Deutschland"
- "LLM Engineer München"
- "AI Engineer Stuttgart"
- "Softwareentwickler KI"
- "Künstliche Intelligenz" + ciudad

Los portales alemanes (StepStone, ArbeitNow, Honeypot, Indeed DE) ya están configurados en `portals.yml` bajo `search_queries`. Los portales alemanes suelen requerir Playwright por cookie-banners y session-based rendering.

## Workflow

1. **Leer configuración**: `portals.yml`
2. **Leer historial**: `data/scan-history.tsv` → URLs ya vistas
3. **Leer dedup sources**: `data/applications.md` + `data/pipeline.md`

4. **Nivel 1 — Playwright scan** (paralelo en batches de 3-5):
   Para cada empresa en `tracked_companies` con `enabled: true` y `careers_url` definida:
   a. `browser_navigate` a la `careers_url`
   b. `browser_snapshot` para leer todos los job listings
   c. Si la página tiene filtros/departamentos, navegar las secciones relevantes
   d. Para cada job listing extraer: `{title, url, company}`
   e. Si la página pagina resultados, navegar páginas adicionales
   f. Acumular en lista de candidatos
   g. Si `careers_url` falla (404, redirect), intentar `scan_query` como fallback y anotar para actualizar la URL

4b. **Nivel 1b — LinkedIn search (last 24h)**:
   Para cada entry en `linkedin_searches` con `enabled: true`:
   a. `browser_navigate` a la URL (LinkedIn job search con filtro `f_TPR=r86400`)
   b. `browser_snapshot` para leer los job cards
   c. Para cada job card extraer: `{title, url, company}`
   d. Scroll down para cargar más resultados si los hay (máx 50 resultados por query)
   e. Acumular en lista de candidatos (dedup con Nivel 1)
   
   **IMPORTANTE:** LinkedIn puede requerir login. Si la página muestra login wall, saltar este nivel y notificar al usuario. Si el usuario está loggeado en Chrome, usar `claude --chrome` para este nivel.
   
   **IMPORTANTE:** LinkedIn URLs de cada listing deben normalizarse a formato canónico: `https://www.linkedin.com/jobs/view/{job_id}` (sin parámetros de tracking).

5. **Nivel 2 — Greenhouse APIs** (paralelo):
   Para cada empresa en `tracked_companies` con `api:` definida y `enabled: true`:
   a. WebFetch de la URL de API → JSON con lista de jobs
   b. Para cada job extraer: `{title, url, company}`
   c. Acumular en lista de candidatos (dedup con Nivel 1)

6. **Nivel 3 — WebSearch queries** (paralelo si posible):
   Para cada query en `search_queries` con `enabled: true`:
   a. Ejecutar WebSearch con el `query` definido
   b. De cada resultado extraer: `{title, url, company}`
      - **title**: del título del resultado (antes del " @ " o " | ")
      - **url**: URL del resultado
      - **company**: después del " @ " en el título, o extraer del dominio/path
   c. Acumular en lista de candidatos (dedup con Nivel 1+2)

6. **Filtrar aplicando el shortlist rule de dos gates** (ver sección "Shortlist logic (Phase 1)" arriba):
   - **Gate 1:** título contiene un término de `role_terms` (case-insensitive)
   - **Gate 2:** título O descripción contiene un término de `ai_signals` (acrónimos con whole-word)
   - 0 términos de `title_filter.negative` en el título
   - `seniority_boost` (Junior, Entry) da prioridad pero no es obligatorio
   - Dos pasadas: títulos primero (rápido); description drill-down sólo para los casos title-role-only

7. **Deduplicar** contra 3 fuentes:
   - `scan-history.tsv` → URL exacta ya vista
   - `applications.md` → empresa + rol normalizado ya evaluado
   - `pipeline.md` → URL exacta ya en pendientes o procesadas

7.5. **Verificar liveness de resultados de WebSearch (Nivel 3)** — ANTES de añadir a pipeline:

   Los resultados de WebSearch pueden estar desactualizados (Google cachea resultados durante semanas o meses). Para evitar evaluar ofertas expiradas, verificar con Playwright cada URL nueva que provenga del Nivel 3. Los Niveles 1 y 2 son inherentemente en tiempo real y no requieren esta verificación.

   Para cada URL nueva de Nivel 3 (secuencial — NUNCA Playwright en paralelo):
   a. `browser_navigate` a la URL
   b. `browser_snapshot` para leer el contenido
   c. Clasificar:
      - **Activa**: título del puesto visible + descripción del rol + botón Apply/Submit/Solicitar
      - **Expirada** (cualquiera de estas señales):
        - URL final contiene `?error=true` (Greenhouse redirige así cuando la oferta está cerrada)
        - Página contiene: "job no longer available" / "no longer open" / "position has been filled" / "this job has expired" / "page not found"
        - Solo navbar y footer visibles, sin contenido JD (contenido < ~300 chars)
   d. Si expirada: registrar en `scan-history.tsv` con status `skipped_expired` y descartar
   e. Si activa: **escanear el body por `ai_signals`** (Gate 2 drill-down).
      - Si el título ya matcheó un `ai_signal` en Pasada 1 → continuar al paso 8
      - Si sólo matcheó `role_terms` en título Y el body contiene algún `ai_signal` → continuar al paso 8
      - Si sólo matcheó `role_terms` y el body NO contiene `ai_signals` → registrar como `skipped_no_ai_signal` y descartar

   **No interrumpir el scan entero si una URL falla.** Si `browser_navigate` da error (timeout, 403, etc.), marcar como `skipped_expired` y continuar con la siguiente.

8. **Para cada oferta nueva verificada que pase filtros**:
   a. Añadir a `pipeline.md` sección "Pendientes": `- [ ] {url} | {company} | {title}`
   b. Registrar en `scan-history.tsv`: `{url}\t{date}\t{query_name}\t{title}\t{company}\tadded`

9. **Ofertas filtradas por título (Gate 1 falla)**: registrar en `scan-history.tsv` con status `skipped_title`
10. **Ofertas que pasan Gate 1 pero fallan Gate 2 tras drill-down** (Software Entwickler sin señal AI/KI en título ni descripción): status `skipped_no_ai_signal`
11. **Ofertas duplicadas**: registrar con status `skipped_dup`
12. **Ofertas expiradas (Nivel 3)**: registrar con status `skipped_expired`

## Extracción de título y empresa de WebSearch results

Los resultados de WebSearch vienen en formato: `"Job Title @ Company"` o `"Job Title | Company"` o `"Job Title — Company"`.

Patrones de extracción por portal:
- **Ashby**: `"Senior AI PM (Remote) @ EverAI"` → title: `Senior AI PM`, company: `EverAI`
- **Greenhouse**: `"AI Engineer at Anthropic"` → title: `AI Engineer`, company: `Anthropic`
- **Lever**: `"Product Manager - AI @ Temporal"` → title: `Product Manager - AI`, company: `Temporal`

Regex genérico: `(.+?)(?:\s*[@|—–-]\s*|\s+at\s+)(.+?)$`

## URLs privadas

Si se encuentra una URL no accesible públicamente:
1. Guardar el JD en `jds/{company}-{role-slug}.md`
2. Añadir a pipeline.md como: `- [ ] local:jds/{company}-{role-slug}.md | {company} | {title}`

## Scan History

`data/scan-history.tsv` trackea TODAS las URLs vistas:

```
url	first_seen	portal	title	company	status
https://...	2026-02-10	Ashby — AI PM	PM AI	Acme	added
https://...	2026-02-10	Greenhouse — SA	Junior Dev	BigCo	skipped_title
https://...	2026-02-10	Ashby — AI PM	SA AI	OldCo	skipped_dup
https://...	2026-02-10	WebSearch — AI PM	PM AI	ClosedCo	skipped_expired
```

## Resumen de salida

```
Portal Scan — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Queries ejecutados: N
Ofertas encontradas: N total
Filtradas por título: N relevantes
Duplicadas: N (ya evaluadas o en pipeline)
Expiradas descartadas: N (links muertos, Nivel 3)
Nuevas añadidas a pipeline.md: N

  + {company} | {title} | {query_name}
  ...

→ Ejecuta /career-ops pipeline para evaluar las nuevas ofertas.
```

## Gestión de careers_url

Cada empresa en `tracked_companies` debe tener `careers_url` — la URL directa a su página de ofertas. Esto evita buscarlo cada vez.

**Patrones conocidos por plataforma:**
- **Ashby:** `https://jobs.ashbyhq.com/{slug}`
- **Greenhouse:** `https://job-boards.greenhouse.io/{slug}` o `https://job-boards.eu.greenhouse.io/{slug}`
- **Lever:** `https://jobs.lever.co/{slug}`
- **Custom:** La URL propia de la empresa (ej: `https://openai.com/careers`)

**Si `careers_url` no existe** para una empresa:
1. Intentar el patrón de su plataforma conocida
2. Si falla, hacer un WebSearch rápido: `"{company}" careers jobs`
3. Navegar con Playwright para confirmar que funciona
4. **Guardar la URL encontrada en portals.yml** para futuros scans

**Si `careers_url` devuelve 404 o redirect:**
1. Anotar en el resumen de salida
2. Intentar scan_query como fallback
3. Marcar para actualización manual

## Mantenimiento del portals.yml

- **SIEMPRE guardar `careers_url`** cuando se añade una empresa nueva
- Añadir nuevos queries según se descubran portales o roles interesantes
- Desactivar queries con `enabled: false` si generan demasiado ruido
- Ajustar keywords de filtrado según evolucionen los roles target
- Añadir empresas a `tracked_companies` cuando interese seguirlas de cerca
- Verificar `careers_url` periódicamente — las empresas cambian de plataforma ATS
