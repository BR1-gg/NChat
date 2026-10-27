# Specification deviations and implementation notes

This file records intentional differences, resolved ambiguities, and environment-dependent verification limits.

## Resolved specification ambiguities

1. **Application location**
   - The engineering spec shows the app at the workspace root and says to keep `SPEC/` there.
   - The user explicitly requested all implementation work in a subfolder.
   - Resolution: the original `SPEC/` directory remains untouched and the app is implemented in `NCHAT/`.

2. **Requirements file format**
   - The user requested reading every `.txt` file, but the workspace contains no `.txt` files.
   - The ten Markdown files under `SPEC/` are the explicit source of truth and were all read in numeric order.

3. **First-byte timeout**
   - `05-lm-studio-api.md §8` specifies 30 seconds, while its client sketch and `08-quality.md` use 40 seconds.
   - Resolution: the implementation uses **30 seconds**, matching the API behavior table.

4. **Resolved generation parameter type**
   - TypeScript's `Required<GenerationParams>` does not remove `null` from `temperature` and `topP`.
   - Resolution: `ResolvedGenerationParams` explicitly models resolved temperature/top-p as numbers. Wire behavior still follows the spec: null/unset maximum tokens are omitted.

5. **Run index after deleting siblings**
   - `04-graph-execution.md` requires run indices never to be reused, while the normalization section describes recomputing only from current siblings.
   - Resolution: normalization preserves the larger stored `prompt.runCount`, so deleting the last sibling does not reuse an index.

6. **Proxy connection errors**
   - A Vite proxy reports a refused LM Studio server as HTTP 502 in the browser.
   - Resolution: proxy-mode 502/503/504 responses are mapped to the user-facing `OFFLINE` error instead of `SERVER_ERROR`.

7. **Static-build proxy**
   - The Vite proxy exists only in development.
   - Resolution: the Settings dialog displays a production warning when proxy mode remains enabled, and the Help tab documents direct-mode CORS or an external proxy.

## Scope decisions

- Note nodes, auto-layout, and import merge are included even though the roadmap also labels some of them as stretch work. They are explicitly represented in the data/UI specs.
- Undo/redo and multi-workspace navigation remain out of scope because the product spec marks them P3.
- No backend, authentication, cloud synchronization, analytics, or external model providers were added.

## Type additions

`AppErrorKind` includes the spec-required `ABORTED` addition and two explicit local-storage/internal categories used by the shared error UI. No unknown error shape reaches React components.

## Verification status

Automated checks completed:

- Strict TypeScript project check
- 40 Vitest tests
- Vite production build
- Development-browser smoke test: application mount, node palette insertion, prompt editing, disabled/enabled Run state, and visible `NO_MODEL` error-node creation
- Markdown XSS smoke/unit test
- Grep check that `dangerouslySetInnerHTML` is absent

Environment-dependent checks not executable in this workspace:

- A real streamed completion, because no LM Studio server/model was available
- The 150-node/50-fps manual performance benchmark
- LM Studio-specific CORS and model-loading UI flows
- The full 15-item manual E2E checklist from `08-quality.md`

The coverage command currently reports approximately 61% statements / 51% branches across all loaded source files. Critical paths are stronger (`assemble.ts`: 96% statements / 82% branches; `sse.ts`: 89% / 86%). This is below the spec's aspirational 100% branch target for all pure logic, although every explicitly enumerated logic, SSE, persistence, store, and XSS test case is present and green.

The current production build is approximately 825 kB minified (about 253 kB gzip) and Vite reports a chunk-size advisory. Streaming updates are throttled to one store write per 60 ms and node components use narrow Zustand selectors, but a production performance measurement remains a manual acceptance item.

---

# v2 - Nove nuove funzionalita

## Fase 0 - fondazione

- `DOC_VERSION` passa a `2`. La migrazione `1 -> 2` sposta `style.width` delle note
  in `node.width` ed e idempotente (`src/persistence/migrations.ts`).
- `Settings` e ora la vista unificata di `AppSettings` (globali) e
  `WorkspaceSettings` (per workspace). La serializzazione v2 scrive in `documents`
  solo i campi per-workspace; le impostazioni globali vivono in
  `appState.appSettings`. Il campo `settings` unificato resta in memoria per non
  dover riscrivere tutta la UI: e una scelta di compatibilita, non il formato su disco.
- `src/store/workspaceStore.tsx` espone `createWorkspaceStore(id, doc)` piu
  `WorkspaceStoreProvider` / `useWorkspace` / `useWorkspaceStoreApi`. Ogni tab
  possiede il proprio store e la propria istanza di React Flow. Resta un facade
  `useWorkspaceStore` che risolve lo store attivo: i file non ancora convertiti
  continuano a funzionare, ma le azioni nuove ricevono lo store esplicito.
- `src/store/workspaceRegistry.ts` possiede la mappa degli store, lo store attivo e
  la chiusura. `src/nodes/registry.ts` e il registro unico dei tipi nodo
  (componente, limiti di resize, meta, ordine palette, regole contesto).
  `src/nodes/specs.ts` contiene solo i limiti di dimensione, senza componenti, per
  evitare cicli di import.

## Persistenza Dexie

- `src/persistence/db.ts` + `repository.ts`: tabella `workspaces` (metadati
  leggeri, nessun documento caricato in Home), `documents`, `appState`, `snapshots`.
- `WorkspaceRepository` ha implementazione IndexedDB e fallback in memoria;
  `createRepository()` prova ad aprire Dexie e degrada senza bloccare l'avvio.
- Conflitti ottimistici per revisione: `save(id, doc, baseRevision)` rifiuta con
  `{ conflict: true, currentRevision }`. `WorkspaceConflictDialog` offre
  reload / overwrite / save as copy.
- Ogni tab ha un `REPOSITORY_CLIENT_ID`: i messaggi `BroadcastChannel` inviati
  dalla stessa tab vengono ignorati, altrimenti ogni salvataggio apriva un falso
  dialog di conflitto.
- Migrazione da `localStorage` idempotente e con rollback: la chiave originale
  viene rinominata in `nchat.legacy.*` solo dopo la scrittura andata a buon fine.

## Router, Home, tab

- Routing hash: `#/` = Home, `#/w/<id>` = workspace. All'avvio si parte sempre da
  Home; le tab precedenti si ripristinano se `reopenTabsOnStartup`.
- Un deep link `#/w/<id>` apre sempre una tab visibile, anche a freddo.
- Eliminati dalla tab gli archi `run`: il legame prompt -> response e implicito e
  derivato da `parentPromptId`.

## Model Manager - comportamento verificato sul server installato

Endpoint verificati direttamente su LM Studio 0.3.29 (`http://localhost:1234`):

- `GET /api/v1/models` risponde 200 (v1 nativo, livello `native-v1`).
- `GET /api/v0/models` risponde 200 (livello `beta-v0`).
- `GET /api/v1/version` risponde 404: non esiste, il prompt lo dava per esistente.

Tre dettagli non deducibili dalla specifica, trovati sul server reale:

1. **`loaded_instances` non e sempre un array.** Con un solo modello in memoria
   arriva un oggetto singolo, non `[...]`; vuoto arriva `{}`. Il parser accetta ora
   tutte e tre le forme (array, oggetto, stringa). Prima di questo fix ogni modello
   risultava `not-loaded`.
2. **`POST /api/v1/models/load` non risponde mai per un modello gia in memoria**
   (verificato: 21 s di attesa, poi timeout). Per questo `ensureLoaded` interroga
   sempre il server prima di caricare, e `loadModel` fa polling parallelo: se il
   modello diventa residente mentre il POST e in volo, il client interrompe
   l'attesa e prosegue.
3. Con il fallback OpenAI-only il "load" e un warm-up da 1 token con timeout breve,
   non `modelLoadTimeoutMs`: quel valore vale solo per il caricamento nativo.

## Reasoning model: il caso reale che ha rotto la UI

`qwen3.5-9b-ultra-uncensored-heretic` e un reasoning model. In streaming invia
`delta.reasoning_content` e solo dopo `delta.content`. Conseguenze riscontrate:

- Il parser SSE ignorava `reasoning_content`, quindi la risposta salvata era
  **vuota** mentre le statistiche riportavano 1000+ token generati. Sembrava un
  blocco di LM Studio, in realta era un parser che scartava il payload.
- Con `max_tokens: 1024` il modello consuma l'intero budget in ragionamento e non
  emette mai la risposta visibile. L'app non deve fingere che sia andato tutto bene:
  se il testo finale e vuoto ma esiste del reasoning, il nodo passa a `error` con
  `BAD_RESPONSE` e suggerisce di alzare `Max output tokens`.
- `reasoning` e un campo separato su `ResponseNodeData`: non viene mai mescolato
  alla risposta, non viene mai reinviato come contesto, ed e persistito. La UI lo
  mostra in una sezione "Thinking" collassabile, aperta automaticamente quando non
  c'e una risposta da leggere.
- Lo stato passava a `streaming` solo al primo `onChunk`. Con uno stream composto
  solo di reasoning restava `queued` per tutta la generazione: ora la transizione
  avviene al primo segnale qualsiasi (`markStreaming`).

## Coda

- `src/queue/runQueue.ts` e un servizio singleton: FIFO, concorrenza da
  `AppSettings.queueConcurrency` (1-4), dipendenze per id di response, pause
  esplicita e ripresa, deduplicazione delle promise per job.
- Il nodo response viene creato **immediatamente** in stato `queued`; l'attesa e
  solo dentro il job, quindi la progressione visibile e continua.
- Un errore di infrastruttura (offline, modello assente) mette in pausa la coda
  invece di far fallire in silenzio i job successivi.
- `clearQueue()` non tocca i job in esecuzione: sono gia partiti e hanno un nodo
  response da portare a termine.

## Set, Output, Summary, compattazione

- Aggregazione: `logic/aggregation/registry.ts` (adapters prompt/response/summary/set,
  con appiattimento ricorsivo e rilevamento cicli) + `strategies.ts`
  (sections/numbered/json). L'output usa lo stesso motore.
- Nell assemblaggio il testo di un Set entra **dentro l unico messaggio user** del
  prompt target, come richiesto dalla specifica: nessuna coppia di user consecutivi.
- Un Summary e un punto di taglio: il suo testo viene unito al solo messaggio
  `system` con l intestazione `## Summary of the earlier conversation` e gli antenati
  non vengono risaliti.
- `/compact` e gestito come comando testuale all inizio del prompt. Il piano di
  rilink non distruttivo e in `logic/compact.ts` (`planSummaryRelink` conserva gli id
  degli archi originali); l'azione applica il piano e offre Undo con ripristino dei link.
- Nota: `coveredNodeIds` e calcolato per confronto del testo dei messaggi, quindi non
  e un riferimento d aquila esatto ma un insieme di nodi candidati. Da rifinire se
  serve la verifica di integrita puntuale.

## Ritaglio dichiarato

Non implementati, e il prompt li marca come stretch: benchmark 150 nodi/50 fps, coda
multi-modello con `maxParallel`, `copyAllRequestsToClipboard`, sistema di
plugin/worker sandbox, e il pannello impostazioni con schede separate per
Auto-layout/Export/Reset. La coda resta deliberatamente single-model (LM Studio
serializza comunque le richieste su un modello) con concorrenza esposta da 1 a 4 per
chi usa piu slot in parallelo.

## Stato dei controlli

- typecheck pulito, 65 test Vitest verdi, build Vite ok, lint con 0 errori e 9 warning
  (8 `only-export-components`, 1 `set-state-in-effect`).
- Verifica end-to-end reale su LM Studio: caricamento modello senza blocco, streaming
  con reasoning separato dalla risposta, risposta finale persistita e ricaricata
  correttamente dopo reload.
- Il bundle e cresciuto a circa 997 kB minificati (305 kB gzip) per l aggiunta di Dexie
  e dei moduli v2. Vite segnala ancora l advisory sulla dimensione del chunk: e il
  candidato naturale per un prossimo code-splitting.

---

# v2 — audit finale e completamento

Secondo passaggio sul prompt v2: riletto il documento per intero, confrontato
ogni requisito con il codice, chiuso i buchi trovati.

## Bug reali trovati e corretti in questo passaggio

1. **I-4 violata dalla coda.** I messaggi venivano composti all'accodamento, non
   all'avvio del job: una dipendenza finita dopo il click non entrava nel
   contesto. Ora `runPrompt` salva solo `promptTextSnapshot` e chiama
   `assembleMessages` dentro `execute()`, sul documento con il testo del prompt
   sostituito (`documentWithPromptSnapshot`).
2. **L'ordinamento della coda non influenzava lo scheduler.** `move up/down`
   riordinava solo l'array mostrato, mentre il scheduler leggeva l'ordine di
   inserimento di una `Map`. Ora esiste un array `order` esplicito e lo scheduler
   lo percorre; `moveJob` lo modifica davvero.
3. **Tre selettori Zustand instabili** (`TopBar`, `SetNode`, `SetOutlines`)
   restituivano array nuovi a ogni `getSnapshot`: React entrava in loop e
   l'albero crashava con "Maximum update depth exceeded". Regola applicata:
   il selettore restituisce sempre un primitivo o un riferimento stabile, e
   `filter`/`map` avvengono in `useMemo`.
4. **`dangerouslySetInnerHTML` sulla home** rompeva il rendering e violava la
   proprietà v1 di non usare HTML grezzo. L'anteprima ora è un `<img>` con data
   URI generata da `renderThumbnail`.
5. **Errore di memoria perso nella mappatura.** Un 400 "Not enough memory" veniva
   mappato in `NO_MODEL` e l'hint sulla quantizzazione spariva. Ora il controllo
   guarda anche il testo grezzo del server.
6. **CSS: `height: 100%` su `.node-shell`** collassava i nodi con altezza
   automatica, lasciandoli invisibili. L'altezza piena vale solo con la classe
   `has-explicit-size`.
7. **L'Output non si aggiornava** quando un Set accumulava risposte. Ora
   `executeResponse` chiama `refreshOutputs` nel `finally`.

## Aggiunti in questo passaggio

- **Coda**: `promptTextSnapshot`, array d'ordine reale, `queuePosition`, `queueEtaMs`
  (media mobile e stima), durate dei job completati, `moveJob`, pausa con motivo,
  `aria-live` "Generation N of M started", conferma su Stop all con piu di 3 job
  in attesa, "Re-queue N interrupted" nella StatusBar, pannello con workspace,
  tempo in coda, vai al nodo e selettore dei slot.
- **Set**: contorno tratteggiato in tempo reale (`SetOutlines` con
  `ViewportPortal`), toast "N nodes skipped", `addSelectionToSet`,
  `removeSelectionFromSets`, `readingOrder` puro con test, sintesi che scrive
  l'Output quando finisce.
- **Summary**: map-reduce sui chunk con merge finale, istruzioni dell'utente
  incluse nella richiesta, `Regenerate`, `Show original history`, badge
  "May be outdated", `Compact context…` e `Compact up to here` nel menu
  contestuale, suggerimento `/compact` mentre si digita, `Tab` che completa il
  comando, Toast con "Restore original links".
- **Clipboard**: azioni riutilizzabili (`clipboardActions`), offset di 24 px per
  incolla ripetuti, `sourceWorkspaceId` reale, fallback su clipboard interno,
  `Ctrl+D`, voci Copy/Cut/Paste/Duplicate nei menu.
- **Resize**: "Reset size" nei menu, auto-resize delle textarea disattivata con
  altezza esplicita, il corpo del nodo diventa elastico.
- **Tab**: conferma "Keep running in background" / "Stop and close" quando ci sono
  job in sospeso, banner "deleted elsewhere" con Restore dallo snapshot.
- **Scorciatoie**: `Alt+T/W/H`, `Alt+PageDown/PageUp`, `Alt+1..9` a livello app
  (funzionano anche in Home), `Ctrl+Enter` su multi-selezione in ordine
  topologico, tabella aggiornata in README e nel tab Help.
- **Home**: `renderThumbnail` puro con test, anteprima SVG sulle card.
- **Model manager**: stato `loading-model` nella pill con tempo trascorso,
  `REPOSITORY_CLIENT_ID` per ignorare i propri messaggi BroadcastChannel,
  `resetModelManagerForTests`.

## Test aggiunti

- `src/queue/runQueue.test.ts` — 8 test: FIFO con concorrenza 1, job bloccato che
  non ferma gli altri, riordino effettivo, cancel in attesa, pausa su `OFFLINE`,
  posizioni 1-based, `clearQueue` che lascia i job in esecuzione, pause manuale.
- `src/actions/modelManager.test.ts` — 10 test: rilevamento dei tre livelli API,
  `ensureLoaded` che non fa POST se il modello e gia in memoria, deduplicazione
  delle promise, modello assente, errore di memoria con hint, unload degli altri
  modelli, nessun unload durante un job in esecuzione.
- `src/actions/runSelection.test.ts` — 5 test: ordine topologico su catena di 3,
  indipendenti, filtraggio dei non-prompt, `readingOrder`.
- `src/logic/thumbnail.test.ts` — 5 test: SVG valido e deterministico, un rett per
  nodo, archi `run` esclusi, documento vuoto, escape del nome.
- `src/llm/openai.test.ts` — test di regressione sulle tre forme di
  `loaded_instances`.
- `src/llm/sse.test.ts` — `reasoning_content` tenuto separato dalla risposta.

Totale: **93 test**, 21 file, tutti verdi. `npm run check` verde.

## Verificato nel browser

- Avvio: home con elenco, schede, anteprima, ordinamento.
- Workspace: 5 nodi (2 prompt, response, set, output) e il contorno del Set
  sopravvivono al reload.
- Set: "1/2 ready", lista membri, selettori `pick`/`format`, "Run missing".
- Output: Copy, Export .md, conteggio parole e token.
- Contorno del Set disegnato sotto i nodi e aggiornato.
- Run reale su LM Studio: caricamento modello, coda, risposta; il caso "budget
  esaurito dal ragionamento" mostra l'errore con l'hint invece di una risposta
  vuota.
- Zero errori in console.

## Non implementato, e perche

- **Benchmark 150 nodi / 50 fps** e **5 tab con stream attivo**: richiedono una
  sessione di misurazione dedicata; il codice usa selettori stretti e la memoizzazione
  richiesta, ma il numero non e stato prodotto.
- **Coda multi-modello con `maxParallel`**: il prompt lo marca come parte di
  `llm-synthesis` e lo hardware dell utente regge un modello. La concorrenza e
  esposta 1-4 e funziona con piu slot LM Studio, ma non c e uno scheduler
  round-robin tra modelli diversi.
- **`copyAllRequestsToClipboard`**: richiesta come P2, non implementata; il
  clipboard copia e incolla nodi e testo, non l intero elenco richieste.
- **Schede Auto-layout / Export / Reset nelle impostazioni**: le azioni esistono
  (scorciatoie e menu contestuale) ma non hanno una scheda dedicata.
- **Sandbox plugin/worker**: fuori portata e non necessario alle 9 funzionalita.
- **`liveQuery` di dexie-react-hooks**: l elenco home si aggiorna con
  `BroadcastChannel` piu un evento locale, che soddisfa lo stesso requisito senza
  una dipendenza aggiuntiva.
---

# v2 — verifica finale (elenco di cio che funziona)

Audit sistematico del prompt v2: ogni requisito e stato controllato nel codice e
proonato nel browser. Tre gap trovati e chiusi in questo passaggio.

## Gap chiusi nella verifica

1. **`reopenTabsOnStartup` non era una preferenza reale.** Il tipo esisteva e il
   bootstrap la leggeva, ma non c era un toggle e `appState.uiPreferences` non
   veniva mai scritto: il valore era sempre il default. Ora c e il toggle in
   Settings → Appearance, la preferenza viene salvata in `appState` e riapplicata
   al bootstrap.
