# Modo: anschreiben — Generación de Anschreiben / Cover Letter

Genera un Anschreiben (cover letter) personalizado para cada oferta, con el mismo diseño visual que el CV. Siempre 1 página, formato A4.

## Fuentes de datos

1. **Master cover letter** → seleccionar según idioma del JD:
   - JD en alemán → leer `cover-letter.de.md` (voz y tono de referencia)
   - JD en inglés → leer `cover-letter.md`
   - (o usar `language.sources.cover_letter` de `config/profile.yml`)
2. **CV** → `cv.de.md` o `cv.md` (según idioma)
3. **Perfil** → `config/profile.yml` (proof points, superpowers, exit story)
4. **Narrativa** → `modes/_profile.md` (adaptive framing, signature line, negotiation scripts)
5. **JD** → el job description actual (texto o URL ya extraída)

## Pipeline completo

1. Detecta idioma del JD → selecciona master cover letter + CV en el mismo idioma
2. Lee el master cover letter como **referencia de voz y estructura** (NO copiar textualmente — adaptar)
3. Extrae del JD:
   - Nombre de empresa y ciudad
   - Título exacto del rol
   - 3-4 requisitos clave (los más importantes del JD)
   - Equipo/división si se menciona
4. Lee `config/profile.yml` → proof points, superpowers, exit story
5. Lee `modes/_profile.md` → adaptive framing para el arquetipo detectado
6. Genera el contenido del Anschreiben siguiendo esta estructura:

### Estructura del Anschreiben (5 bloques)

**Bloque 1 — Gancho de apertura (1-2 frases)**
- Reescribir el gancho del master adaptado a ESTA empresa
- Debe ser memorable, concreto, y establecer tu identidad inmediatamente
- Referencia: en el master es "bei IONOS schätzte man mich als den 'AI guy'..." — adaptar al contexto del nuevo JD
- NO usar frases genéricas ("Hiermit bewerbe ich mich...", "Mit großem Interesse...")

**Bloque 2 — Transición al matching (1 frase)**
- Conectar el gancho con el mapeo de requisitos
- Referencia: en el master es "Damit ich nicht nur behaupte... habe ich Ihre Anforderungen direkt mit meinen Erfahrungen abgeglichen"

**Bloque 3 — Mapeo requisito → proof point (3 bullets)**
- Cada bullet empieza con **"Sie suchen/fordern/brauchen [requisito del JD]:"** (en negrita)
- Seguido de tu experiencia concreta que mapea a ese requisito
- Usar métricas reales de `config/profile.yml` proof_points (81% recall, 30% QA reduction, etc.)
- Referencia: en el master los 3 bullets mapean LLMs/Vector DBs, Python/FastAPI, DevSecOps
- NUNCA inventar métricas o experiencia que no exista en cv.md / cv.de.md

**Bloque 4 — Motivación + Win-Win (2-3 frases)**
- Por qué esta empresa específicamente (investigar brevemente si es necesario)
- Framing "Win-Win": ellos obtienen X expertise, tú obtienes Y crecimiento
- Referencia: en el master es "Das ist eine Win-Win-Lösung: Sie erhalten... und ich kann..."

**Bloque 5 — Cierre (1-2 frases)**
- Cierre confiado pero no arrogante
- Referencia: en el master es "Ich bin zuversichtlich, dass Sie das Gesicht dazu kennenlernen möchten"
- Si JD en alemán: "Mit freundlichen Grüßen,"
- Si JD en inglés: "Best regards,"

### Reglas de tono

- **Voz del master:** Leer el master cover letter y MANTENER el mismo nivel de confianza, directness, y personalidad. El candidato tiene una voz fuerte — no la diluyas.
- **Formal pero no rígido:** En alemán, usar "Sie" siempre. Pero permitir expresiones directas ("Builder-Mentalität", "Win-Win-Lösung").
- **Concreto > genérico:** Cada frase debe tener un dato específico (nombre de proyecto, métrica, tecnología). Sin relleno.
- **1 página máximo.** Si el contenido es demasiado largo, cortar el bloque 4 primero, luego reducir a 2 bullets en bloque 3.

## Generación del PDF

7. Lee `templates/cover-letter-template.html`
8. Obtén datos de contacto de `config/profile.yml`:
   - `{{NAME}}` = `candidate.full_name`
   - `{{EMAIL}}` = `candidate.email`
   - `{{PHONE}}` = `candidate.phone`
   - `{{LINKEDIN_URL}}` = `https://www.linkedin.com/in/` + linkedin handle
   - `{{LINKEDIN_DISPLAY}}` = linkedin handle
   - `{{PORTFOLIO_URL}}` = `candidate.portfolio_url`
   - `{{PORTFOLIO_DISPLAY}}` = portfolio domain
   - `{{LOCATION}}` = `candidate.location`
   - `{{LOCATION_SENDER}}` = ciudad del candidato (ej: "Leonberg")
9. Rellena campos del template:
   - `{{LANG}}` = `de` o `en`
   - `{{COMPANY_NAME}}` = nombre de la empresa
   - `{{COMPANY_TEAM}}` = "Recruiting Team" o equipo específico del JD
   - `{{COMPANY_CITY}}` = ciudad de la empresa
   - `{{DATE}}` = fecha actual en formato local (DE: "12. April 2026", EN: "April 12, 2026")
   - `{{SUBJECT}}` = "Bewerbung als {rol}" (DE) o "Application for {rol}" (EN)
   - `{{SALUTATION}}` = "Sehr geehrte Damen und Herren," (DE) o "Dear Hiring Team," (EN)
   - `{{BODY}}` = bloques 1-4 como HTML (`<p>` para párrafos, `<ul><li>` para bullets)
   - `{{REGARDS}}` = "Mit freundlichen Grüßen," (DE) o "Best regards," (EN)
10. Escribe HTML a `/tmp/anschreiben-{REF}.html`
    - `{REF}` = código de referencia de `lib/ref-code.mjs`
11. Ejecuta:
    ```bash
    node generate-pdf.mjs /tmp/anschreiben-{REF}.html output/{Candidate_Name}_Anschreiben_{REF}.pdf --format=a4
    ```
    (o `{Candidate_Name}_CoverLetter_{REF}.pdf` si JD en inglés)
    `{Candidate_Name}` = `candidate.full_name` con espacios → underscores
12. Reporta: ruta del PDF, código de referencia, idioma

## Checklist final

- [ ] Voz del master preservada (no genérica)
- [ ] Exactamente 3 bullets en bloque 3 (mapeo requisito → proof point)
- [ ] Métricas reales (no inventadas)
- [ ] 1 página (no más)
- [ ] Mismo diseño visual que el CV (fonts, colores, header)
- [ ] Nombre de empresa y rol correctos en subject line
- [ ] Código de referencia ({REF}) en el nombre del archivo
- [ ] PDF generado con `--format=a4`
