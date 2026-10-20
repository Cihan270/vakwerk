# Vakwerk — instructies voor Claude

Vakwerk is een PWA (vanilla JS, geen build-stap) voor iPad + Apple Pencil. Alle data staat lokaal in IndexedDB op de iPad.
Claude levert samenvattingen aan via een **pakketbestand** dat de gebruiker in de app importeert.

## Workflow: "maak de colleges van vandaag klaar"

1. Open Canvas van de UT (`https://canvas.utwente.nl`) in de ingebouwde browser. De gebruiker logt zelf in (UT-login/2FA); vul nooit wachtwoorden in.
2. Bepaal welke colleges vandaag zijn: vraag de gebruiker, of kijk in de Canvas-agenda / Modules van de vakken.
3. Zoek per vak de slides van het college van vandaag (Modules → week/lecture, of Files). Vraag toestemming voor elke download (bestandsnaam + vak).
4. Lees de slides en schrijf per college:
   - `summary`: Markdown-samenvatting (kopjes `##`, lijstjes, **vet**, `==markeren==`, tabellen). Kernpunten, formules, voorbeelden, tentamentips. Geen letterlijke lappen tekst uit de slides overnemen.
   - `terms`: begrippenlijst (term + korte uitleg) → worden automatisch flashcards.
   - `questions`: tentamenachtige oefenvragen met uitgewerkt antwoord → ook flashcards.
   - `assignments`: openstaande Canvas-opdrachten van dat vak met deadline (optioneel).
5. Schrijf het pakket naar `C:\Users\Remzi\OneDrive\Vakwerk\vakwerk-YYYY-MM-DD.json` (map aanmaken als die niet bestaat).
6. **Inbox bijwerken** (zo komt het vanzelf op de iPad): voeg de nieuwe items/plan-blokken samen met het vorige
   inbox-pakket (`OneDrive\Vakwerk\vakwerk-inbox-bron.json`, samenvoegen op `id` — de inbox moet cumulatief blijven,
   want een nieuw gekoppeld apparaat krijgt alleen wat erin staat), schrijf dat terug, en versleutel:
   `node tools/make-inbox.mjs <bron.json> C:\Users\Remzi\OneDrive\Vakwerk\.inbox-sleutel.json`.
   Commit + push `inbox/*.json`. De app haalt het op zodra de gebruiker hem opent. Het sleutelbestand nooit in de repo zetten.
   **Artifact-versie** (https://claude.ai/artifact/JiLbFoZxwcpkfcdLSx4uhQ): schrijf met ArtifactData een document
   `inbox/<id>` met `{ pack: "<pakket als JSON-string>", created }`; de app importeert het bij openen.
7. Zonder inbox: op de iPad → Vakwerk → **Importeer** → Bestanden → OneDrive → Vakwerk → bestand kiezen.

## Pakketformaat (`vakwerk-pakket`, versie 1)

```json
{
  "type": "vakwerk-pakket",
  "version": 1,
  "created": "2026-10-16T08:00:00+02:00",
  "items": [
    {
      "id": "calculus1a-2026-10-16-lecture5",
      "subject": "Calculus 1A",
      "date": "2026-10-16",
      "title": "Lecture 5 — Partiële afgeleiden",
      "sources": ["Lecture 5 - Partial derivatives.pdf"],
      "summary": "## Kern\n- ...",
      "terms": [{ "term": "Gradiënt", "definition": "..." }],
      "questions": [{ "question": "...", "answer": "..." }],
      "assignments": [{ "id": "canvas-123456", "title": "Homework 3", "due": "2026-10-20T23:59", "notes": "", "url": "https://canvas.utwente.nl/courses/.../assignments/123456" }]
    }
  ]
}
```

### Studieplanning (optioneel, in hetzelfde pakket)

```json
{
  "planTitle": "Tentamenplanning Q1",
  "planNotes": ["**Di 20 okt**: ga naar het OT-college …"],
  "plan": [
    { "id": "q1-2026-10-16-0", "date": "2026-10-16", "slot": 0, "kind": "study", "subject": "Calculus A",
      "title": "3.8 + 3.9 Inverse functies", "details": "3.8: 7; p.212: 1, 4 | 9, 21", "important": "4.3 #33" },
    { "id": "q1-2026-10-28-1", "date": "2026-10-28", "slot": 1, "kind": "exam", "subject": "Organization Theory",
      "title": "Tentamen Organization Theory 13:45–15:15", "details": "NH 205 / NH 207 · Chromebook" }
  ]
}
```

### Sets flitskaarten (optioneel)

Een item met `deck` en zonder `summary` wordt alleen een set flitskaarten (geen samenvatting). In de app staat elke set
onder Vak › Oefenen › **Per set leren**; "Alles door elkaar" oefent alle kaarten van het vak gehusseld.

```json
{ "id": "ot-flits-s3", "subject": "Organization Theory", "deck": "Sessie 3 · Systems & contingency theory", "order": 1,
  "sources": ["Lecture 3 OT Woo_2026 Sept.pdf"], "terms": [{ "term": "Holism", "definition": "..." }] }
```

- Optioneel `subjects: [{ name, color, aliases }]` bovenaan het pakket: die vakken worden zonder vraag aangemaakt (of hun Canvas-namen aangevuld).
- **Inhalen** (`js/planner.js`): niet-afgevinkte studieblokken van eerdere dagen schuiven bij het openen van de app door naar de volgende momenten van hetzelfde vak, vóór dat vak's tentamen; "Vrij"-blokken worden opgeofferd (dag vóór een tentamen als laatste). Doorgeschoven items krijgen `movedFrom`; een nieuwe import laat die plek staan.
- **Planning vervangen**: `replacePlan: [{ "subject": "Calculus A", "from": "2026-10-19" }]` haalt (na bevestiging) de niet-afgevinkte studieblokken van dat vak vanaf die datum weg, ook doorgeschoven blokken. Gebruik dan nieuwe `id`'s voor de nieuwe blokken.
- `slot`: 0 = ochtend, 1 = middag, 2 = avond. `kind`: `study` (afvinkbaar), `class`, `exam` (geeft een aftelkaart op het dashboard), `rest`.
- Persoonlijke planningen horen in OneDrive, **niet** in deze (publieke) repo. Lokaal testen kan via `.local-test/` (staat in .gitignore).

- `id` moet stabiel zijn: opnieuw importeren werkt het item bij (voortgang van flashcards en afgevinkte opdrachten blijft bewaard).
- `subject` wordt gekoppeld aan een vak in de app op naam of op "Naam in Canvas" (aliassen). Onbekende vakken vraagt de app om te koppelen of aan te maken.
- `due` is lokale tijd `YYYY-MM-DDTHH:MM`.

## Ontwikkelen

- Lokaal testen: `node tools/serve.mjs` → http://localhost:5173 (service worker staat uit op localhost).
- Iconen opnieuw maken: `node tools/make-icons.mjs`.
- Bij een release: verhoog `VERSION` in `sw.js`, anders krijgt de iPad de nieuwe versie niet.
- Opbouw: `js/app.js` (router), `js/views.js` (schermen), `js/editor.js` (inkt-editor), `js/ink.js` (tekenen/geometrie/gebaren), `js/db.js` (IndexedDB), `js/pack.js` (import/back-up), `js/pdf.js` (slides importeren via pdf.js van cdnjs, alleen bij importeren online), `js/srs.js` (spaced repetition), `js/markdown.js`.
- Afbeeldingen en slides: `page.images = [{ id, asset, x, y, w, h, lock? }]` in pagina-eenheden; de blob staat in store `assets` (per notitie). `lock` = slide, niet verschuifbaar.