2. **`setNoteWidth` era ancora vivo.** Il prompt chiedeva di rimuoverlo o di
   farlo passare dal nuovo meccanismo. L Inspector lo usava ancora con limiti
   hardcoded 240-480. Ora l Inspector chiama `setNodeSize` con i limiti del
   registry e un pulsante **Reset size**; `setNoteWidth` e stato eliminato.
3. **Mancavano i test di assemblaggio con Summary**, richiesti esplicitamente.
   Aggiunti 5 test: punto di taglio senza risalire agli antenati, fusione nel
   solo messaggio system, nessun system duplicato con un nodo System, concatenazione
   di piu Summary in ordine di arco, compattazione ricorsiva.

Totale test: **98** (era 93).

## Cosa funziona, verificato nel browser

| Area | Prova fatta |
|---|---|
| Persistenza | 13 nodi, 7 archi salvati e ricaricati identici dopo reload |
| Resize | 900x650 impostato, riletto dopo reload con la stessa dimensione |
| Set | 2/2 ready, lista membri, selettori pick/format, Run missing |
| Set → Output | aggregato con entrambe le risposte, 17 parole, ~28 token |
| Contorno Set | 1 frame tratteggiato sotto i nodi, aggiornato con i membri |
| Clipboard | Set copiato e incollato, 2 membri rimappati ai nuovi id |
| Coda, TopBar | pill "1 running - 1 queued" |
| Coda, StatusBar | "Queue: 1 - 1 running - ETA ~3.7 s" |
| Pannello coda | "1 running - 1 queued - ~5.0 s left", righe con posizione, titolo, workspace, stato, tempo in coda, 6 azioni |
| Ordine topologico | 2 prompt accodati dalla multi-selezione |
| Errori onesti | budget ragionamento esaurito: nodo in errore con hint sui token, non risposta vuota |

## Cosa funziona, verificato dai test

- Repository: CRUD, conflitto di revisione, potatura snapshot a 5, migrazione
  idempotente da localStorage.
- Coda: FIFO con concorrenza 1, job bloccato che non ferma gli altri, riordino
  reale, cancel, pausa su OFFLINE, posizioni, clearQueue, pausa manuale.
- Model manager: 3 livelli API rilevati, nessun POST se il modello e gia in
  memoria, dedup promise, modello assente, errore di memoria con hint, unload
  degli altri, nessun unload durante un job.
- Aggregazione: latest-done, Set annidati, ciclo → GRAPH_CYCLE, formattazione.
- Assemblaggio: catena, diamanti, cicli, risposte vuote/abortite, Set, Summary.
- Compact: parser `/compact`, transcript, chunking, coverage hash, rilink non distruttivo.
- Clipboard, thumbnail, router, tab reducer, migrazioni, SSE, reasoning.

## Nota su HMR in sviluppo

Durante la verifica e successo un apparent data loss: dopo aver modificato un file
che il server ricarica a caldo, lo store in memoria veniva ricostruito e il
documento vecchio spariva dalla vista. Il ciclo salvataggio e integro (13 nodi
salvati e ricaricati senza perdita) e il problema non si riproduce in produzione,
dove non esiste HMR. Chiudo il prompt ho verificato il reload su un build senza
ricariche a caldo.

## Non implementato (invariato)

Benchmark 150 nodi, coda multi-modello con `maxParallel`,
`copyAllRequestsToClipboard`, sandbox plugin, schede Auto-layout/Export/Reset
nelle impostazioni. Tutte azioni equivalenti esistono come scorciatoie o voci di
menu, ma non hanno una scheda dedicata.
---

# v2 — correzioni segnalate dall'utente

## 1. Il caricamento del modello si fermava a meta caricamento

**Sintomo:** il modello partiva e si fermava intorno al 63 %.

**Causa:** era un mio bug, non un limite di LM Studio. Avevo aggiunto un polling
che confrontava `loaded_instances` durante il caricamento e **abortiva la richiesta
non appena il campo risultava non vuoto**. Misure sul server reale:

| Momento | Valore |
|---|---|
| `loaded_instances` diventa non vuoto | 1,6 s |
| il POST `/models/load` risponde | 18 s |

cioe `loaded_instances` viene popolato **16 s prima** che il modello possa servire.
Abortendo a 2 s l'app credeva che il modello fosse pronto, la run partiva, la
richiesta non riceveva risposta e LM Studio restava con il caricamento interrotto.

**Correzioni:**
1. Il POST di caricamento viene **atteso**. Il polling e diventato solo un
   watchdog per il caso in cui il server non risponda mai, e scatta solo se il
   modello risulta residente da almeno `RESIDENT_GRACE_MS` (30 s), quando e
  Certainly pronto e annullare la richiesta non ferisce il caricamento.
2. I caricamenti sono **serializzati** con una catena di promise: LM Studio
   inizializza un modello alla volta e due richieste sovrapposte le fanno
   stallare entrambe.
3. Il timeout del primo byte passa da 30 s fisso a `firstByteTimeoutMs`, con
   default **180 s**. Motivo misurato: alla prima inferienza a freddo questo
   modello di ragionamento ha impiegato **29,2 s** per il primo token (le
   richieste successive: 11,9 s, 9,3 s, 20 s). Con 30 s la run veniva interrotta
   mentre il modello stava ancora generando. Il timeout e ora regolabile in
   Settings → Connection.

**Verifica:** da freddo (nessun modello in memoria) una run reale completata in
20,2 s con stato `done` e testo corretto. Prima della correzione la stessa
scena falliva con "LM Studio did not return a first token in time".

Nota: `POST /api/v1/models/unload` accetta `instance_id`, non `model`. Il client
lo usa gia correttamente leggendo gli id da `loaded_instances`.

## 2. Il Set raggruppava i prompt invece delle risposte

**Sintomo segnalato:** un Set deve aggregare i **testi prodotti**, non i prompt.
Non si vuole raggruppare due prompt, ma due risposte.

**Correzioni:**
- I membri di un Set creato da una selezione sono i nodi **response**. I prompt
  non sono piu membri impliciti: `createSetFromSelection` li ignora e avvisa.
- Esiste un percorso esplicito e separato, `createSetFromPromptAnswers`, per un
  Set che segue i prompt e prende le loro risposte. I membri restano prompt cosi
  `pick` (latest-done / all-done) continua a funzionare.
- Il menu contestuale mostra due voci distinte: **Create set from N answers** e
  **Create set from the answers of N prompts**.
- Il nodo Set mostra i membri per **testo** (prima riga della risposta), con
  pallino di stato e anteprima dell aggregato, non le domande.

**Bug aggiuntivo trovato dai test:** il `pick` di un Set era ignorato quando il
membro era un prompt, perche l adapter leggeva il campo dal prompt invece che dal
Set. `all-done` restituiva solo l ultima risposta. Corretto passando `pick` da
`CollectOptions`; c e un test dedicato.

**Leggibilita:** aggregando risposte di prompt diversi tutte le sezioni si
chiamavano "Response #1". Ora ogni sezione e intitolata dalla domanda che ha
prodotto la risposta, e la domanda non viene ripetuta come citazione quando e
gia il titolo.

**Verifica:** Set con 3 membri, tutti di tipo `response`; l Output produce

```
### Rispondi solo con la parola: PERSO
PERSO

### Domanda uno
Risposta uno: alpha

### Domanda due
Risposta due: beta
```

## Test

102 test (era 98). Nuovi: `src/logic/setAnswers.test.ts` con 4 casi che coprono
l aggregazione delle risposte, la readiness, il percorso esplicito via prompt e
l inserimento di un solo messaggio user a valle.

---

# v2 — secondo giro di richieste dell'utente

Cinque richieste, tutte verificate nel browser su LM Studio reale.

## 3. I parametri di generazione sono globali

`temperature`, `top_p` e `max output tokens` non sono piu per nodo.

- Spariti i chip `temp` / `top_p` / `tok` e il contatore "token usati" dal nodo
  Prompt. Il nodo mostra solo testo, scorciatoia `Ctrl+Enter` e i pulsanti.
- L Inspector non edita piu override per nodo: mostra i valori globali in
  lettura con un pulsante **Open global settings**. Il percorso di modifica e
  Settings → Generation.
- `PromptNodeData.params` resta nel formato perche `resolveParams` continua a
  risolvere `null` -> default; i nodi nuovi nascono con `null` come prima, quindi
  un documento vecchio con override espliciti continua a comportarsi uguale.

## 4. Un solo pulsante Run nel nodo Prompt

Ce ne erano due: uno icona nell header e uno con etichetta nel footer. Entrambi
facevano start e stop. Ora resta solo quello in basso, che diventa **Stop** mentre
la generazione e in corso. L header del prompt e libero.

## 5. Il nodo Set non esiste piu: il risultato e un solo Output

**Richiesta:** via il nodo Set, ma la logica di aggregazione resta; raggruppando 2
o piu risposte si deve ottenere **un solo output** da collegare a un altro nodo,
con il contorno intorno alle risposte usate per crearlo.

- `set` esce da `AddableNodeType` e dalla palette: non e piu creabile.
- `createSetFromSelection` crea **un nodo `output`** con `sourceNodeIds` = le risposte
  selezionate, posizionato a destra del bounding box della selezione, con il testo
  aggregato gia calcolato. Nessun nodo intermedio.
- Il "Set" e ora questo: il **contorno tratteggiato intorno ai membri**, disegnato
  sotto i nodi in `SetOutlines` (ora legge anche `output.sourceNodeIds`), piu il
  risultato unico che si puo collegare.
- `OutputNodeData` gains `sourceNodeIds`, `format`, `includePromptText` e
  `synthesis`. L'Output ha **un ingresso** (il testo raggruppato) e **un'uscita**
  (`context`) per usarlo come contesto nel prompt successivo: `assemble.ts` lo
  inserisce dentro l'unico messaggio user, come gia faceva il Set.
- `logic/aggregation/registry.ts` ha un quinto adapter, `outputAdapter`: un Output
  con membri ricorsione sui membri (appiattisce i gruppi annidati invece di
  ripeterne il testo), un Output senza membri e un blocco di testo autonomo.
- **Il tipo `set` resta nel data model** solo perche i documenti salvati prima
  contengono nodi Set. `SetNode.tsx` e diventato un renderer legacy: mostra
  l aggregato e offre "Convert to output". Non compare in un grafico nuovo e non
  e piu creabile; i documenti vecchi si aprono senza crash. Nota per l'utente:
  `set` non viene rimosso dallo schema finche i workspace gia salvati non sono
  stati aperti e convertiti.

## 6. Il titolo della risposta viene dalla domanda

Alla creazione del nodo response, il titolo prende la prima riga del prompt
(70 caratteri, spazi normalizzati). Se il prompt non ha un titolo, lo riceve
anch'esso, cosi l header smette di dire "Prompt". Un titolo digitato
dall'utente non viene mai sovrascritto. Il nodo Response mostra `data.title` al
posto di "Response".

## 7. Toggle Thinking nel nodo Prompt

Un chip `Thinking` / `No thinking` (barrato quando spento, `aria-pressed`), piu i
pulsanti **Enable/Disable thinking** nell'Inspector. `PromptNodeData.thinking`
(default `true`) e persistito.

**Parametro verificato sul server, non scelto a caso.** Sul modello dell'utente
(`qwen3.5-9b-ultra-uncensored-heretic`) ho provato quattro modi di disattivare il
ragionamento:

| Parametro inviato | reasoning | token |
|---|---|---|
| nessuno (thinking on) | 454 caratteri | 107 |
| `chat_template_kwargs: {enable_thinking: false}` | 428 caratteri | 99 |
| `chat_template_kwargs: '{"enable_thinking": false}'` (stringa) | 478 caratteri | 112 |
| `enable_thinking: false` al primo livello | 251 caratteri | 63 |
| **`reasoning_effort: "none"`** | **0** | **2** |

Solo `reasoning_effort: "none"` funziona: LM Studio lo onora e salta la fase di
ragionamento. E quello che l'app manda, e solo quando il toggle e spento.
Confermato sul traffico reale del browser:

```json
// thinking on
{"model":"...@q4_k_m","messages":[...],"stream":true,"temperature":0.7,
 "top_p":1,"max_tokens":10000,"stream_options":{"include_usage":true}}

// thinking off
{"model":"...@q4_k_m","messages":[...],"stream":true,"temperature":0.7,
 "top_p":1,"max_tokens":10000,"reasoning_effort":"none",
 "stream_options":{"include_usage":true}}
```

Il retry e la coda rileggono `thinking` dal prompt padre, quindi un nodo
ri-eseguito mantiene l'impostazione.

## Bug trovato durante la verifica

`createResponseNode` scriveva il titolo derivato direttamente sul documento, che
e **frozen**: `TypeError: Cannot add property title, object is not extensible`. Il
titolo del prompt ora passa da `updateNodeData`. C'e un test che lo copre.

Inoltre il titolo automatico e stato tolto dal **prompt** (tenuto solo sulla
risposta): il prompt mostra gia quella riga nella textarea, quindi il titolo
duplicava il testo senza aggiungere informazione.

## Correzione extra: edge type `bezier` inesistente

Warning preesistente in console, non introdotto da queste modifiche:
`[React Flow]: Edge type "bezier" not found. Using fallback type "default"`.
In React Flow 12 la curva si chiama `default`, `bezier` non e un tipo registrato.

- `UiPreferences.edgeStyle` ora e `'default' | 'smoothstep'`.
- Il valore salvato in precedenza come `bezier` continua a significare la curva:
  in lettura `bezier` ricade sul default, che **e** la curva. Solo `smoothstep`
  resta se esplicito.
- L'opzione nella UI si chiama ancora "Bezier".

Console ora pulita, senza warning.

## Test

116 test in 23 file (era 102 in 22). Nuovi:

- `src/logic/params.test.ts` — 4 test: i parametri senza override arrivano dai
  default globali, `reasoning_effort` presente solo da spento, default thinking on.
- `src/logic/setAnswers.test.ts` — 5 test in piu: raccolta attraverso l'Output
  che possiede il gruppo, readiness dagli stati delle risposte e non dal testo
  salvato, testo raggruppato in un blocco a valle, appiattimento di un gruppo
  annidato, Output senza membri come blocco autonomo.
- `src/store/workspaceStore.test.ts` — 3 test: titolo della risposta dalla
  domanda, titolo derivato da una domanda su piu righe (spazi normalizzati,
  niente spazio finale), risposta eliminata staccata dal gruppo.
- `src/persistence/storage.test.ts` — 2 test: `edgeStyle: "bezier"` salvato in
  precedenza resta la curva, `smoothstep` sopravvive, valore ignoto ricade sul
  default.

## Verificato nel browser

- Nodo Prompt: nessun chip di parametro, un solo `Run`, chip `Thinking` che
  commuta e resta `No thinking` dopo reload del dato.
- Shift+click su 3 response -> context menu con **"Group 3 answers into one
  output"** -> **un solo nodo Output** creato, `sourceNodeIds` = 3, nessun nodo
  `set` nel documento, testo aggregato con 3 sezioni intitolate dalle domande.
- Un contorno tratteggiato solo, colorato `--accent`, intorno alle 3 risposte.
- Output con handle `in` a sinistra e `context` a destra; collegato a un prompt
  successivo, l'assemblaggio produce 1 solo messaggio user.
- Run reale con toggle spento: `reasoning_effort: "none"` presente sul wire,
  risposta in 13,5 s, `status: done`.
- Inspector: "Parameters are global", 0.70 / 1.00 / 10000, pulsanti Open global
  settings e Disable thinking.
- Zero errori in console.
---

# v2 — finestra dedicata e collegamento sul desktop

Richiesta: aprire l'app in una finestra propria, con la possibilit di creare un
collegamento sul desktop, **senza rinunciare allo sviluppo** (molte modifiche
future).

## Il fatto che rende tutto possibile

Il punto decisive non e un mio assunzione: e che **Chromium considera
`http://127.0.0.1` un'origine sicura** e che **un service worker non e richiesto
per installare una PWA**. Entrambi verificati su MDN
(`Making PWAs_installable`, sezione *Installability*):

- requisiti dichiarati: `name` o `short_name`, `icons` con 192px e 512px,
  `start_url`, `display` e/o `display_override`, `prefer_related_applications`
  assente o `false`;
- *"While not a requirement for a PWA to be installable, many PWAs use service
  workers to provide an offline experience."*;
- servono `https`, oppure `localhost` / `127.0.0.1` con o senza porta.

Quindi l'app si installa **mentre gira il dev server** e l'HMR continua a
funzionare. Non serve alcun wrapper nativo.

## Alternative valutate

| Opzione | Finestra dedicata | Collegamento desktop | HMR in sviluppo | Costo | Scelta |
|---|---|---|---|---|---|
| PWA installata dal browser | si | si, tramite il SO | si | ~0 | **scelta** |
| `--app=` di Edge/Chrome | si | si, via `.lnk` | si | ~0 | **scelta** come fallback |
| Electron | si | si | si, ma due pipeline | ~150 MB, `node_modules` doppio, IPC | scartata |
| Tauri | si | si | si | richiede toolchain Rust | scartata |
| WebView2 / `webview` | si | si | si | fragile, due runtime | scartata |
| Solo `--app` senza PWA | si | si | si | ~0 | scelta, ma non dà l'installazione nativa |

**Perché Electron no.** Darebbe un `.exe` vero con icona, tray e menu nativi, ma
a prezzo di un secondo `node_modules`, una seconda pipeline di build, ~150 MB di
runtime e uno strato IPC fra l'app e LM Studio da mantenere. Dividerebbe anche il
workflow di sviluppo in due. Le tre opzioni scelte danno gi una finestra
standalone con collegamento del sistema operativo e non costano nulla a runtime.

**Perché niente service worker.** Non serve per installare, e in sviluppo
cacheerebbe moduli vecchi: esattamente il tipo di guasto che fa perdere tempo
durante le modifiche. Il file `public/sw.js` non esiste e non verra aggiunto
senza un motivo concreto (offline, per esempio).

## Cosa e stato implementato

1. **Manifest** `public/manifest.webmanifest`: `display: standalone`,
   `display_override` con fallback finale `browser`, icone 192/512 piu una
   **maskable** disegnata dentro la safe zone, `start_url` e `scope` **relativi**,
   scorciatoia `Home` verso `./#/`, `prefer_related_applications: false`.
   Percorsi relativi deliberati: un `start_url` assoluto/pinerebbe la finestra
   installata alla porta del dev server per sempre, anche dopo un passaggio a un
   build di produzione su un'altra porta.
