# Bewerbungs-Autofill (Hybrid: Regeln + Gemini)

Schlanke Chrome-Erweiterung, die Bewerbungsformulare mit einem Klick ausfuellt.
**Pass 1** (Regeln, sofort, kostenlos) + **Pass 1b** (Gelerntes pro Portal) + **Pass 2** (Gemini fuer Restfelder/Freitext).
Sendet **nie** automatisch ab — du pruefst und klickst selbst „Absenden".

## Aufbau
```
job-autofill/
  extension/   Chrome-Erweiterung (Manifest V3), rein clientseitig, kein Key
  backend/     Mini-Server: ruft Gemini auf (Key sicher) + Ref/PDF-Finder aus career-ops
```

## Setup

### 1. Backend
```bash
cd backend
cp .env.example .env      # GEMINI_API_KEY eintragen (Key: https://aistudio.google.com/apikey)
npm install
npm start                 # http://localhost:8787
```
Der `/ref`-Finder liest `career-ops/data/ref-map.tsv` (Pfad via `CAREER_OPS_DIR`, Standard: das career-ops-Root `../..`).

### 2. Extension
1. `chrome://extensions` -> Entwicklermodus an -> „Entpackte Erweiterung laden" -> Ordner `extension/`.
2. Icon -> „Profil bearbeiten": das Profil ist mit Platzhaltern (`Max Mustermann`) vorbefuellt. Trage deine echten Daten ein (Name, Adresse, Nationalitaet, Gehalt, Start, Sprachen, Jahre-Erfahrung, DSGVO-Defaults) -> Speichern.
   Alternativ: `extension/profile.local.json` anlegen (gitignored) - die Datei wird automatisch statt der Platzhalter geladen.

## Nutzung
1. **Scannen** — findet Felder; fuellt Bekanntes per Regel + Gelerntem; zeigt Review-Liste (Quelle: Regel / Gelernt / Gemini / Korrektur).
2. **KI-Restfelder** — Gemini fuellt offene/Freitext-Felder (Backend muss laufen).
3. **Ausfuellen** — schreibt die geprueften Werte ins Formular **und lernt** sie fuer dieses Portal.
4. **Bewerbung finden** — Firmenname eingeben -> zeigt `Ref XXXX`, den Status aus `applications.md` und die **tatsaechlich vorhandenen** PDFs.
5. **Dokumente anhaengen** — haengt Lebenslauf, Anschreiben und Zertifikate direkt in die Upload-Felder.

Jeder Wert ist vor dem Ausfuellen editierbar.

## Die drei „intelligenten" Teile
- **Profil aus career-ops** — eine Wahrheit; die KI erfindet nichts, was nicht im Profil steht (nutzt `yearsOfExperience`, `languages`, `privacyConsent`/`marketing` etc.).
- **Lernen aus Korrekturen** — beim Ausfuellen wird `(Portal-Host, Label) -> Wert` gespeichert; beim naechsten Besuch desselben Portals sitzt es sofort (Quelle „Gelernt", ueberschreibt Regeln).
- **Ref/PDF-Erkennung** — zuerst ueber die **URL der offenen Seite** (exakt, aus `data/pipeline.md`), sonst ueber den Firmennamen gegen `ref-map.tsv` + `data/applications.md`. Liefert Status und die real existierenden PDFs.

## Welche Bewerbung ist das? (Ref-Erkennung)

Die Ref (4 Zeichen) entscheidet allein, welche PDFs angehaengt werden — `resolveDoc`
bekommt nichts ausser ihr. Sie wird in dieser Reihenfolge bestimmt:

1. **URL der offenen Seite** — `data/pipeline.md` speichert die Job-URL pro Ref.
   Portale mit eigener Job-ID (LinkedIn, Xing, Arbeitsagentur, Indeed, softgarden,
   Personio) werden auf `linkedin:4448849227` o.ae. normalisiert, alles andere auf
   `host/pfad?relevante-parameter`. Tracking-Parameter (`utm_*`, `trk`, `refId`, …)
   fliegen raus, `www.` ebenfalls — dieselbe Stelle wird also auch aus einer
   LinkedIn-Suchergebnis-URL wiedererkannt. Mehrfach ausgeschriebene Stellen
   ("duplicate of #NN") werden unter **allen** ihren URLs indiziert.
2. **Firmenname aus dem Seitentitel** — nur wenn die URL unbekannt ist. Der Titel wird
   an `" | "` / `" - "` getrennt (nicht an Bindestrichen *innerhalb* von Namen, sonst
   wird aus „MD-IT GmbH" ein „MD"), Portalnamen werden verworfen, und ein Segment mit
   Rechtsform (GmbH, AG, SE, …) gewinnt gegen die Position. Greift nur bei **eindeutigem**
   Treffer, sonst fragt das Popup nach.
3. **Manuell** — Firmenname oder Ref-Code eintippen, „übernehmen".

Das Popup schreibt dazu, woher die Zuordnung kam: `(per URL ✓)` ist exakt,
`(aus Seitentitel geraten - bitte pruefen)` nicht.

Die zuletzt gewaehlte Bewerbung wird **pro Seite** gemerkt, nicht pro Host. (Vorher pro
Host: eine auf einem LinkedIn-Job gesetzte Ref galt damit fuer *alle* LinkedIn-Jobs und
hing den falschen Lebenslauf an.)

## Dokumenten-Aufloesung

Welche Datei an welchen Slot geht, steht **nicht im Code**, sondern in
`backend/docs-catalog.local.json` (gitignored; Vorlage: `docs-catalog.example.json`).
Jeder Eintrag listet **Kandidaten in Prioritaetsreihenfolge** — genommen wird der erste,
der wirklich existiert:

```json
"cv":          { "perRef": ["{REF}_LEBENSLAUF.pdf", "{REF}_CV.pdf"] },
"zertifikate": { "files":  ["Zertifikate_compressed.pdf",
                            "Zertifikate.pdf"] }
```

- `perRef` wird gegen `output/` aufgeloest, `{REF}` durch den Ref-Code ersetzt.
  Deutsche Bewerbungen heissen `{REF}_LEBENSLAUF.pdf`, englische `{REF}_CV.pdf` —
  beide Muster werden probiert.
- `files` wird gegen `Job Application Documents (1)/` aufgeloest. Die **komprimierte**
  Fassung steht vorn, damit nicht die 5,8-MB-Datei hochgeht, wenn es eine 1,6-MB-Version gibt.
- Existiert kein Kandidat, liefert `/file` einen klaren 404 mit Dateinamen statt still zu scheitern.

Das Popup zeigt bei jedem Anhang die Quelldatei und ihre Groesse, z.B.
`✓ Zertifikate_Max_Mustermann.pdf 1558 KB -> "Zeugnisse"  [Zertifikate_compressed.pdf]`.

## Bewusste Grenzen (ehrlich)
- **Unspezifische Upload-Slots bleiben leer.** Labels wie „Anlagen", „weitere Dokumente" oder „Attachment" sagen nichts ueber den Inhalt — dort wird bewusst nichts geraten, sonst haengt die falsche Datei drin und die Seite muss neu geladen werden.
- **Kein Auto-Submit** (bewusst). **Heavy-SPAs (Workday)/iframes** brauchen spaeter Portal-Adapter.

## Naechste Ausbaustufen
- Portal-Adapter (Personio, softgarden, SuccessFactors, d.vinci).
- Firmen-Erkennung direkt aus der Job-Seite (statt Tippen).
