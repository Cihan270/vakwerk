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
6. Zeg de gebruiker: op de iPad → Vakwerk → **Importeer** → Bestanden → OneDrive → Vakwerk → bestand kiezen.

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

- `id` moet stabiel zijn: opnieuw importeren werkt het item bij (voortgang van flashcards en afgevinkte opdrachten blijft bewaard).
- `subject` wordt gekoppeld aan een vak in de app op naam of op "Naam in Canvas" (aliassen). Onbekende vakken vraagt de app om te koppelen of aan te maken.
- `due` is lokale tijd `YYYY-MM-DDTHH:MM`.

## Ontwikkelen

- Lokaal testen: `node tools/serve.mjs` → http://localhost:5173 (service worker staat uit op localhost).
- Iconen opnieuw maken: `node tools/make-icons.mjs`.
- Bij een release: verhoog `VERSION` in `sw.js`, anders krijgt de iPad de nieuwe versie niet.
- Opbouw: `js/app.js` (router), `js/views.js` (schermen), `js/editor.js` (inkt-editor), `js/ink.js` (tekenen/geometrie/gebaren), `js/db.js` (IndexedDB), `js/pack.js` (import/back-up), `js/srs.js` (spaced repetition), `js/markdown.js`.