2. **Icone** `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, generate dal
   design di `public/favicon.svg` con `tools/make-icons.ps1` (System.Drawing, gia
   presente su Windows: nessuna dipendenza nuova). Lo script resta nel repo per
   rigenerarle se il logo cambia.
3. **Bottone "Install app"** nella Home, guidato da `beforeinstallprompt`
   (`src/pwa/install.ts`). Ogni decisione di UI e una funzione pura dello stato,
   perche l'evento esiste solo su Chromium:
   - `ready` -> mostra il bottone;
   - `accepted` (gia installato) -> **non mostra nulla**;
   - `declined` -> il bottone resta con l'hint che dice di usare il menu del
     browser;
   - `unsupported` -> dice onestamente che quel browser non puo installare e
      rimanda a `start-app.cmd`;
   - `dismissed` (prima che il browser si decida) -> non mostra nulla.
   Niente bottone morto: nel mio ambiente di test Electron l'evento non arriva
   e il bottone correttamente non compare.
4. **Icona nella barra di sistema**: `tools/run-tray.ps1`, con
   `System.Windows.Forms.NotifyIcon` (in .NET Framework, gia su ogni Windows:
   nessuna dipendenza nuova, nessun passo di build). Menu: **Apri NCHAT**,
   stato del server, **Apri il log del server**, **Ferma il server ed esci**.
   Doppio click sull'icona = Apri NCHAT. Un balloon all'avvio dice che il
   server resta attivo anche chiudendo la finestra.
5. **`start-app.cmd`**: involucro per il doppio click dalla cartella; lancia il
   tray con console nascosta.
6. **`create-desktop-shortcut.cmd`** + **`tools/install-shortcut.ps1`**: crea
   `NCHAT.lnk` su Desktop e menu Start; `create-desktop-shortcut.cmd delete`
   li rimuove. Il collegamento punta a `powershell.exe -WindowStyle Hidden
   -File tools\run-tray.ps1`: nessuna console, l'icona del tray e l'unica
   presenza di NCHAT.

## Ciclo di vita: richiesta corretta due volte

La prima implementazione fermava il server quando spariva la finestra. L'utente
ha chiarito che il comportamento voluto e un altro, quello di Discord:

- il collegamento avvia il server e apre la finestra;
- **chiudere la finestra NON ferma il server**;
- il server si ferma **dal menu dell'icona nella barra di sistema**.

La correzione e stata piu semplice della prima, perche **la finestra non va
gestita**: e una finestra del browser, e quando l'utente la chiude non succede
niente che il processo tray debba sapere. Il ciclo di vita e del server, non
della finestra, e tocca al tray decidere quando finisce. Niente `Wait-Process`,
nessun rilevamento di finestra.

Il `finally` chiama `Stop-Server`, che ferma **il processo in ascolto sulla
porta**, non solo quello avviato da questo script: cosi il tray e autoritario
anche su un server lasciato da un'istanza precedente, che e il caso in cui
`-StopServer` serve a recuperare un orfano.

## Il lockfile del browser: la causa di una finestra che non apriva

Bug trovato verificando, non ipotizzando. Dopo il collegamento la finestra **non
compariva** (66 s di polling), mentre server e tray erano vivi. Indagando:

- i processi `msedge` con il profilo dedicato erano **8 e vivi, ma senza
  finestra**;
- eliminandoli e togliendo il `lockfile` dal profilo, la finestra compariva.

Causa: Edge tiene un `lockfile` nel profilo. Se Edge viene chiuso a forza (crash
o task manager) il file resta, il lancio successivo viene inoltrato a
un'istanza che non esiste piu, e il browser parte **senza finestra**.
`Remove-StaleProfileLock` rimuove il file, ma **solo se nessun processo vivo usa
quel profilo**: cancellarlo mentre un'istanza e attiva permetterebbe a due
istanze di scrivere sullo stesso profilo, che e l'unico modo vero di corromperlo.

Dopo la correzione, nelle stesse condizioni che fallivano: **finestra in 6,7 s**.

## Un limite reale, dichiarato

Se il processo del tray viene **chiuso a forza** (task manager, `Stop-Process`),
il `finally` non gira e il server resta orfano. Nessun processo puo fare pulizia
dopo essere stato ucciso: e un limite comune anche alle app come Discord. Per
questo esiste `-StopServer`, che ferma il server in ascolto sulla porta.

## Bug trovati e corretti durante la verifica

1. **`%DESKTOP%` non e definito su Windows moderno.** Il collegamento finiva in
   `\NCHAT.lnk`, cioe nella radice del disco: `D:\NCHAT.lnk` su questa
   macchina. Risolto con `[Environment]::GetFolderPath('Desktop')`, che segue
   anche un Desktop spostato su un altro disco. Il file sparso e stato rimosso.
2. **Lo script diceva "Fatto" e usciva con 0 anche quando il collegamento non
   esisteva.** La logica PowerShell inline falliva in silenzio. Riscritta in
   `tools/install-shortcut.ps1` con `$ErrorActionPreference = 'Stop'`, verifica
   di esistenza dopo `Save()` e `exit 1` in caso di errore; il `.cmd` e un
   involucro sottile che propaga l'errore.
3. **Percorso con barra finale in `start`/`/D`.** `%~dp0` termina con `\` e una
   barra finale dentro le virgolette puo chiudere prematuramente il percorso.
   Risolto con `set "HERE=%HERE:~0,-1%"`.
4. **Icona PNG e CSS**: `DrawRectangle` in PowerShell sceglieva l'overload
   intero e arrotondava le coordinate. Usato l'overload a 4 `float`.

## Test

130 test in 25 file (era 116 in 23). Nuovi 14:

- `src/pwa/manifest.test.ts` — 8 test che leggono **il file che viene servito**
  (via `import.meta.glob` con `?raw`, senza copie e senza `@types/node`):
  presenza di `name`/`short_name` con lunghezza da icona, icone 192 e 512,
  percorsi relativi, `display: standalone` con fallback `browser`,
  `prefer_related_applications` assente o `false`, icona maskable, scorciatoia
  Home, colori nel formato esadecimale. C'e anche una guardia che **fallisce se il
  file manca**, verificata rinominandolo: senza quella guardia un test che passa
  perche non trova nulla sarebbe falso.
- `src/pwa/install.test.ts` — 6 test sulla decisione di UI per ogni stato.

## Verificato, e non verificato
## Verificato, e non verificato

**Verificato davvero, misurato:**

- il manifest e servito dal dev server come `application/manifest+json`, con
  `name`, `short_name`, `display`, `start_url` e le tre icone lette e verificate;
- il manifest e le icone finiscono in `dist/` nel build di produzione, e il
  `<link rel="manifest">` c'e anche li;
- iniezione di un `beforeinstallprompt` sintetico: il bottone compare nella Home,
  il click chiama `prompt()`, e dopo l'accettazione sparisce; dopo un rifiuto
  resta con l'hint "Dismissed. Use the browser menu to install it again.";
  `appinstalled` lo fa sparire;
- **doppio click su `NCHAT.lnk`**: server in ascolto, processo tray vivo, e
  **finestra dell'app presente** (`Chrome_WidgetWin_1`, titolo
  "NCHAT - Visual prompt graph") in 6,7 s;
- **chiusura della finestra dell'app** (uccisione del processo del browser):
  `server HTTP 200` e `tray VIVO` — il comportamento richiesto;
- il tray possessiede la finestra WinForms `WindowsForms10.Window.0.app.0`, e lo
  script stampa `Tray attivo` senza errori su stderr;
- `-StopServer` ferma il server in ascolto sulla porta e ripetuto non fa nulla
  (idempotente);
- **recupero di un orfano**: avviato un server con un processo non tray e
  fermato con `-StopServer`, che agisce sul PID in ascolto e non solo su quello
  avviato dallo script;
- `run-tray.ps1 -SelfTest`: avvio e arresto del server corretti, e nessun
  processo `node`/vite residuo, nessuna porta occupata;
- il log del server su file e senza codici ANSI, e la porta resta libera dopo
  l'arresto;
- `start-app.cmd` con LM Studio spento: esce subito con exit 1 e spiega come
  accendere il server, prima di avviare qualcosa;
- `create-desktop-shortcut.cmd`: crea entrambi i collegamenti nelle cartelle
  giuste (Desktop reale su `D:` e menu Start), con `TargetPath` =
  `powershell.exe`, `Arguments` con `-WindowStyle Hidden -File tools\run-tray.ps1`,
  icona `nchat.ico`; `delete` li rimuove;
- zero errori e zero warning in console introdotti dalla modifica;
- 130 test in 25 file verdi, typecheck pulito, build ok, lint 0 errori.

**Non verificato, e perche:**

- **Il vero dialogo di installazione di Chromium non e stato visto.** Il browser
  di questo ambiente e Electron, che non implementa l'installazione PWA, quindi
  `beforeinstallprompt` non parte. Ho verificato la validita del manifest con
  test automatici e il percorso di UI con un evento sintetico, ma l'installazione
  vera va provata dall'utente in Edge o Chrome.
- **L'aspetto visivo del tray non e stato visto.** Le finestre e i processi sono
  stati verificati a livello di sistema (enumerazione delle finestre, PID,
  `MainWindowHandle`), ma questo ambiente non ha un desktop visibile: non
  posso confermare che l'icona sia disegnata vicino all'orologio, che il balloon
  appaia, o che il menu si apra. Da verificare dall'utente.
- **Il click sulle voci del menu** non e stato esercitato: si puo solo
  verificare la funzione che il menu chiama (`Stop-Server`), ed e esattamente
  cio che fa `-StopServer`, testato.

---

# v2 — richieste UI dell'utente

Sette richieste in un giro. Tutte verificate nel browser, e le ultime due anche
con una run reale su LM Studio.

## 1. Collapse su ogni nodo, stile Blender

- `CollapsibleNodeData` in `types/document.ts`, esteso da tutti e sette i tipi di
  dato nodo. `collapsed?: boolean`, persistito come `width`/`height`.
- Un bottone nell'header di `NodeShell`, a sinistra del titolo, con
  `aria-expanded` e `aria-label` che dice "Collapse"/"Expand".
- **Body e footer restano montati e sono nascosti via CSS.** Smontarli avrebbe
  portato via anche gli handle, che sono figli del nodo: un nodo collassato che
  non si puo piu collegare non serve. Cosi si evita anche di resettare lo scroll
  di una risposta in streaming a ogni apertura.
- La **larghezza viene conservata**: solo l'altezza si stringe all'header. Un
  nodo ridimensionato a mano deve tornare identico quando lo si riapre. Misurato:
  252 px -> 63 px di altezza, larghezza identica (1023 px a parita di zoom).
- Un nodo collassato mostra una riga di anteprima del testo.

## 2. L'Inspector non compare piu da solo

- Prima `inspectorOpen` esisteva come preferenza ma **nessuno lo leggeva**: il
  pannello compariva automaticamente a ogni selezione, coprendo il canvas.
- Ora `UiPreferences.developerMode` (default **false**) gates l'Inspector, e
  `inspectorOpen` (default **false**) decide se e aperto. Il bottone per aprirlo
  nella top bar compare solo in modalita sviluppatore.
- Toggle in **Settings → Appearance → Developer mode**, con spiegazione del
  perche esiste.

## 3. Auto-fit con tetto di leggibilita

`logic/autoFit.ts` raccoglie i numeri che prima erano sparsi e ripetuti nei
componenti. Il nodo cresce con il testo fino a un massimo, poi scorre:

| nodo | minimo | tetto |
|---|---|---|
| prompt | 74 | 320 |
| note | 100 | 320 |
| system | 74 | 240 |
| response | 74 | 380 (in CSS) |

Il tetto della response e in CSS perche l'altezza la determina il contenuto
rende, non una textarea; il valore e commentato come controparte di quello in
`autoFit.ts`, e un test fissa la corrispondenza.

## 4. I nodi nascono sotto il mouse

- `logic/placement.ts` tiene l'ultima posizione del puntatore ** fuori da React e
  dallo store**: si aggiorna a ogni movimento del mouse e nessun componente deve
  ri-renderizzarsi per un valore che serve solo al momento della creazione.
- Ordine di preferenza in `creationPosition`: punto esplicito (tasto destro o
  doppio click sul canvas) -> puntatore -> **centro della vista** -> origine.
  Il fallback al centro della vista e la correzione che mancava: senza, un nodo
  creato prima che il mouse sia passato sul canvas finiva all'origine del mondo,
  fuori dalla vista.
- Vale per palette, `Ctrl+V` e duplicazione. `Ctrl+V` passava `(0,0)` come
  posizione, quindi incolla finiva sempre in un punto fisso lontano dal lavoro.
- `duplicateNode(id, atPosition?)` accetta la posizione; senza, mantiene il vecchio
  scarto di 40 px dall'originale.

## 5. Nodo immagine, con multimodale vero

Non un nodo decorativo: l'immagine finisce **davvero** nella richiesta.

- `ImageNodeData` con i byte come **data URL** dentro `src`. Scelta deliberata: il
  documento resta JSON puro, quindi export, import, copia, incolla, undo e il
  repository funzionano senza codice nuovo. Il prezzo e la dimensione, e per
  questo `logic/media.ts` limita e ridimensiona all'ingresso.
- **Drag & drop**: `FlowCanvas.onDrop` distingue `.json`, immagini e video. Un
  file immagine/video crea il nodo nel punto di rilascio; qualsiasi altra cosa
  dice cosa accettare.
- `MAX_IMAGE_EDGE` = 1600 px sul lato lungo e re-encode JPEG quando si riduce: un
  modello con visione ridimensiona comunque, e una foto da 4000 px diventerebbe
  una data URL molto piu grande senza guadagno. Tetti: 8 MB immagine, 12 MB video.
- **Video**: il nodo conserva il file (e lo riproduce) e ne estrae un fotogramma
  rappresentativo. Nessun modello chat accetta video, quindi al modello va il
  fotogramma e il nodo **lo dice** ("Video: one frame is sent to the model",
  "Sent to the model: one frame grabbed from the clip"): non e una sostituzione
  silenziosa.
- Arco di tipo nuovo `image`, handle `image` sul prompt. **Non** si puo collegare
  un'immagine al contesto testuale: finirebbe dentro il messaggio come stringa.
- `assemble.ts` mette testo e immagini sullo **stesso** messaggio utente nel
  formato OpenAI. Su messaggi separati il modello risponderebbe all'ultimo.
- `estimateImageTokens` = `width * height / 750`, l'approssimazione usuale per i
  modelli a tiling. Contare i caratteri della data URL come testo darebbe un
  numero falso; il data URL non e testo e viene stimato come immagine.
- `ChatMessage.content` e una union `string | ChatContentPart[]`, e
  `MessageSnapshot` lo segue: una run con immagine deve restare riproducibile dal
  snapshot, altrimenti "Retry same request" perderebbe la foto.

### Bug reale: `isAppEdge` non conosceva il kind nuovo

Aggiungendo `'image'` a `EdgeKind`, `addConnection` restituiva la **stringa**
`"image"` e non creava nessun arco, senza errori in console. Causa: `isAppEdge`
enumera i kind a mano ed era rimasta indietro. Correggere la lista non basta per
il futuro: `graph.test.ts` ora verifica che `isAppEdge` riconosca **ogni** kind
dichiarato dal tipo e che `EDGE_STYLES` abbia uno stile per ciascuno. Sono le due
liste che possono divergere in silenzio.

## 6. Il resize esisteva gia

`NodeResizer` era gia in `NodeShell` per ogni tipo di nodo, con i limiti per tipo
da `nodes/specs.ts`. Non ho toccato il meccanismo: ho verificato che funzioni e ho
aggiunto i limiti per il nuovo tipo immagine. Se nel vostro caso sembrava non
funzionare, il motivo piu probabile e che le maniglie compaiono **solo con il nodo
selezionato**.

## Test

177 test in 28 file (erano 140 in 26). Nuovi 31:

- `src/logic/placement.test.ts` — 12: ordine di preferenza, fallback al centro
  della vista, origine solo come ultima risorsa, `autoFitHeight` che non
  inverte e non cresce oltre il tetto.
- `src/components/palette/NodePalette.test.tsx` — 4: la palette inserisce davvero
  dove dice `placement`, con gli store veri e senza mock. Il test puro non
  copriva il cablaggio.
- `src/logic/media.test.ts` — 15: classificazione, tetti, rifiuto con i numeri
  veri, `fitWithin` su formato orizzontale e verticale e sul lato che non deve
  arrivare a zero.
- `src/logic/assemble.test.ts` — +5: testo e immagine sullo stesso messaggio,
  fotogramma del video e non i byte del video, immagine vuota scartata, ordine di
  piu immagini, stima per dimensione e non per lunghezza della data URL.
- `src/persistence/storage.test.ts` — +4: data URL che sopravvive a save e
  reload, fotogramma conservato, numeri rotti riparati, `collapsed` ricordato.
- `src/logic/graph.test.ts` — +4: ogni `EdgeKind` riconosciuto da `isAppEdge` e
  con uno stile, rifiuto dell'immagine sul contesto testuale e su un nodo che non
  sia un prompt.

**Un test ha trovato un buco vero**: un file da 0 byte passava `checkMediaFile` e
avrebbe creato un nodo vuoto senza avviso. Ora e un rifiuto esplicito con il
motivo `empty`.

## Verificato nel browser, e con una run reale

- Nodo Prompt: due chip (`Ctrl+Enter`, `Thinking`) e un solo bottone `Run`.
- Un bottone collapse per nodo; dopo il click `is-collapsed`, body `display:none`,
  **3 handle ancora presenti**, altezza 252 -> 63, larghezza invariata, bottone
  che diventa "Expand".
- `collapsed` sopravvive al reload.
- Dev mode spento: nessun Inspector e nessun bottone nella top bar, anche con un
  nodo selezionato. Dev mode acceso: Inspector presente e bottone che mostra e
  nasconde.
- **Drop reale** di un PNG 900x600: nodo creato con `src` data URL, `900x600`,
  `20 KB`, anteprima caricata, handle presente.
- Arco `image` creato dopo il fix di `isAppEdge`.
- **Request preview** mostra il payload multimodale esatto:
  `{"role":"user","content":[{"type":"text",...},{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}]}`.
- **Run reale su LM Studio** con `qwen3.5-9b-ultra-uncensored-heretic@q4_k_m`
  (il server dichiara `capabilities.vision: true`): `done` in 25,8 s, 1114 token,
  e la risposta **descrive l'immagine** ("Al centro c'e un cerchio pieno, azzurro
  chiaro, su uno sfondo blu"), cioe il modello ha davvero guardato il file.
- StatusBar: `~736 tok last request` per l'immagine.
- 177 test verdi, typecheck pulito, build ok, lint 0 errori.

## Non verificato

- Il **ricalcolo del frame di un video** non e stato provato con un file vero: la
  logica e coperta dai test sul percorso dell'immagine, ma l'estrazione con
  `<video>` + `seek` dipende dai codec installati. Un video non supportato dal
  browser viene rifiutato con un messaggio, non con un nodo vuoto.
- La **sostituzione del file** ("Replace") non e stata provata con un file vero,
  anche se usa lo stesso `buildImageData` del drop.

---

# v2 — il gruppo e la cornice, e le aree cliccabili

## Il gruppo non e piu un nodo: e la cornice

La richiesta: non vedere il nodo Output, e mettere l'uscita **sulla** cornice
tratteggiata, cosi da collegare il gruppo direttamente a un prompt.

- Il nodo `output` esiste ancora, ma **non e una card**: e un `<section>` con
  bordo tratteggiato, fondo quasi trasparente e una barretta piccola in alto a
  sinistra con il numero di risposte, i token e tre azioni (ricalcola, sintetizza,
  rimuovi il gruppo). Niente header, niente body, niente footer.
- Il testo aggregato si apre con **un click sull'etichetta**, in un pannello che
  sta dentro la cornice e non copre il canvas. Copia ed export .md sono li.
- **La cornice segue le risposte.** `logic/groups.ts` calcola il bounding box dei
  membri e `setGroupFrame` lo scrive nel nodo. La sincronizzazione sta in un
  effetto di `FlowCanvas` perche il bounding box richiede le dimensioni **misurate**,
  che esistono solo in React Flow e non nello store.
- `frameMatches` evita la scrittura quando nulla e cambiato: senza quella guardia
  l'effetto scriverebbe a ogni render e il salvataggio non terminerebbe mai.
- `SetOutlines` ora disegna cornici **solo per i Set legacy** dei documenti
  vecchi. Prima disegnava anche lui quella degli output: con il nodo che e la
  cornice, due cornici sovrapposte.

### Bug reale: `react-flow__node-output` e una classe built-in

La cornice appariva **vuota**: le risposte erano nel DOM, visibili, con il loro
testo, ma non si vedevano. Causa, misurata su `getComputedStyle`:

```
prima   background: rgb(30, 30, 30)   border: 1px solid rgb(60,60,60)   padding: 10px
dopo    background: rgba(0, 0, 0, 0)  border: 0px none                   padding: 0px
```

`react-flow__node-output` non e una classe nostra: e un tipo di nodo **built-in**
di React Flow, che porta con se sfondo, bordo e padding opachi. Il nostro nodo la
eredita dal `type` e, essendo disegnato per ultimo, copriva i membri. La classe
e azzerata esplicitamente in `v2.css`, con un commento che spiega perche.

## Aree cliccabili piu larghe, aspetto identico

Misurate le dimensioni reali dalla `style.css` di React Flow: le linee di resize
sono larghe **1px** e i corner **5px**. Sono eleganti e impraticabili.

| elemento | visibile | area cliccabile |
|---|---|---|
| linea di resize | 1px | 10px |
| corner | 7px | 22px |
| handle di connessione | 10px | 30px |

Nessuna dimensione visibile e cambiata: l'ingrandimento e un pseudo-elemento
`::before` trasparente che sporge oltre l'elemento. Per le linee si allarga
solo in perpendicolare, cosi il bordo visibile resta centrato sul nodo e non
scivola di qualche pixel.

## Verificato nel browser

- Gruppo di 3 risposte: **una sola cornice tratteggiata** che le racchiude, con
  l'etichetta "3 answers · ~382 tok" in alto a sinistra e le tre azioni.
  `set-outline` residui: **0**, quindi nessuna cornice sovrapposta.
- La cornice racchiude esattamente i membri: bbox (-247,200)-(561,1076) ->
  cornice (-273,174) 860x928, cioe 26px di padding sui quattro lati.
- **La cornice segue un membro spostato**: 1280x592 -> 2160x1055 spostando la
  risposta piu a destra. Spostando una risposta che non estendeva il bbox la
  cornice **non** si muove, ed e il comportamento giusto.
- **Collegamento cornice -> prompt**: arco creato, e la Request Preview mostra
  l'aggregato completo ("### what you see in the foto?\nRisposta di prova 1\n\n...")
  dentro il messaggio utente.
- Click sull'etichetta: il pannello si apre con il testo e le azioni Copy /
  Export .md, `aria-expanded` passa a `true`.
- Aree cliccabili misurate sul prompt selezionato: handle `30px x 30px` su 9x9
  visibile, corner `22px x 22px` su 5x5, linea `618px x 10px` su 585x1.

## Test

188 test in 29 file (erano 177 in 28). Nuovi 11 in `src/logic/groups.test.ts`:
nessun riquadro senza membri o con membri spariti, padding sui quattro lati,
riquadro che non prende solo il primo membro, **che segue un membro spostato**,
dimensione esplicita che vince sulla misurazione, membro non ancora misurato,
minimo afferrabile, e `frameMatches` vero e falso.

Un test ha corretto una mia assunzione sbagliata: con un membro di dimensione zero
la cornice non e 52x48 ma 80x48, perche c'è un minimo che la rende afferrabile.

---

# v3 — undici richieste in una passata

## Le richieste, e come sono state lette

| richiesta | compresa come |
|---|---|
| «cancel workspace without typing the name» | via: solo conferma |
| «undo only works for the text, I want it for positions and everything» | Ctrl+Z era l'undo **nativo del browser** dentro la textarea: non esisteva un undo dell'app |
| «I'm not able to move the group» | trascinare la cornice doveva muovere le risposte dentro |
| «the export doesn't work» | `revokeObjectURL` nello stesso tick |
| «a button for cavemane response» | «make the output shorter for less tokens usage»: un chip **Short** sul prompt |
| «make so I can put also image in the group» | `image` diventa aggregabile, e le immagini del gruppo arrivano come immagini vere |
| «in the group go also the title of the response» | formato `plain`: nessun titolo |
| «a node for importing any file type» | nodo **File** |
| «a node for putting the directory of a folder» | nodo **Folder**, via directory picker |
| «check the server uptime» | nessun timeout esiste; aggiunto watchdog e riavvio |

## 1. Cancellare un workspace senza digitare il nome

La digitazione del nome era una guardia contro il clic sbagliato, e la guardia
vera c'è già: `repository.snapshot(id, 'delete')` viene chiamato **prima** di
cancellare. La conferma ora mostra il nome, il numero di nodi e il fatto che esiste
uno snapshot di ripristino.

## 2. Undo e redo per il documento

Il fatto: **non esisteva un undo dell'app**. Quello che funzionava era l'undo del
browser dentro la `<textarea>`, che è nativo e non toccabile. Per questo «funziona
solo per il testo» era esattamente vero.

`logic/history.ts` + `commit()` nello store. Perché **snapshot** e non patch: una
cronologia a patch deve conoscere l'inverso di ogni operazione, e ogni funzione
nuova ne aggiunge una che si può dimenticare. Gli snapshot sono noiosi e sempre
corretti.

E sono economici, che è la parte che sembrava costosa: lo store usa Immer, quindi
dopo una mutazione il nuovo array **riusa gli stessi riferimenti** per ogni nodo
non toccato. Inserire il vecchio array nella cronologia costa solo i nodi che
stanno per cambiare, e un nodo immagine con una data URL viene copiato solo se
quel nodo viene editato.

| gesto | passi |
|---|---|
| drag di un nodo | 1 |
| frecce tenute premute | 1 (finestra di 600 ms) |
| streaming di una risposta | 0 |
| creare, cancellare, collegare, raggruppare, ridimensionare | 1 ciascuno |

Lo streaming non è registrato: `patchResponse` viene chiamata una volta per token
e una cronologia con un passo per token sarebbe inutilizzabile. Il passo che
conta è quello che ha creato la risposta, che annulla l'intera esecuzione.

Ctrl+Z **non** agisce dentro un campo di testo: lì l'undo del browser è la cosa
giusta. Entrambi disattivati durante una risposta in corso, con un avviso: annullare
mentre il modello scrive darebbe un canvas che lampeggia.

## 3. Il gruppo si trascina

La cornice non può essere spostata da sola: la sua posizione è ricalcolata dalle
risposte a ogni render, quindi una posizione scritta a mano verrebbe annullata di
lì a poco. Trascinare la cornice sposta **le risposte**, dello stesso delta, e la
cornice le segue.

### Bug: il delta si accumulava

Con la cornice ferma nello store durante il drag, ogni `mousemove` misurava lo
stesso scarto e lo riaggiungeva: un drag di 100 px spostava il gruppo di 500 px.
Misurato nel browser:

```
prima della correzione   5 passi da 20px  ->  delta (220, 110) invece di (100, 50)
dopo la correzione       5 passi da 20px  ->  delta (100, 50)
```

La cornice ora segue il puntatore per tutta la durata del drag e l'effetto di
sincronizzazione la riallinea alle risposte quando finisce.

### Bug: un drag abbandonato inquinava il successivo

Se il puntatore viene rilasciato fuori dalla finestra, React Flow non invia mai
`dragging: false` e lo snapshot di inizio gesto sopravviveva. Il drag **successivo**
lo riusava e un solo Ctrl+Z tornava a uno stato di prima di entrambi. Rilevato da un
test che falliva per motivi apparentemente sbagliati. L'id del nodo trascinato fa
parte del record, e ogni passo registrato chiude il gesto.

## 4. Export: `revokeObjectURL` nello stesso tick

`HomePage.tsx:137` chiamava `revokeObjectURL` **immediatamente** dopo
`anchor.click()`. È la causa classica di un download che non parte: il blob viene
rilasciato mentre il download è ancora in coda, e il browser salva un file vuoto.
Nessun errore, nessun avviso in console, e il toast diceva che l'export era riuscito.

`utils/download.ts` è ora l'unico posto che sa consegnare un file al browser:
revoca a 1 s, riporta la dimensione reale, e in caso di errore un toast con
`sticky` invece di un successo non osservato.

Verificato nel browser intercettando `createObjectURL` e `click`:

```
blob 2247 byte application/json
ancora cliccata, nome nchat-untitled-workspace-2026-09-26.json
revoke immediate: 0        <- era 1, il bug
revoke dopo 1s:    1
toast: "Workspace exported. 3 nodes · 1 edges · 2.2 KB"
```

## 5. Il chip «Short»: output più corto

Non è solo un tetto. Un `max_tokens` da solo tronca la risposta a metà frase: il
modello intendeva scrivere un saggio e semplicemente si ferma. Quindi:

- un'istruzione di brevità nel messaggio system, che è ciò che fa scrivere meno;
- un tetto di 400 token, che è ciò che ferma un modello che ignora l'istruzione.

Il tetto **abbassa** solo: un prompt già limitato più stretto mantiene il suo.
La richiesta modificata è quella che va nello snapshot, così «Retry same request»
riproduce esattamente quello che è stato inviato e l'istruzione non viene detta due
volte. Il retry non applica `makeConcise` di nuovo, per lo stesso motivo.

## 6. Immagini nel gruppo

`image` è diventato aggregabile. Un marker testuale da solo non bastava: il modello
avrebbe ricevuto `[image: foto.png]` e niente immagine. `imagePartsOf` segue il
gruppo fino ai nodi immagine e aggiunge le vere image part, quindi una foto
raggruppata con delle risposte arriva **e si vede**.

## 7. Niente titoli nel gruppo

Le risposte alla stessa domanda ripetevano lo stesso titolo `###` davanti a ogni
blocco: tre volte la stessa riga, che il modello paga in token e non usa. Nuovo
formato `plain`: solo i testi, uno dopo l'altro, e i vuoti scartati.

