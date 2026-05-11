# Modo: anschreiben — Generación de Anschreiben / Cover Letter

Genera un Anschreiben (cover letter) personalizado para cada oferta, partiendo del DOCX master que ya contiene tu diseño visual, foto y firma. Per-job: copiar master → adaptar contenido vía `python-docx` → convertir a PDF con `soffice`. 1 página, A4.

## Fuentes de datos

1. **Master cover letter DOCX** (canonical — formato, foto y firma viven aquí):
   - JD en alemán → `templates/cv/Anschreiben_Gaurav_Kulkarni_DeutscheBoerse_DE.docx`
   - JD en inglés → `templates/cv/CoverLetter_Gaurav_Kulkarni_DeutscheBoerse_EN.docx`
2. **CV** → DOCX masters en `templates/cv/` (`Lebenslauf_Gaurav_Kulkarni_DE.docx` o `CV_Gaurav_Kulkarni_EN.docx`), leídos vía `python-docx` para validar proof points y métricas
3. **Perfil** → `config/profile.yml` (proof points, superpowers, exit story, contacto)
4. **Narrativa** → `modes/_profile.md` (adaptive framing, signature line, negotiation scripts)
5. **JD** → el job description actual (texto o URL ya extraída)

**Regla de idioma (CRÍTICA):** el cover letter SIEMPRE va en el mismo idioma que el JD. Nunca mezclar.

## Pipeline completo

1. Detectar idioma del JD → seleccionar master DOCX correspondiente
2. Extraer del JD:
   - Nombre de empresa y ciudad
   - Título exacto del rol
   - 3-4 requisitos clave (los más importantes del JD)
   - Equipo/división si se menciona
3. Leer el master DOCX vía `python-docx` para conocer la estructura actual de párrafos (mantenerla intacta — solo se reescribe el texto de los runs)
4. Leer `config/profile.yml` → proof points, superpowers, exit story
5. Leer `modes/_profile.md` → adaptive framing para el arquetipo detectado
6. Validar métricas leyendo el DOCX CV master correspondiente (no inventar nada que no exista ahí)
7. Copiar el master DOCX a `output/{REF}-coverletter.docx` (donde `{REF}` viene de `node lib/ref-code.mjs generate "{company}" "{role}"`)
8. Editar el copy de `output/{REF}-coverletter.docx` con `python-docx`:
   - Swap del destinatario (empresa, equipo, ciudad, fecha)
   - Reescribir los párrafos del cuerpo (estructura abajo) reemplazando el texto de los runs existentes — **no insertar ni borrar párrafos**, no tocar foto, firma, fuentes, márgenes, espaciado ni tablas
9. Convertir a PDF: `soffice --headless --convert-to pdf --outdir output output/{REF}-coverletter.docx`
10. Output final: `output/{REF}-coverletter.pdf`
11. Reportar: ruta del PDF, código de referencia, idioma

## Estructura del cuerpo (5 bloques)

El master DOCX ya contiene un esqueleto de cinco bloques. Reescribir el texto de cada bloque manteniendo párrafo-por-párrafo el mapeo:

**Bloque 1 — Gancho de apertura (1-2 frases)**
- Adaptar el gancho a ESTA empresa
- Memorable, concreto, establece identidad inmediatamente
- Referencia (DE): "bei IONOS schätzte man mich als den 'AI guy'..." — adaptar al contexto del nuevo JD
- NO usar genéricos ("Hiermit bewerbe ich mich...", "Mit großem Interesse...")

**Bloque 2 — Transición al matching (1 frase)**
- Puente entre el gancho y el mapeo de requisitos
- Referencia (DE): "Damit ich nicht nur behaupte... habe ich Ihre Anforderungen direkt mit meinen Erfahrungen abgeglichen"

**Bloque 3 — Mapeo requisito → proof point (3 bullets)**
- Cada bullet empieza con **"Sie suchen/fordern/brauchen [requisito del JD]:"** (en negrita)
- Seguido de tu experiencia concreta que mapea a ese requisito
- Usar métricas reales del DOCX CV master + `config/profile.yml` proof_points
- NUNCA inventar métricas o experiencia que no exista en los DOCX masters

**Bloque 4 — Motivación + Win-Win (2-3 frases)**
- Por qué esta empresa específicamente (investigar brevemente si es necesario)
- Framing "Win-Win": ellos obtienen X expertise, tú obtienes Y crecimiento

**Bloque 5 — Cierre (1-2 frases)**
- Cierre confiado pero no arrogante
- Si JD en alemán: "Mit freundlichen Grüßen,"
- Si JD en inglés: "Best regards,"

## Reglas de tono

- **Voz del master:** Leer el master cover letter DOCX y MANTENER el mismo nivel de confianza, directness, y personalidad. No diluir.
- **Formal pero no rígido:** En alemán, usar "Sie" siempre. Permitir expresiones directas ("Builder-Mentalität", "Win-Win-Lösung").
- **Concreto > genérico:** Cada frase debe tener un dato específico (nombre de proyecto, métrica, tecnología). Sin relleno.
- **1 página máximo.** Si el contenido es demasiado largo, cortar el bloque 4 primero, luego reducir a 2 bullets en bloque 3.

## Edición DOCX — qué tocar y qué NO

**Editable (vía `python-docx`, reemplazando texto de runs en su lugar):**
- Línea de destinatario: empresa, equipo, dirección, ciudad
- Fecha
- Línea de asunto / Subject ("Bewerbung als {rol}" DE / "Application for {rol}" EN)
- Saludo ("Sehr geehrte Damen und Herren," DE / "Dear Hiring Team," EN)
- Cuerpo: bloques 1-5
- Sign-off ("Mit freundlichen Grüßen," DE / "Best regards," EN)

**Intocable:**
- Foto, firma, anchors de imágenes
- Fuentes, tamaños, colores, negritas, cursivas (mantener formato de cada run)
- Estructura de párrafos / número de párrafos del cuerpo
- Tablas, márgenes, espaciado, headers/footers
- Hyperlinks pre-existentes (LinkedIn, portfolio, etc.)

Si necesitás un párrafo más o menos del que tiene el master, ajustar la cantidad de líneas dentro del párrafo existente — no insertar/borrar nodos `<w:p>`.

## Checklist final

- [ ] Master DOCX correcto seleccionado por idioma del JD
- [ ] `output/{REF}-coverletter.docx` creado, formato/foto/firma intactos
- [ ] Voz del master preservada (no genérica)
- [ ] Exactamente 3 bullets en bloque 3 (mapeo requisito → proof point)
- [ ] Métricas reales del DOCX CV master / `article-digest.md` (no inventadas)
- [ ] 1 página (no más)
- [ ] Nombre de empresa, rol, asunto y saludo correctos
- [ ] Código de referencia ({REF}) en el nombre del PDF
- [ ] PDF generado vía `soffice --headless --convert-to pdf` en `output/{REF}-coverletter.pdf`