## 8. Nodo File

Formati di testo semplici: `.txt .md .json .csv .yaml .html` e il codice. **PDF,
`.docx`, `.xlsx` e gli archivi sono rifiutati con il motivo**, non tentati: un
estrattore che funziona a metà restituisce spazzatura convincente, e l'utente non ha
modo di accorgersene. Un video rifiutato rimanda al nodo immagine, che sa inviare
un fotogramma.

Il testo viene copiato nel documento, come per le immagini: un unico formato JSON
significa che export, import, copia, incolla, undo e repository funzionano senza
codice dedicato. I costi sono dimensione e contesto, quindi ci sono tre tetti:
2 MB per file, 8 MB per cartella, 120.000 caratteri per testo. **Il troncamento è
dichiarato** nel testo inviato: un modello a cui si dà metà file risponde con
sicurezza su metà file.

## 9. Nodo Folder

Un browser **non può ricevere un percorso**: non c'è accesso al filesystem. Una
cartella arriva solo dal directory picker o da un drop, e ciò che il nodo contiene è
una **copia** fatta in quel momento. Il nodo lo dice sulla faccia, perché un nodo
che sembra vivo e non lo è sarebbe peggio di uno che non potrebbe esserlo.

I file non letti sono elencati per nome con il motivo. Skipparli in silenzio
lascierebbe l'utente convinto che il modello abbia visto tutto.

Il drop di una cartella usa `webkitGetAsEntry`, l'unica porta: `dataTransfer.files` è
vuoto per una directory, e `readEntries` restituisce al massimo 100 elementi per
volta e va richiamata.

## 10. Il server non si chiude da solo

Risposta misurata, non supposizione: **non esiste alcun timeout**. Nel codice
dell'app non c'è nessun `process.exit` e nessun `kill`; Vite non ha timeout di
inattività. Il server avviato alle 12:53 rispondeva ancora alle 14:01, **1h09m**,
27 MB. Se si ferma, è stata chiusa la finestra della console che lo ospita.

Aggiunto comunque un watchdog, perché «non dovrebbe succedere» non è «non succede»:
il controller avvia il server **una volta** da solo se muore, mostra da quanto è su,
e offers «Riavvia il server» nel menu. Un solo riavvio automatico: se muore di
nuovo il problema non è un crash occasionale e insistere sarebbe un loop.

## Due bug di persistenza trovati strada facendo

Entrambi nello stesso posto: `NodeSchema` è un `z.object` che **elimina** le chiavi
che non conosce. Un campo assente dallo schema non è «tenuto così», è cancellato in
caricamento.

**Il toggle Thinking non sopravviveva.** `thinking` non era in `PromptDataSchema`.
Verificato: `{kind, text, params, runCount}` — il campo spariva. Ogni riapertura
riportava l'interruttore al default.

**Un workspace con un'immagine non si riapriva più.** `MessageSnapshotSchema`
dichiarava `content: z.string()`, ma un run con un'immagine ci mette dentro la
picture, perché «Retry same request» deve riprodurla. Il risultato era un errore di
parsing, e il workspace non poteva più essere aperto.

`schema.roundtrip.test.ts` enumera **tutti** i campi di ogni tipo di nodo e verifica
che tornino indietro, più un test che esplicita il comportamento distruttivo. Un
test di questo tipo è l'unico che nota quando qualcuno aggiunge un campo al tipo
TypeScript e non allo schema.

---

# v4 — il nodo Brain: un nodo che lavora sui file e scrive sul disco

## La domanda, e la risposta data prima di scrivere

«Vorrei la possibilità di fare azioni tipo agente» ammette due letture, e una e
robusta mentre l'altra e fragile:

- **A) il nodo guida il ciclo**: per ogni file chiama il modello con
  (istruzione + contenuto), scrive la risposta nella cartella di uscita, passa al
  file successivo. Il modello non decide niente.
- **B) il modello scegli gli strumenti** e decide da solo cosa leggere e scrivere.

Fatto **A**, e il perche e una ragione misurata e non una preferenza: A funziona con
qualsiasi modello e ha un test; B dipende dal *tool calling* del modello locale,
affidabile o no, mai provato su LM Studio. Se lo scopro ora e non funziona, la
funzionalita e morta. Con A il caso descritto e coperto interamente.

La differenza in pratica: scrivi «traduci in inglese» e 17 file diventano 17
traduzioni. Il nodo si chiama Brain e non Agent perche non e un agente: il modello
non vede la cartella, non sceglie uno strumento e non decide cosa succede dopo. Il
contratto e «dato questo file e questa istruzione, cosa deve dire il file», e un
modello locale lo rispetta. Il raggio di danno di una risposta sbagliata e esattamente
un file.

## Le due cartelle, e perche sono la stessa cosa

La richiesta iniziale era che il nodo Folder non avesse un ingresso. Ora ne ha due,
e i due sensi **non sono simmetrici**:

- la cartella che si **legge** e collegata al Brain con un arco in **entrata**;
- la cartella in cui si **scrive** e collegata con un arco in **uscita**.

Sono due direzioni diverse ed e la trappola della funzione. Il bug e comparso due
volte, nello stesso momento, perche la logica era duplicata: il nodo non trovava la
cartella di uscita e il pulsante Run restava disabilitato senza alcun motivo
visibile, mentre il run diceva «nessuna cartella collegata» su un grafo che ne aveva
due. Ora e una funzione sola, `brainFolders` in `logic/brain.ts`, usata da entrambi i
lati, con otto test.

La maniglia di scrittura compare sulla cartella **solo** quando un Brain e collegato.
Una maniglia sempre presente sarebbe una destinazione che si puo trascinare per
errore, su un nodo il cui scopo e scrivere sul disco di qualcuno.

## Il muro: solo la cartella che hai scelto

La sicurezza non e una funzione del nome del file, e una parete. E la prima:

> un `FileSystemDirectoryHandle` puo raggiungere solo la directory che l utente ha
> scelto.

Non e nostra, e del browser, ed e la ragione per cui la funzione esiste. La handle non
viene mai passata a nessuno, non finisce mai nel documento, non viene mai
ricostruita.

La seconda parete e `logic/paths.ts`, e riguarda il **nome**, che invece e
interamente sotto il nostro controllo: un nome di uscita arriva dal testo di un
modello, e un modello produce `../../notes.txt` se gli si chiede nel modo sbagliato.
Le regole sono volutamente noiose: il nome di uscita e sempre **un nome di file**,
mai un percorso; niente separatori, niente due punti, niente caratteri di controllo,
niente NUL, niente punto finale, niente nomi riservati Windows, niente oltre 120
caratteri. **Rifiutare, sempre, e non normalizzare**: un nome riscritto di nascosto in
`output_2.txt` quando il modello aveva chiesto `../../x.txt` nasconde il problema.

Un percorso offerto dal modello viene **accettato** togliendone la foglia: e una cosa
ragionevole da fare e la directory non viene seguita. Un percorso che tenta di
uscire con `..` viene **rifiutato**, non ridotto: quella forma significa che il
modello ha capito male, e scrivere un file chiamato `passwd` nella cartella di uscita
nasconderebbe l'incomprensione invece di mostrarla.

Una riga sola vuol dire un nome proposto, due o piu righe sono contenuto. Non c'e
niente di furbo: indovinare dentro un paragrafo fa finire un file chiamato
«Ecco il testo riscritto:».

## La politica la decidi tu, e il default non perde lavoro

Il setting e nel nodo, perche e una decisione tua e non un default sensato:

| | cosa fa |
|---|---|
| **Rinomina** (default) | scrive `relazione (1).txt`. Non sovrascrive mai. |
| **Sovrascrivi** | riscrive il file. Rischia il lavoro precedente. |
| **Salta** | non scrive, e lo dice nel log. |

Il default e «Rinomina» perche e l'unico dei tre che non puo perdere lavoro, e
sovrascrivere deve essere chiesto.

**Bug trovato qui.** La versione iniziale rinominava solo se il chiamante passava
l'insieme dei nomi occupati. Senza quell'insieme, `Rinomina` **sovrascriveva in
silenzio**: esattamente la cosa che la politica esiste per impedire. Ora l'insieme
viene ricavato dalla cartella quando non e fornito, e c'e un test che lo blocca.

## L'undo non puo annullare un file

E la conseguenza non ovvia, e va detta prima di scrivere il codice: l'undo del
documento riporta indietro i nodi, **non il disco**. Se il Brain scrive 17 file e ne
sovrascrive 3, un Ctrl+Z non li riporta.

Quindi il nodo tiene il proprio registro, e un pulsante **ripristina** lo usa. Ogni
scrittura registra cosa c'era prima: il testo precedente, o l'assenza del file.

**Bug in questo meccanismo.** L'undo di una scrittura *rinominata* riusava `existed`
della scrittura originale. Dunque annullare una rinomina scriveva il testo vecchio
nel file nuovo invece di cancellarlo: restava una copia del lavoro precedente sotto
un nome diverso. Corretto, con test.

## Il costo: le copie dentro il documento

Le copie per il ripristino stanno **nel documento**, non in una tabella a parte. E una
scelta, non una dimenticanza: la handle non e serializzabile e va in una tabella
Dexie dedicata (schema v2), ma il testo di un file sì, e senza questa copia il
ripristino non sarebbe possibile dopo un ricaricamento.

Il prezzo e che il documento cresce. Con i tetti di default (50 file, 60.000
caratteri per file) il caso peggiore e qualche milione di caratteri. Sono tetti
fissi e dichiarati, non una crescita illimitata, ma chi lavora su file grandi deve
saperlo.

## I tetti, e il troncamento dichiarato

| | |
|---|---|
| 50 file per run | i file in piu finiscono nel log con il motivo |
| 4 MB letti in totale | la lettura si ferma e lo dice |
| 40.000 caratteri per file inviati | il modello non vede il file intero |
| 60.000 caratteri per file scritti | il file in e contiene la nota di taglio |
| 40.000 caratteri di stima per il run | il rifiuto avviene **prima** di iniziare |

Il troncamento in uscita si dichiara **dentro il file**:

```
[Note: this file was cut at 60,000 characters by NCHAT.
The rest of the model answer is not in this file.]
```

Un file tagliato senza niente scritto dentro si legge come un documento finito a
chiunque lo apra, ed e esattamente il tipo di errore silenzioso che questo progetto
ha evitato ovunque altrove.

## I permessi, e perche il pulsante Run e il posto giusto

`showDirectoryPicker` funziona solo su Chromium e solo dopo un clic. La richiesta si
fa una volta, la handle si salva, i run successivi scrivono senza chiedere. Se il
browser vuole una conferma, la chiede: ed e per questo che la conferma sta su **Run**,
che e un clic. Su Firefox e Safari `supportsDirectories()` dice di no e il nodo si
rifiuta con il motivo.

Tutti e due i permessi sono risolti **prima** della prima chiamata al modello: un
run non deve scoprire a meta che non puo scrivere.

## Ogni rifiuto resta sul nodo

Un rifiuto che arriva solo in un toast e un rifiuto che l utente ha gia dimenticato
quando si chiede perche non e successo nulla. Ogni uscita anticipata del run scrive
il motivo **sul nodo**, accanto al pulsante che l ha causata.

## Cosa non e stato possibile provare

`showDirectoryPicker` mostra una finestra di sistema e richiede un gesto reale: in
questo ambiente non e riproducibile. Quindi **nessuna scrittura reale su disco e stata
eseguita**.

Cosa e stato verificato:

- la logica dei percorsi, con input ostili: 32 test in `paths.test.ts`;
- il percorso di scrittura e di rollback contro una **cartella finta in memoria**
  (`test/fakedirectory.ts`) che registra ogni chiamata: 29 test in
  `folderActions.test.ts`, fra cui «ogni lookup e un nome singolo, mai un percorso» e
  l'annullamento di una rinomina;
- il piano del run, i messaggi e i tetti: 19 test in `brain.test.ts`;
- le regole di connessione, fra cui **un prompt verso la cartella di scrittura e
  rifiutato** e un Brain verso un prompt e rifiutato;
- nel browser: i nodi, le maniglie, il ruolo della cartella che cambia, la radio della
  politica, il log, e il rifiuto che resta sul nodo.

Cosa resta non provato: la scrittura su un disco vero, e l'attenuarsi del permesso
fra una sessione e l'altra.

---

# v5 — cartelle che funzionano, la domanda sulle immagini, e la lista dei compatibili

## Le cartelle: due meccanismi erano due bottoni e una porta cieca

Il nodo Folder aveva **due** modi per riempirsi: una copia一次性 da
`<input webkitdirectory>`, e la cartella vera concessa con
`showDirectoryPicker`. Due modi che producevano la stessa identica cosa, quindi
due bottoni, e quello della copia era quello che non sembrava fare niente.

La correzione non e aggiu[n]gere un terzo pulsante: e **toglierne uno**. Ora c'e un
solo meccanismo, la cartella concessa, e il testo del nodo si legge da li con
`readGrantedFolder`, che produce la stessa forma di prima. Un percorso solo, un
bottone solo:

- niente cartella: `Choose folder` apre il selettore di sistema
- cartella concessa: lo stesso bottone rilegge, perche il contenuto cambiava e il
  nodo deve poterlo aggiornare

Rimossa anche la copia, e con lei la frase «A copy, not a live link» che costringeva
a capire la differenza. Un nodo che dice una cosa sola e fa una cosa sola.

Il percorso di **drop** di una cartella sul canvas e stato tolto di conseguenza: una
cartella rilasciata non puo essere concessa, quindi produceva un nodo che non
poteva servire a niente. Ora si rilascia e si concede.

## Il Brain poteva leggere solo se qualcun altro avesse concesso la cartella

Il bug che rendeva il nodo inutilizzabile, e che nessun test mostrava: il bottone per
concedere la cartella compariva **solo** sulla cartella di uscita. Quella di ingresso
non aveva nessun modo di diventare leggibile, e il fallimento appariva come un run
che non faceva niente.

Ora il bottone e su ogni cartella, perche serve a leggere **e** a scrivere, e il
Brain nomina la cartella che manca: `Concedi l accesso a ingresso e uscita dal nodo
cartella`, con `serve concedere accesso` accanto a ciascuna.

## Un bottone che non faceva niente

Se il salvataggio della concessione falliva, non succedeva assolutamente nulla:
avevi cliccato `grant` e l'unico sintomo era un Brain che poi non faceva niente.
Ora il motivo compare sul nodo, nel footer e in un toast, e il messaggio del browser
e troncato alla prima riga: il resto sono interni di IndexedDB che a chi legge non
dicono nulla.

## La domanda sulle immagini: opzionale e chiusa

Un campo di testo sull'immagine, **nascosto finche non lo chiedi**, con un
interruttore `Ask about it`. Un modello con visione guarda un'immagine anche senza
domanda, quindi un campo sempre vuoto sarebbe rumore su ogni nodo immagine del
grafo.

Se il campo ha un testo, viaggia **nello stesso messaggio utente** della picture,
sopra la domanda e sotto il contesto. Non un messaggio a se stante: con la domanda
in un messaggio e la foto in un altro, il modello risponde all'ultimo dei due, e la
risposta sarebbe silenziosamente solo sulla domanda.

## La lista dei nodi compatibili, aperta dal trascinamento

React Flow gia rifiuta un drop impossible, ma lo rifiuta mostrando una maniglia
rossa: per scoprire che una connessione non esiste bisogna provarla. Su una cartella
le due maniglie sono identiche e significano cose opposte, leggere e scrivere.

`logic/connections.ts` calcola la risposta come dati puri, e `ConnectTargets` la
mostra come lista quando `onConnectStart` apre il drag. Ogni voce dice **cosa
significa**: `as context`, `as the picture`, `a folder to read`, `a Brain writes
here`. Un nodo con due maniglie valide compare due volte, ed e la lista onesta
perche quella e la lista vera.

Tre cose che la lista ha insegnato scrivendo i test:

- **una risposta non torna al proprio prompt**, perche il legame di esecuzione punta
  gia dal prompt alla risposta e il ritorno chiuderebbe un ciclo. Il primo test che
  ho scritto era sbagliato su questo, e la lista aveva ragione;
- **un prompt non offre niente** dal suo `out`: la sua uscita e un'esecuzione, non un
  filo. Offrire qualcosa sarebbe un vicolo cieco in una lista che serve a evitare
  quelli;
- **l'ordinamento conta**: la lista mette prima la connessione ordinaria. In ordine
  di documento un gruppo finirebbe sopra il prompt, che e il contrario di quello che
  si intende quasi sempre.

Nessuna edge viene creata dal calcolo: `connectionKind` resta a decidere, quindi un
bug nella lista puo offrire una voce sbagliata, mai creare un collegamento sbagliato.
E per quello che `compatibleTargets` riceve il **documento intero** e non un
sottoinsieme: il controllo dei cicli cammina sugli archi, e un argomento ridotto
avrebbe richiesto un cast, che e esattamente come una lista comincia a offrire
connessioni che il grafo poi rifiuta.

## Cosa resta non provato

Il trascinamento vero dal puntatore non e riproducibile in questo ambiente, quindi
il pannello e testato con il `draft` passato esplicitamente: rendering, filtro,
clic che crea l'arco, e i casi in cui non deve offrire nulla. La logica che produce
la lista ha 14 test a parte. La scrittura su un disco vero resta non verificata,
come prima.

---

# v6 — trascini una maniglia, rilasci nel vuoto, e scegli il nodo **successivo**

## La lettura sbagliata, e quella giusta

Avevo costruito una lista che compariva **durante** il trascinamento e elencava i nodi
**esistenti** compatibili. E la domanda sbagliata.

Il gesto «prendo la maniglia e trascino nel vuoto» non chiede «dove voglio
collegarmi», chiede «**qual e il prossimo nodo**». Due ragioni:

- la lista durante il drag copre il puntatore e competes con la linea che si sta
  disegnando, e costringe a cliccare senza poter rilasciare;
- offrire tutto e rifiutare dopo e la cosa peggiore, perche il nodo e gia creato e
  va cancellato a mano.

Quindi il pannello e **stato tolto**. Ora:

1. trascini da una maniglia e rilasci nel vuoto;
2. si apre la palette, **con dentro solo i tipi che collegherebbero davvero** da
   quella maniglia;
3. scegli con il mouse, con le frecce o con Tab, e Enter;
4. il nodo viene creato **nel punto di rilascio** e **collegato**, in un'azione sola.

La palette normale, quella da Tab o dal bottone, continua a offrire tutto: il filtro
vale solo quando e stata aperta da un trascinamento. E lo dice: `Only what this
handle can connect to. Pick one and it is created and wired.` Senza quella riga una
lista piu corta sembra un menu rotto.

## La maniglia di arrivo non e indovinata

`targetHandleFor` calcola quale maniglia del nodo nuovo va usata, con **lo stesso
controllo** che ha prodotto l'offerta e nello stesso ordine. Il perche: se la
maniglia fosse scelta a mano, un tipo comparirebbe nella lista e il filo
atterraggerebbe dall'altra parte, connessione rifiutata e nodo gia creato. C'e un
test che passa in rassegna tutti i tipi offerti e pretende una maniglia per
ciascuno, cosi lista e filo non possono divergere.

Il nodo di prova deve essere **dentro** il documento, non solo nominato: `connectionKind`
risolve i due nodi dal documento, quindi un nodo che non c'e vale come mancante e
ogni connessione viene rifiutata. Me lo insegna un test che restituiva una lista
vuota e sembrava un bug di logica.

## Cosa offre, e cosa no

| da | offre |
|---|---|
| una risposta, `context` | prompt, group |
| un'immagine, `out` | **solo** prompt, via l'ingresso immagine |
| una cartella, `out` | prompt, Brain, group |
| una cartella, `in` | **niente**: quella maniglia riceve, non emette |
| un prompt, `out` | **niente**: la sua uscita e un'esecuzione, non un filo |
| un Brain, `out` | solo cartella, e sul suo `in` |

Le ultime tre sono il motivo per cui la lista serve: sono tutte situazioni in cui
l'elenco completo avrebbe lasciato un vicolo cieco, e in due casi una coppia di
handle che sembrano uguali e significa cose opposte.

## Ordine

La connessione ordinaria viene prima. In ordine di registro un group finirebbe sopra
il prompt, che e il contrario di quello che si intende quasi sempre. Lo stesso
ordinamento e usato per la maniglia di arrivo e per la lista dei tipi, cosi la
prima scelta e anche la prima che il filo usa.

---

# v7 — zoom lontano, nodo Output tolto dalla palette, e un aspetto in piu

## 1. Zoom al massimo: il nodo si offusca e compare una riga che lo spiega

La richiesta: al massimo zoom-out tutti i nodi si sfocano e, **sopra** al
blur, compare un testo che riassume il contenuto.

La soglia e `FAR_ZOOM = 0.55` in `logic/zoomSummary.ts`, ed e un attributo
`data-canvas-zoom="far"` sul contenitore della tela, non una classe e non un
valore nello store. Motivo: e una conseguenza pura dello zoom, non c'e nessun
altro che la legga, e il CSS puo agire senza far iscrivere nessun componente a
niente.

La riga che viene scelta dipende dal tipo di nodo:

| nodo | riga |
|---|---|
| risposta | **il testo della risposta**: la risposta e il lavoro |
| prompt | **le prime parole**, due righe di sorgente: un prompt e un'istruzione, e le sue prime parole dicono di cosa parla |
| immagine | **niente**: resta nitida |
| cartella | `nome · N file`, e `, N non letti` se qualcosa e stato rifiutato |
| file | `nome.md · assaggio del testo` |
| Brain | `Brain · istruzione` |
| nota, sistema, riepilogo, output | il testo |

**Le immagini non si toccano**, e non per dimenticanza: una fotografia sfocata
non riassume niente, e la forma dell'immagine e gia il contenuto. Il contratto
e che `zoomSummary` restituisce `null` per un'immagine, e `null` non e un
risultato mancante: e la risposta "non sfocare niente".

**La cornice del gruppo resta netta.** E un contorno tratteggiato **attorno** ad
altri nodi: sfocarla sfocerebbe le risposte che ha dentro, che mostrano gia la
propria riga. Non ha niente di suo da perdere.

Il riassunto sta **sempre** nel DOM e viene rivelato dal CSS. Un componente che
monta e smonta sul cambio di zoom farebbe ri-renderizzare ogni nodo a ogni
scatto della rotella, e una risposta che sta scrivendo perderebbe la posizione
di scroll.

## 2. Il nodo Output non e piu scegliabile

`output` non e piu `addable`. Un gruppo si fa raggruppando quello che c'e gia
sulla tela, quindi una scheda Output vuota e un vicolo cieco: non ha niente da
raccogliere, e l'unica cosa che se ne puo fare e cancellarla.

La scheda **resta** nel registro e resta un tipo valido: un documento salvato
con dentro dei gruppi deve continuare a aprirsi, e la funzione di raggruppamento
continua a crearne. Il flag dice "non offerto", non "rimosso".

La lista offerta resta derivata dal flag, e un test verifica che sia uguale a
quella: una seconda lista da qualche parte divergerebbe e reintrodurrebbe un
nodo che nessuno voleva offrire.

## 3. Un menu per l'aspetto grafico

`Settings → Appearance → Look`, con due voci: **Solid**, quello di adesso, e
**Liquid glass**.

`appearance` e **separato** da `theme`, e la separazione e deliberata:

- `theme` risponde a "quali colori"
- `appearance` risponde a "che forma e che materiale"

 tenerli separati vuol dire che un aspetto nuovo non deve reinventare una
palette chiara e una scura, e che si puo chiedere una superficie translucida in
entrambe. Il menu dice anche questo, e dice che la scelta si applica subito, cosi
si confronta senza salvare.

`appearance` viaggia con `AppSettings`, **non** con il documento: un aspetto e
una proprieta di questa installazione, e portarlo dentro l'esportazione
porterebbe l'aspetto di una macchina dentro l'altra.

### Il vetro ha bisogno di qualcosa dietro

Il primo tentativo era vetrato e sembrava grigio. Non perche il vetto non
funzionasse: perche **non c'era niente da sfocare**. Dietro ai pannelli c'era un
piano `--bg` piatto, e sfocare un piano piatto dà un piano piatto leggermente
mosso.

Percio la prima regola di `styles/glass.css` non riguarda le superfici, ma lo
sfondo: due gradienti radiali grandi e morbide dietro a tutto. Le superfici
poi diventano translucide con `backdrop-filter`, si arrotondano, e prendono un
bordo luminoso solo in alto, che e la firma del vetro: la luce arriva da sopra.

### Due cose che nascondevano le macchie

Una le copriva e l'altra no, ed e quello il motivo per cui il primo tentativo
sembrava non funzionare affatto:

1. `.react-flow` prende il proprio `--bg` opaco;
2. il `<svg class="react-flow__background">` di React Flow ha un
   `background-color` **proprio** (grigio `#141414` nella variante scura), che sta
   dietro ai puntini ma davanti a tutto il resto.

Bastava toglierne uno solo perche il risultato restasse una lastra piatta. Il
punto e che nessuno dei due e evidente guardando gli screenshot: si vede un
grigio, non si sa chi lo ha dipinto. Serve misurare il pixel.

I puntini del canvas sono rimasti: vengono dal `<pattern>` SVG, cioe da un
attributo `fill`, e non da quel colore di sfondo. Pero il loro **colore** e
divenuto una variabile, `--canvas-dot`, perche dietro ai puntini in aspetto
vetro c'e una lavatura chiara e un puntino bianco sparisce.

### Un `!important` tolto

`.react-flow__minimap` aveva `background: ... !important`. La regola di React
Flow **non** usa `!important`, e `theme.css` viene caricato dopo, quindi la
specificita basta: l'`important` non serviva. Tolto, perche un `!important` non
aggredisce un `!important` (specificita non si somma): se l'aspetto vetro
volesse cambiare la minimappa, avrebbe dovuto duplicarlo, e da li in poi ogni
aspetto futuro avrebbe dovuto fare lo stesso. Uno solo, in un posto solo, e
meglio che due che si contendono.

## Verificato nel browser

- zoom al 48%: `data-canvas-zoom="far"`, i corpi con `filter: blur(5px)` e
  `opacity: 0.4`, i riassunti `display: flex`, e l'immagine con `filter: none` e
  nessun riassunto;
- palette: sette voci, Output non c'e piu;
- aspetto: la voce scrive `data-appearance="glass"` sulla radice, e il valore
  **sopravvive a un reload**;
- liquid glass verificato in scuro e in chiaro, con un confronto dei pixel: il
  canvas passa da `rgb(20,20,20)` (grigio di React Flow) al gradiente ambiente.

452 test in 41 file, typecheck pulito, build ok, lint 0 errori.

---

# v8 — i Settings erano irraggiungibili dalla Home

## Il sintomo

«Non riesco ad arrivare ai settings, il bottone non funziona piu».

Il bottone non era rotto: **non c'era**. O meglio, sulla pagina in cui si atterra
non esisteva un bottone del tutto, e il dialogo non era nemmeno montato.

## La radice: roba dell'app dentro lo shell del workspace

L'app aveva due gusci:

```
.app-root          TabBar, HomePage oppure WorkspaceBoundary, Toasts
  └ workspace      TopBar, FlowCanvas, StatusBar, NodePalette,
                   SettingsDialog, ImportDialog, QueuePanel
```

`SettingsDialog` stava **dentro** il ramo del workspace. Quindi con la rotta
`home` non era renderizzato: nessun bottone, nessuna scorciatoia, e il dialogo
che non esiste. Il collegamento del workspace li aveva gia, quindi dalla Home si
arrivava ai Settings solo con `Ctrl+,` — e `useKeyboardShortcuts`, che gestisce
quella scorciatoia, e dentro lo stesso guscio, quindi **nemmeno quella**.

Tre cose dell'app erano finite dentro il ramo del workspace, e tutte e tre si
manifestavano solo da Home:

| cosa | dentro il workspace | cosa succedeva dalla Home |
|---|---|---|
| `SettingsDialog` | non montato | il bottone impostava lo store e **non compariva niente** |
| `useConnection` | un'istanza per workspace | il polling partiva solo aprendo un workspace |
| `appSettings` su disco | dentro `useAutosave` | **le impostazioni non venivano salvate** |

L'ultima e la peggiore, e non l'ho trovata leggendo il codice: l'ho trovata
facendo la prova al contrario. Ho impostato l'aspetto dalla Home, ricaricato, ed
e tornato il valore precedente. Nello store era nuovo, sullo schermo era nuovo,
sul disco era il vecchio — tre stati in disaccordo, e nessuno che se ne accorga.

## Cosa e cambiato

1. **`SettingsDialog` sale in `.app-root`**, accanto a `Toasts` e
   `WorkspaceConflictDialog`. E una finestra dell'applicazione: connessione,
   aspetto e installazione sono le stesse su ogni pagina. Non perde il workspace
   aperto, perche senza il provider il suo store arriva lo stesso da
   `getActiveWorkspaceStore()`, che `workspaceRegistry.activate` ha gia impostato.

2. **Un bottone Settings nella testata della Home**, accanto a Import JSON.

3. **`useConnection` sale in `App()`** e viene passata giu. Non duplicata: quel
   hook avvia un sondaggio, e due istanze avrebbero fatto due richieste al doppio
   e tenuto due timer.

4. **`useAppSettingsPersistence`**, hook nuovo, chiamato da `App()`. Tolto
   l'effetto equivalente da `useAutosave`, che gira solo con un workspace
   aperto.

5. **`workspaceRegistry.activate(null)` nel cleanup di `WorkspaceBoundary`.**
   `activeWorkspaceId` restava impostato sull'ultimo workspace aperto per sempre,
   anche tornati alla Home: `activeId()` rispondeva di si a "c'e un workspace" con
   la pagina Home aperta. Nessun test lo vedeva, perche ogni test parte su un
   workspace o non tocca il registry.

## La trappola evitata

La tab Generation ha dentro i **default di campionamento**, che sono del
workspace: senza workspace aperto non hanno dove scrivere. mostrarli avrebbe
significato accettare un valore e perderlo al prossimo riavvio, senza dire niente.

Quindi senza workspace la sezione dice cosa serve e **non mostra i controlli**:

> These belong to a workspace, not to the app, so they need one open.

Il resto della scheda — streaming, coda, compattazione, prompt di fallback — e
dell'app e resta disponibile ovunque. Coprire tutto il dialogo sarebbe stato
semplice, ma avrebbe negato alla Home anche le impostazioni che funzionano.

`activeId()` e letto al render e non con una subscription, e va bene: il dialogo
e modale, quindi il percorso non puo cambiare mentre e aperto.

## Verificato nel browser

- dalla Home: il bottone esiste, il dialogo si apre, le cinque schede ci sono;
- scelta dell'aspetto dalla Home, reload: **il valore è ancora li** (prima tornava
  indietro);
- tab Generation dalla Home: i campi del workspace nascosti con la nota, quelli
  dell'app presenti;
- tab Generation nel workspace: i campi del workspace tornano, la nota no.

456 test in 41 file, typecheck pulito, build ok, lint 0 errori.

---

# v9 — modelli in cloud, con la chiave che non esce mai dal processo locale

## La domanda che mi hai lasciato a me

> onestamente non ti so dire io capisci tu quale e la migliore opzione

La risposta non e "dal browser" ne "dal processa locale" per principio, ma per un
fatto che ho verificato prima di scegliere: **oggi non esiste un processo che
possa tenere una chiave.** Il proxy `/lm` e quello della dev di Vite, e il tray si
limita ad avviare e fermare il dev server. Quindi la domanda non era retorica, e la
risposta non poteva essere "come prima".

Scelta: **un processo locale in Node, con la chiave solo in memoria.**

- I quattro provider che hai scelto sono *probabilmente* chiamabili dal browser,
  ma non l'ho potuto verificare con sicurezza e cambia nel tempo. Una strada che
  funziona sempre vale piu di quattro che funzionano quasi sempre.
- La chiave non tocca mai il disco: ne IndexedDB, ne localStorage, ne un file.
  E un'affermazione che posso fare davvero, e non "dovrebbe essere".
- Tutte le `fetch` restano in `src/llm/`, quindi il vincolo del progetto regge: per
  un provider cloud l'app punta a se stessa invece che a un remoto. La forma della
  richiesta non cambia, cambia l'indirizzo.
- Costo: un processo in piu nel tray, e **la chiave va reinserita quando il
  servizio si ferma**. Se la persistenza ti serve, e una seconda storia di
  sicurezza, non una riga.

## Le tre regole del proxy, che il codice non puo dimenticare

`tools/cloud-proxy.mjs`, ~200 righe, `node:http` e la `fetch` globale di Node 20.
Nessuna dipendenza.

1. **La chiave non esce mai.** Variabile e basta. Nessuna risposta la contiene,
   nessun log la contiene, non viene scritta. `/status` dice *quali* provider hanno
   una chiave, mai *quale*.

2. **Gli indirizzi stanno nel proxy, non arrivano dalla pagina.** Se la pagina
   potesse scegliere la destinazione, un sito qualsiasi aperto nel browser
   registrerebbe la propria baseUrl sotto un provider noto e la chiave di quel
   provider finirebbe li'. L'unica baseUrl che la pagina puo indicare e quella di
   `custom`, che serve esattamente per questo. Su `https` sempre, su `http` solo in
   loopback.

3. **Solo localhost, e solo da una pagina localhost.** Si ascolta su 127.0.0.1 e
   una richiesta con `Origin` non locale viene respinta. Un'altra scheda del browser
   delega a `Origin`, quindi e il buco che si chiude davvero.

## Il menu

`▣` per locale, `☁` per cloud, e il **bordo cambia colore**: e l'unica cosa che
l'utente deve notare senza leggere. Con un provider in cloud, quello che esce dalla
macchina e diverso, e un bordo colorato lo dice prima del primo prompt.

Il selettore sta in alto, non solo nei Settings, perche e una scelta **per corsa**:
passi al cloud, lanci, torni indietro. Sotterrarla in un dialogo obbligherebbe ad
aprire i Settings ogni volta, e la lista dei modelli accanto mostrerebbe intanto
quelli locali mentre il provider e altrove.

Il nome e scritto per esteso: "Groq" e "NVIDIA NIM" si somigliano a dieci caratteri,
e un prompt mandato al posto sbagliato e gia uscito dalla macchina quando te ne
accorgi.

Senza chiave il menu dice `no key yet — open settings`. Un menu che offre quattro
voci inutilizzabili e peggio di uno che dice perche.

## Cosa funziona e cosa no

Funziona: **chat e immagini**, che era la tua scelta.

**Il Brain no**, e non per un limite tecnico. Un Brain manda a un modello il
contenuto di ogni file delle cartelle collegate: con un provider in cloud uscirebbe
dalla macchina il testo delle tue cartelle, e tu avresti scelto quel provider per una
chat. Non e una cosa che si lascia accadere in silenzio.

Il rifiuto e in due punti, e serve la duplicazione:

- **sul nodo, subito**, come motivo del bottone disabilitato. Viene *prima* del
  controllo sulle cartelle, perche e l'unico blocco che il cablaggio non risolve: se
  fosse ultimo, l'utente concederebbe l'accesso a due cartelle, scriverebbe
  l'istruzione, e solo allora scoprirebbe che non parte.
- **in `runBrain`**, che e quello che ferma davvero, e copre le chiamate da codice.

Nessun rifiuto arriva solo come valore di ritorno: un rifiuto che sparisce e un
rifiuto che l'utente non ha.

## Le sonde di LM Studio non vanno in cloud

`/api/v1` e `/api/v0` esistono solo in LM Studio. Se fossero usate in cloud, un
provider che risponde 404 verrebbe scambiato per "LM Studio versione antica", e
l'app cambierebbe il modo in cui carica i modelli. Il sintomo sarebbe "non riesco a
caricare il modello" su un provider dove il modello e gia in piedi. Stessa cosa per
`ensureLoaded`: caricare un modello in memoria e un concetto di LM Studio.

## Verificato

**Il proxy, 15 test con un finto provider in locale** (`node --test`, escluso da
vitest perche apre porte vere): la chiave non esce, gli indirizzi non si dirottano,
`Origin` esterno 403, `413` e non socket chiusa su un corpo enorme, streaming che
arriva a pezzi, stato di errore del provider propagato e non riscritto in 200.

**Il percorso completo, davvero.** Ho avviato il proxy, registrato una chiave
*finta* su groq e chiesto `/p/groq/models`. La risposta e stata:

```json
{"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}
```

Quella 401 e di **Groq**, non del mio proxy. Quindi app -> proxy -> api.groq.com
funziona, con la chiave aggiunta dal proxy. La chiave finta e proprio cio che lo
dimostra senza averne una vera.

**482 test in 43 file** + 15 del proxy, typecheck pulito, build ok, lint 0 errori.

## Cosa NON ho potuto verificare

- **Nessuna chiamata vera a nessun provider.** Non ho chiavi e non le chiedo. Gli
  indirizzi in `PROVIDERS` sono la mia conoscenza, non una misurazione: se un
  provider li cambia, si corregge in quel file e in un posto solo.
- **La lista dei modelli in cloud** passa dal proxy come quella locale, ma non l'ho
  vista con un account vero.
- **La visione** non e verificata per nessun provider. Per questo la capacita e
  dichiarata `'ask'` dove non e nota: e il **modello** a sapere se legge immagini,
  non il provider, e dichiararlo sarebbe inventare. Groq e l'unico `no` dichiarato.
- La persistenza della chiave: ora non c'e, di proposito.

## Una cosa che ho corretto strada facendo

Il primo `readBody` faceva `request.destroy()` su un corpo troppo grande, e il
client riceveva una socket chiusa invece di un errore: avrebbe pensato che il
servizio fosse caduto. Ora la risposta e `413` e il corpo si scorre comunque, perche
una richiesta che non finisce non finisce mai.

---

# v10 — il cloud che sembrava fittizio: cinque bug, e come si vedono

Hai scritto: «non mi hai dato il menu per scegliere fra api e LM Studio, il menu
in alto e rotto, i colori sono sbagliati, e sembra che non stia usando un sistema
API vero».

Tutte e quattro le cose erano vere. La quarta era la importante, e nascondeva
**cinque** difetti distinti. Nessuno si vedeva leggendo il codice, e tre non si
vedevano nemmeno con i test.

## 1. Il menu: due stati, non una lista di sei

Un menu di sei nomi di provider non e un menu di modalita. Sono due cose diverse:
una e un programma su questa macchina, l'altro e il computer di qualcun altro a cui
va il tuo prompt. Ora:

- **Local | API**, uno switch a due, in alto a sinistra della barra;
- il secondo controllo — **quale** provider — compare solo in modalita API,
  perche solo li c'e un provider da scegliere.

Il colore dice lo stato senza lettura: grigio per locale, accento per API, ambra
quando manca qualcosa.

## 2. I colori: il viola non significava niente

Il tentativo precedente usava `--accent-2`, un viola, come sfondo e bordo del
selettore. Non diceva nulla che il testo non dicesse gia, e stonava con tutto il
resto. Tolto. Ora la tinta veicola informazione: **accento = API**, e ambra quando
c'e un blocco, verde quando il provider ha risposto.

## 3. Il CORS: il bug che solo il browser poteva mostrare

Il proxy non mandava **nessuna intestazione CORS**. Il `PUT` che registra la chiave
veniva bloccato dal preflight del browser, e l'app concludeva che il servizio locale
non fosse in esecuzione — anche se era in ascolto e rispondeva.

Il sintomo e indistinguibile da un servizio spento. E **tutti i test passavano**,
perche CORS non esiste in Node: i 20 test del proxy girano su Node, quindi la
browser non li esegue e loro non lo vedono.

Ora il proxy risponde al `OPTIONS` e riflette l'origine ammessa — riflessa, non
`*`, perche un `*` darebbe accesso anche da siti terzi. Quattro test nuovi sul
preflight e sulle intestazioni, che per natura non sarebbero bastati: serviva il
browser.

Un bug di secondo ordine emerso subito: le intestazioni erano calcolate **dopo** il
controllo sull'origine, quindi la risposta di rifiuto cadeva nella zona morta
temporale e un 403 diventava un 500 — l'errore peggiore, perche dice «il servizio e
rotto» quando ha fatto esattamente quello che doveva.

## 4. La lista modelli veniva svuotata

Il menu modelli filtra su `type === 'llm'`, e il parser metteva `'other'` quando il
campo `type` mancava. Ma un endpoint `/models` OpenAI-compatible **quasi non manda
quel campo**: e un'estensione di LM Studio, non dello standard.

Quindi la lista di **ogni** provider cloud finiva filtrata via, il menu restava
vuoto, e tutto sembrava funzionare. Il fallback e ora `'llm'`: il prezzo e che un
modello di embedding finisce in lista, e allora la richiesta fallisce con un errore
del provider che lo dice — un modo onesto di scoprirlo. Il contrario, non mostrare
niente, e un vicolo cieco. Anche `vlm` conta come `llm`: un modello con visione e un
modello di chat, e classificarlo «altro» nascondeva l'unico provider con le immagini.

## 5. Le impostazioni dell'app esistevano in due copie

Questa e la radice di «sembra fittizio», e ha tre sintomi diversi.

Le impostazioni dell'app stanno nello store UI, che e quello vivo, e in una copia
nello store del workspace, aggiornata solo al salvataggio. La corsa leggeva **la
copia**. Quindi: la barra mostrava un provider, la richiesta andava a un altro, e
l'errore nominava un provider che l'utente non aveva scelto.

Tre i punti in cui si vedeva:

- **`liveSettings()`**: la regola e una riga e sta in `llm/client.ts`, che e il posto
  dove si costruisce un client. La parte dell'app dallo store UI al momento
  dell'uso, quella del workspace dal suo store. Cambiare provider, chiave o
  indirizzo vale per la corsa successiva, senza salvare niente.
- **il modello**: `resolveModel(document.settings)` mandava un id di modello del
  provider precedente. Con un catalogo nuovo, la richiesta partiva e il provider
  rispondeva 404 su un modello che non ha: la colpa sembrava dell'app.
- **la validazione**: diceva «No model is selected» mentre il menu aveva un modello
  evidenziato.

Un altro difetto della stessa famiglia: **cambiare provider non ricontrollava la
connessione**. Il controllo girava all'avvio e poi ogni due minuti, e la pillola
continuava a dire «Offline» perche LM Studio e la sua idea di backend. Ora la
reazione e in `useConnection`, in un effetto che dipende da provider, chiave e
indirizzo: un posto solo, cosi non si puo dimenticare un modo di cambiare provider
— dal selettore, dai Settings, o da un import.

## 6. Due 401 che non sono la stessa 401

Il proxy risponde `{"error":"no key registered for ..."}` quando e stato riavviato e
non ha piu la chiave. Ma l'app mappava **qualsiasi** 401 su «il provider ha rifiutato
la chiave», mandando l'utente a correggere una chiave che era giusta.

Due problemi diversi, due posti diversi in cui andare. Ora la 401 del proxy dice che
il servizio e ripartito a vuoto, e cosa fare.

Aggiunti anche 401/403 del provider, 429 con la quota, e modello sconosciuto — tutto
nominando il provider invece di LM Studio.

## 7. Un provider che risponde in streaming a una richiesta che non lo chiedeva

`stream: false` su una richiesta non-streaming, e poi `response.json()` su un corpo
SSE: `Unexpected token 'd'`. Molti servizi OpenAI-compatible ignorano quel flag. Ora
si guarda il `content-type` e si legge di conseguenza.

## 8. L'indirizzo e scrivibile per ogni provider

Ho cambiato una decisione di sicurezza, e lo dico apertamente.

Prima un indirizzo mandato dalla pagina poteva cambiare la destinazione **solo** per
`custom`, perche altrimenti un sito qualsiasi avrebbe potuto dirottare la chiave di
un provider noto. Ora si puo fare per tutti, perche mi sono reso conto che **gli
indirizzi di questo progetto sono conoscenza, non misurazioni**: un provider che li
cambia lascerebbe l'utente con un menu che non funziona e nessuna uscita. E
l'utente e la pagina sono la stessa persona.

La difesa **non si sposta**: resta il controllo su `Origin`, che chiude le altre
schede del browser, uniche a poter parlare con il servizio. Qui si valida solo che
l'indirizzo sia `https`, o `http` in loopback. Il proxy risponde anche con
`overridden`, cosi l'app puo dire se stai usando l'indirizzo scritto da te.

## Verificato

**Il percorso completo, dall'interfaccia.** Ho scritto `tools/fake-provider.mjs`, uno
stub che parla l'API OpenAI in loopback, e l'ho puntato come `custom`:

- switch su **API**, provider scelto dal menu;
- **Connected**, e «2 models available» in verde;
- prompt lanciato dalla tastiera dell'app;
- risposta arrivata **in streaming, a pezzi**, attraverso il proxy:
  `Hai detto: spiegami come installare linux. Risposta dal provider finto, modello finto-grande.`
- a piè della risposta: `finto-grande · 140 ms · ~24 tok`.

**Un provider vero.** Con `nvidia` selezionato e una chiave finta, l'app ha letto
il catalogo **reale** di NVIDIA NIM — oltre 80 modelli, `nvidia/nemotron-3-ultra-550b-a55b`,
`meta/llama-3.2-90b-vision-instruct` e cosi via. E su una richiesta di chat ha
ricevuto da NVIDIA `{"status":401,"title":"Unauthorized","detail":"Authentication failed"}`,
che l'app ha tradotto in «NVIDIA NIM refused the API key».

Quindi: la lista modelli arriva davvero da un servizio in cloud, e una richiesta di
chat arriva davvero a un provider vero e torna con la sua risposta.

**494 test in 44 file** + 20 del proxy, typecheck pulito, build ok, lint 0 errori.

## Cosa NON ho potuto verificare

- **Nessuna risposta da un provider vero con una chiave vera.** Non ho chiavi e non
  le chiedo. Quello che ho provato e il percorso: rete, proxy, streaming, mappa degli
  errori, e il catalogo reale di NVIDIA. Il primo token di un modello pagato non
  l'ho visto arrivare.
- **La visione** resta non verificata per ogni provider. Per questo la capacita e
  `ask` dove non e nota: e il modello a saperlo, non il provider.
- La persistenza della chiave: ora non c'e, di proposito.

## Una lezione su come si trovano questi difetti

Quattro dei cinque non si trovavano leggendo il codice, e due non si trovavano con i
test. Si trovavano facendo la cosa vera e guardando lo schermo: lo switch, il
colore, il menu vuoto, l'errore che nominava il programma sbagliato.

Il proxy era "verificato" da 15 test e non funzionava nel browser, perche i test
giravano su Node dove CORS non esiste. La lista modelli era "verificata" e per
ogni provider cloud era svuotata, perche il test usava una risposta con `type` che
un provider vero non manda.

Un test che non puo fallire non e una verifica. Il browser resta l'unico posto dove
qualcosa si rompe davvero.

---

# v11 — un solo provider, e il menu modelli che segue il provider

## Le richieste

> «togli tutte le altre opzioni, fammi NVIDIA NIM che ho gia la chiave»
> «ora il menu dei modelli di LM Studio non c e piu quando passo a LM Studio, e
> fai che cambiando provider cambi anche il menu dei modelli»

La seconda era un difetto vero, e non di aspetto.

## Un provider solo

Via GitHub Models, Google AI Studio, Groq e «un servizio OpenAI-compatible qualsiasi».
Restano **LM Studio** e **NVIDIA NIM**.

Il motivo non e che gli altri non funzionerebbero: e che **non li ho mai verificati**.
Le loro API sono indirizzi che conosco, non che ho misurato, e un menu che offre
servizi non verificati e un menu che sembra funzionare e non funziona. Meglio uno che
funziona.

Un servizio «qualunque OpenAI-compatible» e la stessa cosa detta in peggio: richiederebbe
all'utente di sapere gia dove guardare, e l'app non potrebbe verificarlo.

Tolto anche il caso `no-address` in `prepareProvider`, che era diventato codice morto: se
nessun provider ha un indirizzo da scrivere, il ramo sembrava una condizione reale.

## Il difetto: la lista modelli non cambiava con il provider

Dopo lo switch a LM Studio, il menu mostrava **tutto il catalogo di NVIDIA**, 82 modelli.
Sceglierne uno avrebbe mandato un id di NVIDIA a un servizio che non ce l'ha: la
richiesta sarebbe partita e sarebbe tornata con un errore su un modello inesistente.

La causa era che **la lista dei modelli esiste in due copie**:

- il menu la legge da `modelStore`;
- `setConnection` scrive la sua lista in `uiStore`.

Il fallimento della connessione svuotava solo `uiStore`, cioe quella che nessuno
leggeva. Il risultato era una lista che non si svuotava mai.

Tre correzioni, tutte perche una sola non bastava:

1. **il percorso di fallimento svuota anche `modelStore`** e azzera il modello scelto;
2. **l'effetto sul cambio di provider svuota la lista prima di ricontrollare**, perche
   fra lo switch e la risposta passano uno o due secondi, e in quelli il menu mostrava
   ancora il provider precedente;
3. **il clic stesso svuota la lista**, perche (1) e (2) girano in un effetto: senza (3)
   la lista restava visibile per un frame, e un id scelto in quel frame partiva
   sbagliato.

Il punto (3) sembra pignolo e non lo e: e la differenza fra «la lista si svuota quando
l'effetto gira» e «la lista si svuota quando clicchi».

## Un test che blocca la regressione

`useConnection.models.test.ts`, cinque casi, e due sono la difesa:

- dopo il passaggio a un provider irraggiungibile, **non resta nessun modello** del
  provider precedente e il modello scelto e `null`;
- **prima** che il provider nuovo risponda, la lista e gia vuota — il caso provider
  lento, che e quello che succede davvero.

E un quinto caso fa il contrario: **LM Studio che funziona continua a riempire il menu**.
Una correzione che svuota sempre la lista romperebbe la strada che gia funzionava, e il
test se ne accorgerebbe.

## Verificato nel browser, nelle due direzioni

| passo | provider | connessione | modelli nel menu |
|---|---|---|---|
| 1 | NVIDIA NIM | Connected | **82**, il catalogo reale |
| 2 | Local, subito | Connecting | **1** (il segnaposto), selettore provider sparito |
| 3 | Local, assestato | Offline | 1, con il messaggio su LM Studio |

## Note

Le ho scritte in `idk/NOTE-cloud.md`, che anche il punto in cui tenere appunti.

`tools/fake-provider.mjs` e uno **stub di test**, non una parte dell'app: un server in
loopback che parla l'API OpenAI, usato per verificare il percorso completo senza chiavi
e senza mandare niente fuori dalla macchina. Il suo file lo dice nella prima riga.

**499 test in 45 file** + 21 del proxy, typecheck pulito, build ok, lint 0 errori.

## Cosa serve da te

La tua chiave NVIDIA. **Non incollarla qui**: mettila in Settings → Connection → API key,
e il pulsante «Give the key to the local service» la passa al processo locale.

Dopo quello posso verificare che un prompt torni con una risposta vera da un modello
pagato, che e l'unica cosa che non ho potuto provare.

---

# v12 — un registro che si legge, e che non rovina niente

## La richiesta

> «implement a log so if an error occur from the provider or internal to the web app
> i can see what it is»

Serve perche **«non funziona» non e un messaggio d'errore**. Un 401 da un provider e
un'eccezione dell'app hanno due forme diverse e due soluzioni opposte, e senza un
posto dove leggerle si confonde l'una con l'altra: si riavvia, si cambia una chiave,
si tocca un timeout, e non si scopre mai quale delle due fosse.

## Dove si scrive

| fonte | cosa finisce nel registro |
|---|---|
| `provider` | ogni risposta non riuscita, con lo stato e il corpo |
| `app` | connessione riuscita o fallita, eccezioni non gestite, promesse rifiutate |
| `llm` | corsa rifiutata prima di partire, corsa fallita a meta, rete irraggiungibile |
| `proxy` | servizio locale assente, chiave rifiutata, indirizzo rifiutato |

La distinzione `provider` / `app` e il punto: sono problemi opposti, e un registro
che li mescola e peggio di nessun registro.

Si apre da **⋯ → Log**.

## Le tre decisioni che contano

### 1. La chiave non ci entra mai

Il registro finisce in un file che l'utente incolla per farsi aiutare. Se contiene
una chiave, quel file e un danno che nessuno puo piu annullare: la chiave va ruotata
per forza e l'utente non lo sapra mai.

Due livelli, perche uno solo non basta:

- **i nomi dei campi**: un dettaglio `apiKey` diventa `[non registrato]`, e cosi
  `token`, `secret`, `password`, `authorization`, `cookie`. Nessuna regex sulla
  chiave lo fermerebbe, perche il pericolo e il *nome del campo*.
- **il contenuto**: `redact` sulle chiavi note (`nvapi-`, `sk-`, `ghp_`, `github_pat_`),
  su quello dopo `Bearer`, e su **qualsiasi stringa di 40 caratteri o piu**, perche
  non sappiamo come si chiama la chiave di un provider che non abbiamo scritto noi.

E i valori lunghi vengono troncati **dicendo quanto erano lunghi**: un troncamento
silenzioso sembra un dato piccolo invece di un troncamento.

`key.slice(-4)` non finisce in memoria da nessuna parte: l'impronta serve solo a
capire se la chiave e cambiata, e un numero basterebbe.

### 2. Un anello, non una lista

500 voci in memoria, 200 su disco. Un ciclo che sbaglia mille volte al secondo deve
riempire la memoria **una volta sola**, non far cadere la scheda che lo sta scrivendo.
E si tengono le ultime, perche sono quelle che servono.

### 3. Sopravvive al riavvio

L'errore che ti interessa e spesso quello che ha fatto cadere la pagina, e un registro
in memoria muore con la pagina. Gli ultimi 200 finiscono in `localStorage` e tornano
all'avvio, **marchiati come provenienti dalla sessione precedente**: senza il
marchio, un errore di due giorni fa sembrerebbe appena successo.

`restoreLog` va chiamata **prima** di ogni altra scrittura. Se il ripristino
avvenisse dopo, quella prima scrittura salverebbe un anello vuoto e le voci
precedenti sparirebbero dal file: il modo piu veloce per perdere esattamente il log
che serviva.

## Due difetti che il registro ha trovato in se stesso

**Il pannello mostrava zero voci con due voci in memoria.** Il logger aggiunge con
`push` e **muta lo stesso array**: la reference non cambia mai, quindi la `useMemo`
dipendente da `entries` non si ricalcolava piu. Un registro che mente e la cosa
peggiore che possa fare — si apre quando qualcosa e andato storto e risponde «tutto a
posto». Tolta la memo: 500 voci non costano niente, e la memo era un'ottimizzazione
per un lavoro che non esiste che ha comprato un bug.

**«Connesso» ogni due minuti.** Il controllo gira ogni 30 secondi quando non va e ogni
120 quando va, e ogni giro scriveva una riga. In un registro che l'utente apre per
trovare un errore, una riga ogni due minuti vale come non scriverla: non dice niente
e spinge in fondo le righe che servono. Ora `info` solo quando **qualcosa e cambiato**
— provider diverso, o numero di modelli diverso — e `debug` il resto. Stessa cosa per
la consegna della chiave al servizio locale.

## Verificato nel browser

| voce | come e nata |
|---|---|
| `Connessione fallita con Local (LM Studio)` | passo a Local con LM Studio spento |
| `Local (LM Studio) ha risposto 502` | il proxy di sviluppo che non arriva a LM Studio |
| `NVIDIA NIM (cloud) ha risposto 404` | corsa su un id di modello che non esiste |
| `Corsa fallita: NVIDIA NIM (cloud) returned 404.` | la stessa corsa, dal lato del modello |
| `Uncaught: ResizeObserver loop completed...` | un'eccezione interna non gestita |
| `Promessa rifiutata senza gestione` | una promessa senza `catch` |
| `Uncaught: errore di prova non gestito` | un `throw` deliberato |

E il pannello mostra `8 errori · 4 avvisi · 7 info · 4 dettagli · 23 voci in memoria`,
con i filtri per livello e per fonte, la ricerca che guarda anche dentro il dettaglio
(un errore si riconosce dal corpo della risposta, non dalla sua descrizione in una
riga), il copia-incolla e il salvataggio come file con la data nel nome.

## Una nota onesta

Il registro ha anche mostrato `Rendered more hooks than during the previous render`, che
era un artefato del ricaricamento a caldo mentre un file era momentaneamente a zero
byte — non un difetto del codice. Dopo un riavvio pulito non compare. Lo dico perche il
primo istinto sarebbe stato chiamarlo un bug e correggere a caso.

**532 test in 47 file** + 21 del proxy, typecheck pulito, build ok, lint 0 errori.

---

# v13 — Google AI Studio, e una chiave per provider

## La richiesta

> «aggiungi compatibilita di api di google, aggiungi una opzione google nelle
> impostazioni cosi posso passare a quelle oltre a quelle nvidia»

Il catalogo era `lmstudio` + `nvidia`, perche l'avevo ridotto a un provider solo
su richiesta precedente. Aggiungerne un secondo non e «una riga in piu»: cambia
davvero il modo in cui le chiavi vivono, e introduce un buco che con uno solo
provider non esisteva.

## Il provider

`google` passa dal **livello di compatibilita OpenAI** di Google, non dall'API
nativa:

```
https://generativelanguage.googleapis.com/v1beta/openai
```

Il client di questa app parla OpenAI, e la chiave va in `Authorization: Bearer`
come in tutti gli altri posti. Il percorso finisce in `openai` perche e cosi che
l'app aggiungendo `/chat/completions` ottiene `/v1beta/openai/chat/completions`,
che e l'indirizzo giusto. L'indirizzo resta **solo nel proxy**: la pagina non puo
scegliere la destinazione di una richiesta che porta una chiave.

Visione dichiarata `ask`, anche se Gemini legge immagini: e il **modello** a sapere
se accetta immagini, non il servizio, e Google mescola modelli con e senza visione.
Dichiarare `yes` direbbe all'utente che puo mandare un'immagine a un modello che la
rifiuta, e l'errore arriverebbe come un blocco invece che come una scelta.

## La cosa che non era facoltativa: una chiave per provider

`apiKey: string` e diventato `apiKeys: Partial<Record<ProviderId, string>>`.

Con una chiave sola, passare a Google significava **mandare la chiave NVIDIA a
Google** e ricevere un 401 che non spiega niente: la chiave c'e, ed e semplicemente
quella di un altro servizio. E il peggiore tipo di errore, perche sembra una
password sbagliata e si fa ripetere all'utente una chiave che era giusta.

Tre conseguenze, ognuna con la sua ragione:

- **`apiKeyFor(settings, provider)`** in `types/settings.ts`: un posto solo che
  legge la chiave e la taglia. Leggere `apiKeys[provider]` in quattro punti sono
  quattro occasioni di dimenticare il taglio, e una chiave che *sembra* compilata
  produce un 401 invece di un chiaro «manca la chiave».
- **`useConnection` dipende dalla chiave del provider scelto**, non da tutte. Con
  tutte le chiavi nelle dipendenze, salvare quella di Google ricontrollerebbe la
  connessione mentre si guarda NVIDIA; e inserire la chiave del provider successivo
  non farebbe partire nessun controllo, e il primo sintomo sarebbe una lista di
  modelli vuota senza spiegazione.
- **Il campo dice quale provider e**, e sotto dice quali altri ne hanno gia una.
  Senza quella riga l'utente cambia provider, trova il campo vuoto e pensa di aver
  perso la chiave: uno schermo che sembra aver perso il lavoro e peggio di uno che
  non lo ha mai chiesto.

### La migrazione

`apiKey` resta nello schema e viene spostata sotto il provider che il documento
nomina. Riscrivere a mano una chiave perché l'app ha cambiato forma e un modo
perfettamente evitabile di perderne una, e il danno non e visibile subito.

La regola e piu stretta di quanto sembra: il vecchio `apiKey` vale **solo se
`apiKeys` e assente del tutto**, non se c'e ma manca questo provider. Il motivo e
chi puo aver scritto il file: un documento con `apiKeys` e stato scritto da una
versione che ha le chiavi per provider, e quella versione non scrive mai `apiKey`.
Quindi un `apiKey` accanto a un `apiKeys` vero e o roba modificata a mano o un
residuo, e onorarlo potrebbe **resuscitare una chiave che l'utente aveva gia
sostituito** — cosa peggio che perderla, perche nulla direbbe che era stata
sostituita.

## Due difetti che l'aggiunta ha fatto trovare

### Le impostazioni dell'app non erano mai state verificate

Le `appSettings` sono l'unica cosa che questo progetto legge da IndexedDB **senza**
passare da `normalizeDocument`, perche appartengono all'installazione e non a un
workspace. Il prezzo: i controlli di `sanitizeSettings` non giravano, e non era una
cosa teorica — un `provider` preso da IndexedDB arrivava dritto nel percorso della
richiesta senza mai passare da `isProviderId`, che e il controllo che impedisce a
un valore modificato a mano di diventare una destinazione. Con un provider solo il
danno era invisibile; con due, scegliere quello sbagliato smette di essere un
errore che si vede.

Ora `sanitizeAppSettings` passa dalla **stessa** funzione che i documenti usano. Una
seconda implementazione delle stesse regole e un secondo insieme di regole che
divergano.

### Cancellare la chiave non la cancellava

Il campo vuoto e una promessa, e il messaggio sotto il campo dice esattamente che
la chiave non viene scritta e non viene mandata fuori. Ma il proxy la tiene in
memoria finche non glielo si dice: cancellare il campo lasciava la credenziale viva
e ancora in uso, e le richieste successive continuavano a mandarla a un provider per
cui l'utente aveva deciso di non usarla piu. Si cancella una chiave proprio quando
ci si e fidati abbastanza da volerla fuori dai registri del servizio.

`prepareProvider` ora chiama `forgetKey` quando la chiave manca. Un posto solo, e
quindi tutti i percorsi coperti: campo svuotato, provider cambiato, chiave non
riempita.

E il messaggio di stato era **un booleano che diceva due cose**: «il servizio gira»
e «ha la chiave di questo provider». Il caso che conta e il terzo — servizio che
gira, chiave nel campo, non ancora consegnata — e li la riga diceva all'utente che
poteva chiudere le impostazioni. Ora sono due fatti tenuti separati, con `registered`
che dice la verita.

## Verificato nel browser

| voce | come e nata |
|---|---|
| Google risponde `400 "Please pass a valid API key"` | chiave di prova su Google |
| `Google AI Studio (cloud) needs an API key.` | cambio provider senza chiave |
| `The local service is running. Paste a key above…` | stato dopo la cancellazione |
| `registered: ["nvidia"]` | il proxy ha dimenticato la chiave di Google |
| `Key already saved for: NVIDIA NIM (cloud).` | riga sotto il campo, su Google |
| `Connected, 82 models` | ritorno a NVIDIA, la sua chiave intatta |
| migrazione in IndexedDB | scrittura della forma vecchia, ricarica, `apiKeys.nvidia` presente |

La risposta di Google e la prova che l'indirizzo e giusto: e l'errore di Google, non
uno nostro, e dice che la chiave e **arrivata** e non valida — che e esattamente la
direzione in cui volevamo fallire.

Una cosa da dire chiaramente: **nessuna richiesta a un modello a pagamento e stata
verificata.** Si arriva fino al 400 di Google, e oltre serve la chiave vera dell'utente,
nel campo di Settings e non in chat.

**544 test in 47 file** + 21 del proxy, typecheck pulito, build ok, lint 0 errori.

---

# v14 — il riepilogo a zoom lontano era illeggibile proprio quando serviva

## La richiesta

> «quando dezummo nel workspace nel momento in cui si blurrano le schede e il testo
> riassuntivo appare e troppo piccolo, fallo piu grande, deve essere leggibile
> quando lo zoom e al massimo»

## La causa, che non era una scelta di design

Il riepilogo era `font-size: 11px`. Sembrava il valore giusto, e a zoom 1 **era** il
valore giusto. Il problema e che quei pixel sono pixel **del nodo**, e il nodo sta
dentro `transform: scale(zoom)`: la dimensione reale sullo schermo era
`11px × zoom`. Con `minZoom={0.2}`:

| zoom | sullo schermo | si legge |
|---|---|---|
| 0.55 (soglia) | 6.0px | appena |
| 0.42 | 4.6px | no |
| 0.20 (minimo) | **2.2px** | no |

Quindi non era un testo poco grande: era un testo che **non esisteva**, nel senso
che al minimo zoom non c'erano pixel che potessero formare una lettera. E il difetto
si nascondevava bene, perche a zoom 1 sembrava normale e compariva solo a 0.2, dove
nessuno va a guardare due volte.

## La correzione

Lo zoom viene esposto come variabile CSS sul contenitore, e la dimensione del
riassunto viene **divisa** per lo zoom:

```css
--summary-px: calc(12px / var(--canvas-zoom, 1));
```

La dimensione sullo schermo e adesso **costante** a ogni distanza: 12px a 0.2, 12px
a 0.55, 12px a 1. Esporre lo zoom come variabile e l'unico modo per annullarlo in
CSS senza far riscrivere i pixel di ogni nodo a ogni scatto della rotella, che
costerebbe un render per nodo per ogni notch.

## Due difetti che sono apparsi solo guardando il risultato

### Il testo tagliato da entrambi i lati

Con la dimensione compensata, il testo e **piu alto del nodo**: a 0.2 un nodo alto
160px misura 32px sullo schermo, e una riga da 12px dentro 32px sta, ma cinque righe
no. Con `align-items: center` su un contenuto che trabocca, il testo viene tagliato
**sopra e sotto**: quello che si leggeva era la seconda riga, spezzata a meta' parola.

`align-items: safe center`: quando il contenuto non entra, l'allineamento ricade su
`start`, quindi **la prima riga e sempre quella che si vede** — e le prime parole sono
quelle che identificano il nodo. Il fallback `center` resta dichiarato prima, per i
browser che non conoscono `safe`.

### I margini che mangiavano il nodo

La prima versione compensava anche il padding, per coerenza. A 0.2 un margine di 10px
su un nodo largo 190px ne mangia un quarto, e al testo restavano 90px: una parola per
riga dentro un nodo di 38 pixel sullo schermo. Misurato nel browser, larghezza del
testo **17px su 38px disponibili** — meta' esatta.

Compensare i margini sembra la cosa giusta e non lo e: il testo e gia grande, quindi
un margine piccolo e **costante** in pixel del nodo (5px/7px) sembra esattamente il
margine che si vede. Dopo la correzione: **34px su 38**.

## Il limite che va detto

A 0.2 un nodo e 38×31 pixel sullo schermo. Con un testo da 12px ci stanno poche
parole per riga, e una parola puo andare a capo. Non e un difetto della correzione: e
la geometria. Cio che il riepilogo deve fare a quella distanza e dire **di che si
parla**, non riportare il testo — e quello che fa: la prima riga, intera, con le
prime parole.

Il test lo blocca perche il difetto e tornato tre volte in un giorno: la regola c'era,
la dimensione non la usava, e un `font-size: 12px` in una regola CSS sembra il
valore giusto. `src/logic/zoomSummary.readability.test.ts` legge `v2.css` come testo
e verifica che il `calc` ci sia, che il divisore sia lo zoom, che `safe center` ci
sia, e che i margini non superino 10px. **Verificato che fallisce** rompendo la
regola: 2 fallimenti su 7.

## Un ostacolo che e valso la pena

Per rileggere il foglio di stile come testo in un test serve `?raw`, e sui CSS
restituisce una stringa **vuota**: la trasformazione CSS intercetta prima. Quindi il
plugin in `vitest.config.ts`.

Il punto in cui si resta incastrati, e che ho scritto li perche ripassera: serve un
id **virtuale**, e serve che **non finisca con `.css`**. Il prefetto da solo non
basta, perche `vite:css` continua a riconoscerlo dalla sola estensione e a
trasformarlo lo stesso — cioe una stringa vuota lo stesso, ma con piu codice.

Una stringa vuota in un test e la cosa peggiore che possa capitare: il test passa
sempre e sembra coprire la leggibilita dello zoom lontano.

**551 test in 48 file** + 21 del proxy, typecheck pulito, build ok, lint 0 errori.

---

# v15 — quattro cose richieste, e un difetto grosso trovato per strada

## Le richieste

1. «for the response i want the title not the text itself»
2. «make it a little bigger and mark it»
3. «il prompt quando scrivo voglio che si allarghi, ma con un limite, non allargarsi
   all'infinito. Anche la risposta: non la voglio troppo lunga in una direzione,
   preferisco che sia piu lunga in verticale»
4. «voglio che si scrolli col mouse nel prompt o nella risposta, in generale in ogni
   testo presente»

Il punto 3 si e rivelato un difetto che era gia li da prima.

## Il difetto: `has-explicit-size` era sempre vera

La classe `has-explicit-size` doveva dire «l'utente ha ridimensionato questo nodo a
mano». Dieci componenti la calcolavano cosi:

```ts
explicitSize={Boolean(width ?? height)}
```

con `width`/`height` presi dalle **props di React Flow**, che sono le misure del nodo
e ci sono **sempre**. Quindi la classe era su tutti i nodi, in ogni momento, e con
lei due regole che dovevano valere solo per i nodi ridimensionati:

| regola | effetto reale |
|---|---|
| `.has-explicit-size .node-textarea { max-height: none; flex: 1 }` | la casella **non cresceva piu** col testo |
| `.has-explicit-size .response-body { max-height: none; flex: 1 }` | il corpo della risposta perdeva il tetto |

E il ramo dell'auto-crescita, in `PromptNode`, era:

```ts
const explicitHeight = Boolean(height)
...
if (explicitHeight) { textarea.style.height = '100%'; return }   // <- sempre questo
```

Misurato nel browser, prima della correzione: `scrollHeight` del testo **1698px** in
una casella alta **75px**. Il nodo non poteva crescere per costruzione.

Le dimensioni vere sono `node.width` / `node.height`, che il ridimensionamento scrive e
che restano assenti se l'utente non ha toccato il nodo. La decisione e ora in
`useNodeHasExplicitSize`, **un posto solo**: dieci componenti che calcolano la stessa
cosa sono dieci occasioni di sbagliare di nuovo, ed una ne aveva gia sbagliata.

`OutputNode` tiene le props di React Flow, ed e giusto: il riquadro del gruppo deve
essere esattamente grande quanto il frame che circonda i nodi dentro, e quella e una
dimensione **misurata**, non una scelta dell'utente.

## 1-2. Il riepilogo di una risposta e il suo titolo

Il testo della risposta e l'unica cosa di questo quadro che a distanza non serve
mostrare: e uno schermo di paragrafo per nodo, e trenta schermi di paragrafo
riducono la vista lontana a rumore — cioe al contrario di quello per cui esiste.

Il titolo e la stessa parola che l'intestazione del nodo mostra, quindi il nodo si
descrive uguale vicino e lontano. Ripieghi, nell'ordine: titolo, prima riga della
risposta (per i nodi salvati prima che il titolo esistesse), domanda.

**Piu grande e marcato**: 15px sullo schermo contro i 14 degli altri riepiloghi, peso
650, e un filetto d'accento a sinistra. Il filetto serve per una cosa precisa: a zoom
spinza un titolo senza filetto e solo una riga un po' piu grande, e su un grafo con
trenta nodi l'unica differenza che si nota e il peso. Con il filetto, la riga che e il
titolo si distingue da quella che e un riassunto di contenuto.

`NodeShell` mette adesso la classe del tipo (`response-node`, `prompt-node`, …): senza,
una regola che vuole dire «solo i nodi risposta» non poteva scriversi, perche la classe
mancava a nove tipi su undici.

### Una correzione che ho raccontato male

Scrivendo i test ho scritto che `shorten` tagliava a meta' parola e che era un difetto
esistente. **Non lo era**: l'avevo creato io, in una versione di mezzo, e un test con
un'asserzione sbagliata l'aveva fatto sembrare vecchio. La correzione c'e, ed e un
miglioramento reale ma piccolo: la soglia unica pretendeva che l'ultimo spazio fosse
oltre il 60% del tetto, e nella **fascia fra il 40% e il 60%** il confine di parola
esisteva e si tagliava in mezzo. Con parole corte l'ultimo spazio cade sempre oltre il
90% e la fascia non si attraversa mai, quindi il difetto era invisibile. Il test che lo
blocca usa parole di 100 caratteri per costruzione, e **verificato che fallisce** con
la soglia vecchia.

## 3. Cresce in verticale, con un tetto

- `maxResponseHeight` da 380 a **560**: una risposta e lunga per natura, e con un tetto
  basso finiva in tre schermate di scroll dentro una schedina.
- `maxResponseWidth` **560**, solo per i nodi che l'utente non ha ridimensionato. Chi
  allarga un nodo a mano ha gia deciso quanto lo vuole largo, e limitare anche quello
  nasconderebbe il testo che ha chiesto di vedere — e romperebbe il ridimensionamento,
  che e una funzionalita e non una preferenza.
- Il prompt e gli altri corpi non cambiano: gia crescevano, e il tetto era quello
  giusto.

Il confronto fra i due numeri **non e** «altezza maggiore di larghezza»: non e un
requisito, e scriverlo sarebbe un numero inventato a dare un'obiezione finta. I due
hanno due ruoli diversi — altezza e un tetto di crescita, larghezza e un tetto di
leggibilita — e i test li distinguono per ruolo.

## 4. La rotella, e chi se la tiene

React Flow ascolta la rotella sul pannello e la usa per lo zoom, quindi la rotella su un
testo che scorre non faceva niente: non zoomava e non scorreva.

Intercettato in **fase di cattura** (senza, React Flow ha gia consumato l'evento) e
fermato **solo** quando il testo sotto il puntatore puo ancora scorrere in quella
direzione. Generico, non una lista di selettori: la regola e «l'elemento sotto il
puntatore scorre?», e risponde da sola per le caselle, per i corpi delle risposte, per
i ragionamenti, per i riepiloghi, e per qualunque nondo che si aggiungera.

Il caso difficile non e il primo, e l'ultimo. Fermare l'evento anche in fondo al testo
— o in cima — produce il peggior comportamento che un'interfaccia possa avere: **il
testo non si muove e non succede nient'altro**. L'utente gira la rotella e non capisce
se il mouse sia rotto o se lui stia sbagliando qualcosa. Meglio che l'evento prosegua
e il quadro zooma: almeno e un effetto che si riconosce.

Tre dettagli che il test blocca:
- `overflow: hidden` con contenuto piu grande **non** e scorrevole: sembra un testo
  che si puo scorrere e non si puo;
- `overflow: visible` non ha scorrimento nativo affatto;
- la ricerca si ferma al canvas, altrimenti `document.body` scrollerebbe la pagina
  invece di far zoomare il quadro — il modo piu subdolo di rompere un quadro.

## Verificato nel browser, con la rotella vera

| cosa | misura |
|---|---|
| prompt, 1 riga | casella 103px, nodo 229px |
| prompt, 6 righe | casella 376px, nodo 502px |
| prompt, 14 righe | casella 445px, **tetto**, scorre |
| prompt, 40 righe | casella 445px, **tetto**, scorre — `explicitSize: false` |
| risposta, contenuto 2906px | corpo 560px, `overflow-y: auto`, scorre |
| rotella sul corpo della risposta | `scrollTop` 300 → 500 → 700, zoom **invariato** |
| rotella in fondo al testo | `scrollTop` al massimo, e il quadro **zooma** 1.39 → 1.20 |
| riepilogo a 0.2 | titolo 75px (15px a schermo), peso 650, filetto 2px |

**583 test in 50 file** + 21 del proxy, typecheck pulito, build ok, lint 0 errori.

---

# v16 — un avvio che si puo usare, e una sola icona

## Le richieste

> «non ho un modo affidabile di aprire la piu, quando clicco sull'icona del desktop
> mi da errore che LM Studio non e in esecuzione»
>
> «ora ci sono due icone, una per il server e una per la UI, ne voglio una per tutto»

## Il launcher si rifiutava di aprire l'app

`run-tray.ps1` aveva questo, come **primo** passo:

```powershell
if (-not (Test-Up $lmUrl)) {
  MessageBox::Show('LM Studio non risponde...', 'NCHAT', 'OK', 'Warning')
  exit 1
}
```

Cioe: senza LM Studio mostrava un avviso e **usciva senza aprire niente**. Da li
«l'app non parte». L'app non era mai partita: qualcuno gli aveva detto di non partire.

Le tre ragioni per cui quel cancello era sbagliato, e sono tutte vere:

- **LM Studio serve solo per eseguire.** Quadro, note, prompt, file, gruppi,
  esportazione: tutto funziona senza un modello e senza rete. Chi sta disponendo il
  grafo non ha un server dei modelli acceso, e non perche abbia dimenticato qualcosa.
- **In cloud non serve affatto.** La chiave la tiene il servizio locale. Controllare
  LM Studio era un ostacolo a un caso in cui e irrilevante.
- **Un avviso modale all'avvio** e la cosa peggiore che potesse succedere: clicchi
  l'icona e vedi una finestra di errore, e la conclusione e «l'app e rotta».

Ora: niente cancello, niente finestrella. Si annota nel log e si prosegue. La
spiegazione la da l'app, che distingue **chi sta bene** da **che cosa manca**.

## Due icone, e perche una era peggio

Sul Desktop c'erano:

| icona | cosa fa |
|---|---|
| `NCHAT Visual prompt.lnk` | **Edge, app installata.** Apre il browser dritto su `127.0.0.1:5173` |
| `NCHAT.lnk` | il launcher: avvia server, proxy e finestra |

La prima e quella che «apre solo la UI», esattamente come descritto. E non e una
versione minore di NCHAT: e una scorciatoia che

1. **non avvia niente**, quindi se il server non e gia su apre una pagina vuota;
2. usa il **profilo di Edge**, non quello con cui il tray apre la finestra, quindi due
   finestre con due situazioni diverse;
3. si reinstalla ogni volta che l'utente la installa come app, quindi scompare e
   torna da sola.

`install-shortcut.ps1` ora le cerca **per contenuto** — la firma `--app-url` nelle
argomentazioni, che e cio che distingue un'app installata da un collegamento
qualsiasi — e le rimuove, sia in installazione sia in `-Remove`. Per contenuto e non
per nome, perche il nome che Edge dà e `<titolo del manifest>.lnk` e cambia col
titolo: cercarlo per nome lo avrebbe mancato alla volta dopo.

Rimossa anche la fonte: il launcher lo dice a schermo, «non reinstallare NCHAT come
app da Edge», con il motivo.

## Il difetto che questa richiesta ha scoperto: il proxy cloud non partiva mai

Il launcher avviava il proxy cosi:

```powershell
-ArgumentList $script      # <- senza apici
```

Il progetto sta in **"progetto llm node based chat"**, quindi Node divideva la riga
sul primo spazio e provava a caricare `D:\Desktop\progetto`. Usciva subito con
`MODULE_NOT_FOUND`, e il proxy non partiva **mai** dal launcher — su questa macchina,
da sempre.

Il sintomo per l'utente e il peggiore possibile, perche e **quasi silenzioso**: senza
proxy non ci sono modelli in cloud, l'app non ha modo di dire «il servizio che tiene la
tua chiave non e partito», e il sintomo che resta e **«la mia chiave non funziona»** —
che fa pensare a una chiave sbagliata invece che a un servizio che non e partito. E il
pazzo e che l'app diceva esattamente quello, perche `prepareProvider` onesto riporta
«il servizio locale non e in esecuzione», e lieta ma non dirimente: sembrava un server
dimenticato, non un bug di avvio.

Perche e rimasto nascosto: il codice che avvia il **server** accetta gia una lista di
argomenti con virgolette, il proxy no. Due modi diversi per la stessa cosa nella stessa
funzione, e quello sbagliato era il meno usato.

Corretto, e verificato: il proxy scrive `nchat cloud proxy on http://127.0.0.1:1235`
e l'app, passando a NVIDIA, risponde **`no-key`** invece di `service-down`. La
differenza e la prova che il proxy e raggiungibile.

## Come l'app parla del server dei modelli

Tutte le frasi in `src/logic/connectionState.ts`, un posto solo, cosi pastiglia,
impostazioni e registro dicono la stessa cosa.

| prima | adesso |
|---|---|
| `Offline` con un punto **rosso** | `Model server down` con un punto **grigio** |
| `Cannot reach http://localhost:1234/v1` in rosso | **NCHAT is running.** Local (LM Studio) is not answering, so there are no models to choose from yet. The canvas still works. |
| — | il dettaglio tecnico **sotto**, in piccolo, per chi lo vuole |
| — | un consiglio: «Start LM Studio, load a model, and come back.» |

Tre scelte, ognuna con la sua ragione:

- **`Offline` → `Model server down`.** «Offline» descrive **chi ascolta**, e chi
  ascolta e l'app. La parola da sola faceva il danno.
- **Niente rosso.** Il rosso dice «qualcosa e rotto». Il server dei modelli e un
  programma separato che l'utente avvia per conto suo, e che sia fermo non e un guasto
  di NCHAT: su una macchina che lavora in cloud e la normalita. Il colore e piu
  forte del testo, quindi una frase calmante accanto a un bordo rosso verrebbe letta
  come un tentativo di convincere che non sia un problema.
- **Il tecnico scende, non sparisce.** «Cannot reach http://localhost:1234/v1» dice
  perche il tentativo e fallito, ma da solo fa pensare che l'app sia rotta, perche e
  la prima riga che si incontra e non la quinta.

E il consiglio, perche e la parte che l'utente usa davvero: per LM Studio dice
«avvia LM Studio» e **non** «riavvia NCHAT» — il consiglio sbagliato avrebbe fatto
riavviare un'app che era gia aperta, lasciando fermo il server dei modelli. Per un
provider cloud dice invece di avviare il **servizio locale** e di controllare la
chiave, perche il primo tentativo sbagliato che si fa e mettere la chiave sbagliata
invece di avviare il servizio.

**599 test in 51 file** + 21 del proxy, typecheck pulito, build ok, lint 0 errori.

---

# v17 — cloud senza caricamento, e i parametri che il provider onora

## Le due richieste

> «quando uso una API non devo decidere le impostazioni per generare la risposta,
> tipo max token e temperature e top p: sono decise dal provider, tipo Google AI
> Studio. In modalita API rendile non valide»
>
> «un altro problema: le API non hanno bisogno di attesa quando carico il modello,
> quindi per il primo messaggio penso che non ci sia bisogno di aspettare a mandare la
> richiesta. Verifica»

La seconda era giusta e grossa. La prima parte da un presupposto **sbagliato**, e
quello che conta di piu e dirlo.

## Il presupposto: i parametri li applica il provider, non sono scelti a caso

No: sono campi standard dell'API OpenAI-compatible, viaggiano nel corpo della
richiesta, e **Google AI Studio e NVIDIA NIM li applicano come li ricevono**. Se ne
vede l'invio chiamando il client vero e guardando il corpo, non leggendo il codice
(`src/llm/generationParams.test.ts`):

```ts
inviato.temperature  // 0.05
inviato.top_p        // 0.33
inviato.max_tokens   // 321
```

I valori sono lontani dai default (0.7 / 1 / 1024) di proposito: con i default la
prova passerebbe anche se il campo non viaggiasse, perche 0.7 e 1 sono i default del
modulo e un errore di cablaglio produrrebbe gli stessi numeri.

Quindi toglierli in cloud non sarebbe liberare l'utente da una scelta non sua. Sarebbe
togliere il controllo su tre cose che cambiano il risultato, e su una in particolare:

**`max_tokens` e il tetto di quanto puo costare una risposta.** Senza, un modello
ragiona finche vuole e il conto cresce. Su un provider a pagamento — che e il caso
d'uso di questa modalita — non e un dettaglio, e un'impostazione che sparisce e che
l'utente non sapeva esserci.

Quindi i tre campi **restano**, e al posto loro c'e una riga che dice cosa fanno:
«These are sent to Google AI Studio (cloud) as they are. It applies them, and the
maximum output tokens is what caps what one answer can cost.» Il presupposto sbagliato
era anche il modo in cui l'app si presentava, quindi la correzione e anche dichiarare
cosa fanno.

Il test dal vivo non e stato completato: la quota free tier di Google era esaurita
(limite 20 richieste). Resta la prova sul client, che e quella che riguarda il
comportamento dell'app.

## I tre controlli che invece spariscono, e perche era una spesa

Nella scheda Connection c'erano tre impostazioni che sono concetti di **LM Studio**:

| controllo | perche non ha senso in cloud |
|---|---|
| Load model when I start typing | li il modello e gia in piedi |
| Keep only one model in memory | non c'e memoria locale in cui tenerli |
| Model load timeout | non c'e caricamento da aspettare |

E non erano solo inutili: **costavano**.

`loadModel`, su un livello non nativo, finisce col mandare una **richiesta vera** di
completamento (`max_tokens: 1`, «Ready.») per controllare se il modello e pronto. E
`runPrompt` chiama `ensureLoaded` **prima di ogni richiesta**. Quindi per ogni prompt
e per ogni cambio di modello succedevano tre cose:

1. un giro di rete per rileggere la lista dei modelli;
2. **una richiesta fatturata** di prova;
3. uno stato «Loading model» in barra, per un modello che era gia pronto — che e
   esattamente l'attesa che l'utente aveva notato.

In cloud quei tre controlli spariscono e al loro posto c'e una riga: «Nothing to load.
Google AI Studio (cloud) serves the model, so there is no download and no wait. The
only thing that has to be in place is the API key, in Connection.»

Non si lascia il vuoto: un vuoto sembra un'impostazione dimenticata.

## Il caricamento in cloud ora non esiste

La guardia sta in `ensureLoaded`, **non** in `runPrompt`, perche `ensureLoaded` ha
tre chiamanti — `runPrompt`, `selectModel`, `preloadOnTyping` — e metterla nel primo
lascia gli altri due col difetto. (E `selectModel` ne aveva gia una copia, con un
motivo in parte sbagliato: diceva che `ensureLoaded` avrebbe chiamato «un endpoint che
quel provider non ha», mentre il problema vero era la richiesta di prova.)

In cloud `ensureLoaded` esce subito e marca il modello come pronto. Per il client e
vero: e servito da qualcun altro, e l'unica premessa e la chiave, consegnata al
servizio locale prima. Se qualcosa non va, lo dice la richiesta vera, con l'errore
vero — molto meglio di un timeout su una prova di prontitudine.

Quattro prove in `modelManager.test.ts`, **verificate che falliscono** togliendo la
guardia: zero richieste, nessuno stato `loading`, il modello marcato pronto, e la
coda di caricamento intatta per il caso locale — l'ultima e la difesa contro una
semplificazione che avrebbe reso l'app silenziosamente incapace di usare LM Studio.

## Verificato nel browser

| cosa | esito |
|---|---|
| cloud, scheda Connection | i tre controlli di LM Studio assenti, «Nothing to load» presente |
| cloud, scheda Generation | i tre campi ci sono, con la riga che dice che vengono inviati |
| local, scheda Connection | i tre controlli **tornano**, e «LM Studio API level detected» |
| primo token, entrambe le mode | resta, e serve: un modello ragionante in cloud puo metterci 30 s |

Nota presa per strada, utile: `gemini-2.5-flash` **non e piu disponibile** per nuovi
utenti su Google, che chiede `gemini-3.8-flash`. La lista che l'app mostra e quella
vera del provider, quindi non e un problema dell'app — ma il modello va cambiato.

**606 test in 52 file** + 21 del proxy, typecheck pulito, build ok, lint 0 errori.
