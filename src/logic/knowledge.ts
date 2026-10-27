import {
  KNOWLEDGE_BLOCK_HEADING,
  KNOWLEDGE_READ_ONLY_NOTICE,
  MAX_ENTRY_CHARS,
  type KnowledgeDraft,
  type KnowledgeEntry,
  type KnowledgeHub,
  type KnowledgeId,
  type KnowledgeInjection,
  type KnowledgeTrail,
  type Vec3,
} from '../types/knowledge'
import { queryTerms } from './search'
import { clearShellPoint } from './knowledgeShell'

/**
 * La conoscenza: dove mettere un passaggio, e cosa passare al modello.
 *
 * Tutto qui e' **puro e sincrono**. Non e' una scelta stilistica: e' cio' che rende questa
 * parte verificabile. «Il passaggio e' stato messo nel posto giusto» e «il modello ha
 * ricevuto queste note e non altre» sono domande a cui si puo' rispondere con un test e un
 * risultato atteso, senza un modello in esecuzione.
 *
 * E serve anche per la scelta tecnica di fondo: qui non si chiede niente a nessun provider
 * e non si scarica niente. Il confronto e' fatto sulle parole, quindi funziona uguale per
 * LM Studio, per un'API e per un provider che non si conosce — che era il punto: la
 * conoscenza non deve sapere con chi sta parlando.
 */

/**
 * Parole che non distinguono niente.
 *
 * Una lista corta e **dichiarata**. Il pericolo di una lista lunga e' che si prendono per
 * esclusione parole che in questo archivio sono invece il tema: «listini», «trimestre»,
 * «risposta» sono il contenuto di meta' delle note, e buttarli via perche' sono parole
 * comuni in italiano farebbe perdere esattamente quello che si voleva ricordare. Quindi
 * via solo gli ausiliari e le congiunzioni, e il resto del giudizio lo fa il punteggio.
 */
const STOPWORDS = new Set([
  'a', 'ad', 'al', 'alla', 'alle', 'allo', 'anche', 'che', 'chi', 'ci', 'coi', 'col',
  'come', 'con', 'cui', 'da', 'dal', 'dalla', 'dei', 'del', 'della', 'delle', 'dello',
  'di', 'e', 'ed', 'gli', 'ha', 'hanno', 'ho', 'i', 'il', 'in', 'io', 'la', 'le', 'lo',
  'loro', 'ma', 'mi', 'ne', 'nel', 'nella', 'no', 'non', 'o', 'per', 'perche', 'piu',
  'poco', 'qual', 'quale', 'quando', 'quello', 'questa', 'queste', 'questi', 'questo',
  'se', 'senza', 'si', 'sono', 'su', 'sul', 'sulla', 'tra', 'tu', 'un', 'una', 'uno',
  'era', 'essere', 'stato',
])

/** Shorter than this and a word is a typo or a letter, not a topic. */
const MIN_TOKEN_LENGTH = 3

/**
 * How long a **number** has to be to be kept.
 *
 * Il caso e' diverso dalle parole, e merita una riga sua. In un archivio di questo tipo i
 * numeri sono spesso **il** motivo per cui la nota e' stata salvata — «calato del 12%», «i
 * listini del 2026» — e la regola delle tre lettere li avrebbe buttati via: «12» verrebbe
 * scartato come un refuso. Due cifre bastano, una sola no, perche' un «3» isolato e' piu'
 * spesso un numero d'ordine che un dato.
 */
const MIN_DIGITS = 2

/** True for a token that is only digits, like `12` or `2026`. */
function isNumber(token: string): boolean {
  return /^\d+$/.test(token)
}

/**
 * The singular guess for an Italian plural, or `null`.
 *
 * «listini» e «listino» sono la stessa parola e senza questo non si incontrano mai: si
 * cerca «quanto cala il margine dei **listini**», l'archivio ha «sul **listino**», e la
 * nota che serve non viene trovata. In italiano i plurali sono frequenti e il singolare e'
 * di solito la forma che si scrive, quindi il difetto non e' un caso limite — e' il primo
 * caso in cui capita.
 *
 * Non e' uno stemming fatto bene, ed e' una scelta. Una regola che sbaglia («ricette»
 * diventerebbe «ricotta») e' un problema solo se produce risultati diversi da una parte e
 * dall'altra; qui applica **la stessa trasformazione a entrambi i lati**, quindi due parole
 * che erano la stessa restano la stessa. Che una forma singolare sia sbagliata conta poco
 * rispetto al fatto che la trasformazione e' coerente — ed e' la stessa ragione per cui non
 * si usa un dizionario delle radici: quello funziona per una lingua sola, e questo no.
 *
 * Il limite di cinque caratteri evita di mutilare le parole corte, dove il finale e' parte
 * della parola e non un plurale: «anni» resta «anni», «paesi» diventa «paese».
 */
function singularGuess(token: string): string | null {
  if (token.length < 5) return null
  if (token.endsWith('i')) return `${token.slice(0, -1)}o`
  if (token.endsWith('e')) return `${token.slice(0, -1)}a`
  return null
}

/**
 * Splits text into the words worth comparing.
 *
 * Si divide su quello che non e' lettera e si butta via il resto: niente punteggiatura, niente
 * simboli. La lunghezza minima serve perche' «il», «e», «di» hanno gia' una lista, e un
 * pezzo di due lettere che non c'e' nella lista e' rumore.
 *
 * Non si fa stemming. Sarebbe piu' accurato — «listini» e «listino» diventerebbero la stessa
 * parola — ma richiederebbe un dizionario delle radici, e con quello la lista si ferma a
 * funzionare per l'inglese. Meglio una cosa che regge su qualunque lingua e che si puo'
 * spiegare, che una che pretende di essere piu' brava e sbaglia in italiano.
 */
export function tokenize(text: string): string[] {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    // Via gli accenti: «perche'» e «perche' accentato» devono essere la parola stessa,
    // altrimenti sono due parole diverse e la similitudine non le trova mai.
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/i)
    .filter((word) => {
      if (word.length === 0) return false
      if (isNumber(word)) return word.length >= MIN_DIGITS
      return word.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(word)
    })
  /*
   * Ogni parola entra **insieme** alla sua ipotesi di singolare, quando c'e'.
   *
   * Entrambe, e non una delle due: tenere solo il singolare perderebbe le note che usano
   * il plurale, e tenere solo il plurale perderebbe quelle che usano il singolare — che e'
   * il caso piu' comune. Con due forme, «listini» e «listino» si incontrano su «listino»
   * senza che nessuno dei due lati debba scegliere.
   */
  const out: string[] = []
  for (const word of base) {
    out.push(word)
    const guess = singularGuess(word)
    if (guess) out.push(guess)
  }
  return out
}

/** A term and how much it counts in one text. */
export interface TermWeight {
  term: string
  /** The term's share of this text's total. */
  weight: number
}

/**
 * The weighted terms of one text: how much each term says about it.
 *
 * Il peso e' la **frequenza relativa**, non il conteggio grezzo. Serve perche' una nota
 * lunga e una breve devono essere confrontabili: con i conteggi la nota lunga vince sempre
 * perche' ripete piu' volte le sue parole, anche se quelle parole sono meno caratteristiche.
 * Con la frequenza relativa, «quanto questo termine descrive **questa** nota» e' la stessa
 * domanda per tutte.
 */
export function termWeights(text: string): TermWeight[] {
  const tokens = tokenize(text)
  if (tokens.length === 0) return []
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  const total = tokens.length
  return [...counts.entries()]
    .map(([term, count]) => ({ term, weight: count / total }))
    .sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
}

/**
 * How much two texts are about the same thing, from 0 to 1.
 *
 * E' il coseno fra i due vettori di parole pesate: si sommano i pesi condivisi e si divide
 * per la lunghezza dei due. Il risultato e' 0 quando non hanno **nessuna** parola in comune,
 * ed e' quello che rende sicuro il recupero: due note senza una parola in comune non hanno
 * niente da dirsi, e non si devono accostare ne' citare insieme.
 */
export function similarity(a: string, b: string): number {
  const left = termWeights(a)
  const right = termWeights(b)
  if (left.length === 0 || right.length === 0) return 0
  const rightByTerm = new Map(right.map((entryWeight) => [entryWeight.term, entryWeight.weight]))
  let dot = 0
  for (const entryWeight of left) {
    const other = rightByTerm.get(entryWeight.term)
    if (other) dot += entryWeight.weight * other
  }
  return dot
}

/**
 * How **rare** each term is across a set of texts.
 *
 * E' la parte che rende una soglia un numero con un significato, e senza questa il recupero
 * non funziona in modo affidabile: senza, una nota che condivide con la domanda la parola
 * «trimestre» conta quanto una che condivide «dodici». E non sono la stessa cosa: in un
 * archivio di riassunti trimestrali «trimestre» e' in tutte le note e non distingue niente,
 * mentre «dodici» compare in una e dice esattamente quale.
 *
 * Il peso e' `log(N / df)` e non il suo opposto rovesciato: una parola che compare in tutte
 * le note vale circa zero, e una che compare in una sola vale tanto. E' il calcolo classico
 * e non serve spiegarlo oltre: quello che conta e' che **una parola comune non vale una
 * parola rara**, che e' la differenza fra «ti ho trovato qualcosa che parla di trimestri» e
 * «ti ho trovato quello che dice dodici per cento».
 */
function inverseFrequencies(texts: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>()
  for (const text of texts) {
    for (const { term } of termWeights(text)) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
    }
  }
  const total = Math.max(1, texts.length)
  const inverse = new Map<string, number>()
  for (const [term, seen] of frequencies) {
    inverse.set(term, Math.log(total / seen) + 1)
  }
  return inverse
}

/**
 * How much a note answers a question, with rare words counting for more.
 *
 * Come `similarity`, ma con il peso di rarita'. E' la funzione che decide cosa arriva al
 * modello, quindi e' l'unica per cui la precisione conta davvero.
 */
export function relevance(
  query: string,
  entry: string,
  inverse: Map<string, number>,
): number {
  const queryWeights = termWeights(query)
  const entryWeights = termWeights(entry)
  if (queryWeights.length === 0 || entryWeights.length === 0) return 0
  const entryByTerm = new Map(entryWeights.map((weight) => [weight.term, weight.weight]))
  const queryNorm = Math.sqrt(
    queryWeights.reduce((total, weight) => {
      const idf = inverse.get(weight.term) ?? 1
      return total + (weight.weight * idf) ** 2
    }, 0),
  )
  const entryNorm = Math.sqrt(
    entryWeights.reduce((total, weight) => {
      const idf = inverse.get(weight.term) ?? 1
      return total + (weight.weight * idf) ** 2
    }, 0),
  )
  if (queryNorm === 0 || entryNorm === 0) return 0
  let dot = 0
  for (const weight of queryWeights) {
    const other = entryByTerm.get(weight.term)
    if (!other) continue
    const idf = inverse.get(weight.term) ?? 1
    dot += (weight.weight * idf) * (other * idf)
  }
  return dot / (queryNorm * entryNorm)
}

/** Below this, two notes have nothing to say to each other. */
export const RELATED_THRESHOLD = 0.12

/**
 * The bar for calling two notes **related enough to sit next to each other**.
 *
 * E' molto piu' basso di quello del recupero, e la differenza e' voluta perche' le due
 * domande non sono la stessa.
 *
 * **Dove metterla** e' una faccenda di ordine: se due note finiscono un po' troppo vicine
 * quando non avrebbero dovuto, si vede una chiazza un po' troppo stretta — ed e' un
 * difetto estetico, che si corregge muovendo un pallino. Servono quindi poche prove, e una
 * parola caratteristica in comune basta.
 *
 * **Cosa dargli al modello** e' una faccenda di fiducia: una nota fuori luogo arriva nella
 * risposta e la rende sbagliata senza che nulla sembri rotto. Servono quindi più prove, e
 * il caso senza nessuna parola in comune deve restare escluso — perche' quello e' l'unico
 * in cui il materiale sarebbe davvero fuori tema.
 *
 * Con una soglia sola si sbaglia uno dei due lati, e il lato da sbagliare non e' quello
 * economico.
 */
export const PLACEMENT_THRESHOLD = 0.03

/** Where a new note goes. */
export interface Placement {
  position: Vec3
  /** The note it was put next to, if any. */
  neighbourId: KnowledgeId | null
  similarity: number
  /** One short sentence saying why it landed there. */
  because: string
}

/** How far from its neighbour a note sits. */
const NEIGHBOUR_DISTANCE = 2.4

/**
 * How far out an unrelated note goes, and how much further each new one.
 *
 * Il numero e' piccolo di proposito, e il motivo e' la finestra. Una mappa che mette la
 * decima nota a dodici unita' dal centro esce dal campo visivo della camera, e quello che
 * l'utente vede sono tre palline al centro e il resto sparito: una mappa che non mostra
 * niente non e' una mappa, e' un archivio senza indice.
 *
 * Quindi l'orbita parte stretta e le note crescono di un passo piccolo. Se un archivio
 * arrivasse comunque troppo largo, e' la gravita' di `knowledgeLayout.ts` a riportarlo
 * dentro — non un numero qui, che si puo' scegliere solo sapendo quanti elementi ci
 * saranno, e non si sa.
 */
const ORBIT_FIRST = 4.2
const ORBIT_STEP = 1.9

/**
 * How far from the centre a placed note may ever land.
 *
 * E' una **sistemi di sicurezza**, non una scelta di posizione: il posto lo decidono i
 * confronti fra le parole e i punti di contesto, e quelli possono dire «molto lontano» se
 * le note da cui partono sono gia' lontane. Il limite qui tronca solo i casi estremi, cosi'
 * che un archivio gia' sparso non produca note nuove sempre piu' lontane — che e' il modo in
 * cui una mappa si perde: non di colpo, ma di salvataggio in salvataggio.
 */
const MAX_PLACEMENT_RADIUS = 8

/**
 * How far from its main point a note hangs.
 *
 * Non e' un numero fisso unico perche' con molte note sullo stesso centro un unico raggio
 * le metterebbe **tutte** sullo stesso guscio, e a occhio sembrerebbero una corona piatta
 * invece di un gruppo. Percio' il raggio cresce con quante ce ne sono: le prime stanno
 * vicino al centro e le successive un gradino piu' fuori, che e' anche l'ordine in cui
 * sono arrivate — cosi' la piu' recente si vede accanto alle altre e non sepolta dietro.
 *
 * Il salto e' di poco piu' della distanza minima fra due note, e serve a una cosa sola:
 * che due note sullo stesso centro non possano finire addossate. La separazione fra note
 * fa il suo lavoro anche senza, ma il gradino e' quello che rende il guscio **leggibile**,
 * e la leggibilita' e' il punto di tutta la mappa.
 */
const HUB_FIRST_RADIUS = 3.1
const HUB_RADIUS_STEP = 2.5

/**
 * The spot on a main point's shell where the `index`-th note hangs.
 *
 * La direzione viene **dall'id della nota**, non dall'ordine di arrivo: due note con lo
 * stesso indice (perche' una e' stata rimossa e rimessa) non si sovrappongono, e una nota
 * spostata fra un centro e l'altro non si sposta attorno al guscio a caso. La stabilita'
 * e' la stessa che riguarda `directionFrom`, e per la stessa ragione: la posizione viene
 * salvata, e un archivio che si riordina da solo non e' navigabile.
 */
export function hubShellPoint(hub: KnowledgeHub, index: number, entryId: string): Vec3 {
  const direction = directionFrom(entryId)
  /*
   * La direzione si **normalizza** prima di moltiplicarla per il raggio.
   *
   * `directionFrom` restituisce un vettore di lunghezza fra 0.55 e 1: lasciandolo com'era il
   * raggio del guscio sarebbe in realta un intervallo, e le note con direzione corta
   * finirebbero dentro la soglia di repulsione del centro — verrebbero cioe' spinte fuori dal
   * proprio gruppo da un effetto pensato per **allontanare** le note l'una dall'altra.
   * Normalizzare tiene il raggio esatto: il guscio e' un guscio.
   */
  const length = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2) || 1
  const radius = HUB_FIRST_RADIUS + index * HUB_RADIUS_STEP
  return {
    x: hub.position.x + (direction.x / length) * radius,
    y: hub.position.y + (direction.y / length) * radius,
    z: hub.position.z + (direction.z / length) * radius,
  }
}

/**
 * A stable pseudo-random direction, from the entry's id.
 *
 * `Math.random` qui sarebbe un errore, e non per il gusto della determinazione: la posizione
 * viene **salvata**, quindi un caso diverso a ogni esecuzione produrrebbe note in posti
 * diversi pur senza che nessuno le abbia toccate. Un archivio che si sposta da solo fra un
 * giorno e l'altro non e' piu' navigabile, ed e' il difetto che fa smettere di fidarsi di una
 * mappa.
 */
function directionFrom(id: string): Vec3 {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const a = ((hash >>> 0) % 10000) / 10000
  const b = (((hash >>> 8) >>> 0) % 10000) / 10000
  const theta = a * Math.PI * 2
  const phi = Math.acos(2 * b - 1)
  const radius = 0.55 + ((((hash >>> 16) >>> 0) % 1000) / 1000) * 0.45
  return {
    x: Math.sin(phi) * Math.cos(theta) * radius,
    y: Math.cos(phi) * radius,
    z: Math.sin(phi) * Math.sin(theta) * radius,
  }
}

/**
 * The notes tied to one, in both directions.
 *
 * Il rapporto si scrive **da un lato solo** e si legge dai due, perche' tenere la copia
 * sui due lati significa che un collegamento puo' restare a meta': un lato lo cancella e
 * l'altro lo conserva, e la mappa mostra un filo che una delle due note non conosce.
 * Camminando l'archivio intero non esiste un secondo posto dove il dato puo' sbagliare.
 *
 * Gli id che non portano a nessuna nota si perdono in silenzio: una nota cancellata non
 * deve poter lasciare un filo appeso, e un filo verso il nulla non si puo' nemmeno
 * disegnare.
 */
export function neighboursOf(
  entries: readonly KnowledgeEntry[],
  id: KnowledgeId,
): KnowledgeId[] {
  const out: KnowledgeId[] = []
  const seen = new Set<KnowledgeId>([id])
  for (const entry of entries) {
    if (entry.links.includes(id) && !seen.has(entry.id)) {
      seen.add(entry.id)
      out.push(entry.id)
    }
  }
  const self = entries.find((entry) => entry.id === id)
  for (const link of self?.links ?? []) {
    if (link === id || seen.has(link)) continue
    // Il collegamento vale solo se la nota dall'altra parte esiste ancora.
    if (!entries.some((candidate) => candidate.id === link)) continue
    seen.add(link)
    out.push(link)
  }
  return out
}

/** Every tie in the archive, once, as unordered pairs. Used to draw the lines. */
export function linkPairs(entries: readonly KnowledgeEntry[]): Array<[KnowledgeId, KnowledgeId]> {
  const present = new Set(entries.map((entry) => entry.id))
  const seen = new Set<string>()
  const pairs: Array<[KnowledgeId, KnowledgeId]> = []
  for (const entry of entries) {
    for (const link of entry.links) {
      // Un legame verso una nota che non c'e' piu' non si disegna: il filo finirebbe nel
      // vuoto, che e' un segnale che non vuol dire niente — peggio del silenzio, perche'
      // sembra che dall'altra parte ci sia qualcosa che non si vede.
      if (!present.has(link)) continue
      // La chiave e' **ordinata**, cosi' `a→b` e `b→a` producono la stessa chiave e il
      // rapporto si disegna una volta sola. Senza, due note collegate in entrambi i
      // sensi avrebbero due fili sovrapposti e si vedrebbe il doppio di un rapporto solo.
      const key = entry.id < link ? `${entry.id}|${link}` : `${link}|${entry.id}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push([entry.id, link])
    }
  }
  return pairs
}

/**
 * Decides where a new note goes: **next to the note it most resembles**.
 *
 * Questa e' la parte che risponde a «lo mette nel posto giusto da solo». Il posto giusto non
 * e' una cartella: e' la vicinanza. Una nota che parla di listini finisce accanto alle altre
 * note sui listini, e a colpo d'occhio si vede che sono parentele.
 *
 * Il caso senza parentele e' previsto e non e' un fallimento: se niente e' abbastanza simile,
 * la nota va su un'orbita esterna, in ordine di arrivo. Non si finge che esista un posto
 * giusto quando non c'e'.
 *
 * Il risultato e' una posizione **da salvare**: da qui in fuori nessuno la ricalcola. Questa
 * funzione si chiama una volta sola per nota, quando viene salvata.
 */
export function placeKnowledge(
  draft: KnowledgeDraft,
  existing: readonly KnowledgeEntry[],
  id: KnowledgeId,
  hubs: readonly KnowledgeHub[] = [],
): Placement {
  /*
   * **Il centro che l'utente ha scelto vince su tutto.**
   *
   * Quando c'e', la nota va li' e basta: nessun confronto, nessuna somiglianza che possa
   * tirarla altrove. E' il punto dell'interfaccia che chiede «dove la metto» — se dopo la
   * domanda la nota finisce lo stesso dove sarebbe finita senza chiedere, la domanda era
   * una decorazione e il gesto di scegliere non serve a niente.
   *
   * Un centro che non esiste piu' non e' un errore da fermare: viene trattato come se non
   * ci fosse, perche' la mappa non deve mai mostrare un filo verso il nulla.
   */
  const chosen = hubs.find((hub) => hub.id === draft.hubId)
  if (chosen) {
    return {
      position: compact(
        clearShellPoint(
          chosen.position,
          // +1 perche' count e' quante note il centro avrebbe **dopo** questa: il guscio
          // deve essere grande per tutte, non per le altre. Con il conto di prima, la prima
          // nota partiva dal raggio minimo e la seconda se ne accodava sopra senza spostare
          // le altre: e' esattamente l'accavallamento che questa funzione evita.
          existing.filter((entry) => entry.hubId === chosen.id).length + 1,
          id,
          hubs.length,
          existing,
        ),
      ),
      neighbourId: null,
      similarity: 0,
      because: `under "${trimForReason(chosen.title)}"`,
    }
  }

  /*
   * Anche qui si pesa la rarita', perche' la domanda e' la stessa: due note che condividono
   * «dodici per cento» sono parentele, due che condividono «trimestre» no. Senza, la nota
   * giusta finirebbe su un'orbita lontana da tutte le altre, che e' proprio il difetto da
   * cui si voleva uscire.
   */
  const inverse = inverseFrequencies(existing.map((entry) => `${entry.title} ${entry.text}`))
  let bestId: KnowledgeId | null = null
  let bestScore = 0
  for (const entry of existing) {
    const score = relevance(draft.text, `${entry.title} ${entry.text}`, inverse)
    if (score > bestScore) {
      bestScore = score
      bestId = entry.id
    }
  }

  if (bestId !== null && bestScore >= PLACEMENT_THRESHOLD) {
    const anchor = existing.find((entry) => entry.id === bestId)
    if (anchor) {
      const direction = directionFrom(id)
      return {
        position: {
          x: anchor.position.x + direction.x * NEIGHBOUR_DISTANCE,
          y: anchor.position.y + direction.y * NEIGHBOUR_DISTANCE,
          z: anchor.position.z + direction.z * NEIGHBOUR_DISTANCE,
        },
        neighbourId: bestId,
        similarity: bestScore,
        because: `next to "${trimForReason(anchor.title)}"`,
      }
    }
  }

  // Senza parentele: orbita esterna, sempre piu' lontana, cosi' le note nuove non si
  // accavallano e si distingue a colpo d'occhio quante aree diverse esistono.
  const lonely = existing.filter((entry) => entry.placedBecause === 'no related note yet')
  const angle = lonely.length * 2.399963 // angolo aureo: distribuisce senza addensarsi
  const radius = ORBIT_FIRST + lonely.length * ORBIT_STEP
  return {
    position: compact({
      x: Math.cos(angle) * radius,
      y: (lonely.length % 3) - 1,
      z: Math.sin(angle) * radius,
    }),
    neighbourId: null,
    similarity: bestScore,
    because: 'no related note yet',
  }
}

/**
 * Pulls a point back inside the visible centre, leaving it alone if it is already close.
 *
 * Non sposta niente che sia gia' vicino: il raggio di partenza e' quello che dice il
 * confronto fra le parole e questa funzione interviene solo quando il risultato e' gia'
 * fuori portata di sguardo. Il vettore viene riportato alla stessa **direzione**, cosi' la
 * nota non viene spostata di lato — verrebbe a trovarsi dove non voleva nessuno, e con una
 * parentela che non spiega piu' niente.
 */
function compact(point: Vec3): Vec3 {
  const reach = Math.hypot(point.x, point.y, point.z)
  if (reach <= MAX_PLACEMENT_RADIUS) return point
  const scale = MAX_PLACEMENT_RADIUS / reach
  return { x: point.x * scale, y: point.y * scale, z: point.z * scale }
}

function trimForReason(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean
}

/**
 * The title of a saved passage.
 *
 * Si prende la **prima riga** e non un riassunto: un titolo che mente sul contenuto e' peggio
 * di nessun titolo, e con la prima riga il titolo e' testo che c'era davvero. Se il passaggio
 * e' su una riga sola, quella riga e' anche tutto il testo — e va accorciata perche' come
 * titolo non serve.
 */
export function titleFor(text: string): string {
  const firstLine =
    text.trim().split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  const clean = firstLine.replace(/\s+/g, ' ')
  if (text.trim().includes('\n')) return clean.slice(0, 80)
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean
}

/** Everything needed to store a new note, computed from the draft. */
export interface PreparedEntry {
  title: string
  text: string
  placement: Placement
}

export function prepareEntry(
  draft: KnowledgeDraft,
  existing: readonly KnowledgeEntry[],
  id: KnowledgeId,
  hubs: readonly KnowledgeHub[] = [],
): PreparedEntry {
  const text = draft.text.trim().slice(0, MAX_ENTRY_CHARS)
  const title = (draft.title ?? '').trim() || titleFor(text)
  return { title, text, placement: placeKnowledge(draft, existing, id, hubs) }
}

/** How the model is given the archive. */
export interface RetrievalOptions {
  /** At most this many notes. */
  limit?: number
  /** At most this many tokens, all told. */
  budgetTokens?: number
  /** Below this similarity, a note is not worth saying. */
  threshold?: number
  /**
   * The main points, so a note can be quoted under its group name.
   *
   * Facoltativo di proposito. Senza, il blocco resta esattamente com'era — il nome del
   * centro e' un'etichetta dell'utente, e il blocco non deve dipendere da un elenco che
   * chi lo chiama non ha. Il nome resta **fuori** dal testo citato come titolo: e' un
   * richiamo in parentesi prima del titolo, non un'altra fonte, e il modello non deve
   * poterlo scambiare per un passaggio da cui la risposta e' tratta.
   */
  hubs?: readonly KnowledgeHub[]
}

/**
 * I tre filtri con cui una nota arriva al modello, con i loro valori.
 *
 * `hubs` non c'e' qui dentro perche' non e' un filtro: e' un'etichetta che si mette accanto
 * a una nota **quando c'e'**, e metterla fra i valori di default farebbe sembrare che
 * chiamare `retrieveKnowledge` senza hubs sia una scelta — mentre e' il caso normale. Per
 * questo il tipo e' `Omit`: i tre numeri sono qui dentro, l'elenco dei centri no.
 */
export const DEFAULT_RETRIEVAL: Omit<Required<RetrievalOptions>, 'hubs'> = {
  limit: 5,
  budgetTokens: 1200,
  threshold: RELATED_THRESHOLD,
}

/** One note, and how strongly it matched. */
export interface KnowledgeHit {
  entry: KnowledgeEntry
  score: number
}

export interface RetrievalResult extends KnowledgeInjection {
  hits: KnowledgeHit[]
  /** True when notes exist but none were relevant enough. */
  nothingRelevant: boolean
}

/**
 * Il blocco per le note che l'utente ha **scelto** lui, e non quelle che il recupero ha
 * trovato.
 *
 * E' la stessa forma di `renderKnowledgeBlock` e per la stessa ragione e' una funzione
 * sola: l'intestazione, l'avviso di sola lettura e i due punti di chiusura sono la promessa
 * che tiene insieme tutta questa parte, e un secondo modo di costruire il blocco — uno per
 * le note scelte a mano, uno per quelle trovate — vuol dire che i due divergono al primo
 * ritocco. E la divergenza che fa male e' proprio quella: una nota scelta dall'utente
 * entrerebbe senza l'avviso che il modello non puo' modificarla.
 *
 * Il nome del centro entra come richiamo accanto al titolo, non al posto del titolo: il
 * titolo e' il testo che il modello deve leggere, e sostituirlo con un nome di comodo
 * nasconderebbe proprio quello che e' stato scelto di mandare.
 *
 * Restituisce `null` quando non c'e' niente da mandare, e non una stringa vuota: la
 * differenza serve al chiamante per non aggiungere un blocco vuoto al contesto, che consumerebbe
 * token senza dire niente e sembrerebbe un nodo configurato male.
 */
export function pickedInjection(
  notes: readonly KnowledgeEntry[],
  hubTitle: string | null,
): string | null {
  const usable = notes.filter((entry) => entry.text.trim())
  if (usable.length === 0) return null
  const label = hubTitle ? `[${hubTitle}] ` : ''
  const body = usable
    .map((entry) => `- ${label}${entry.title}\n  ${oneLine(entry.text)}`)
    .join('\n')
  return renderKnowledgeBlock({
    heading: KNOWLEDGE_BLOCK_HEADING,
    body,
    entryIds: usable.map((entry) => entry.id),
    estimatedTokens: usable.reduce(
      (total, entry) => total + estimateTokens(`${entry.title}\n${entry.text}`),
      0,
    ),
    hits: usable.map((entry) => ({ entry, score: 1 })),
    nothingRelevant: false,
  })
}

/**
 * Costruisce la traccia di cio' che e' stato mandato, dagli id.
 *
 * Funzione e non logicainline perche' la stessa costruzione serve a tre posti — la corsa, il
 * ricalcolo del contesto e i test — e ognuno che rifa l'elenco per conto suo e' un posto in cui
 * la lista mostrata e quella mandata possono divergere.
 *
 * Gli id che non portano piu' a niente vengono **scartati in silenzio**, e qui la scelta e'
 * discussa. Potrebbero diventare un avviso, ma non lo sono: la traccia risponde «che cosa e'
 * arrivato al modello», e un id sparito non e' arrivato a nessuno. Metterlo fra le voci
 * mostrerebbe all'utente una nota che non c'e' piu' come se fosse stata mandata — che e'
 * esattamente il tipo di conto sbagliato che questa struttura esiste per evitare.
 */
export function knowledgeTrail(
  via: 'retrieved' | 'node',
  entryIds: readonly KnowledgeId[],
  entries: readonly KnowledgeEntry[],
  hubs: readonly KnowledgeHub[],
): KnowledgeTrail['entries'] {
  return entryIds.flatMap((id) => {
    const entry = entries.find((candidate) => candidate.id === id)
    if (!entry) return []
    const hub = entry.hubId ? hubs.find((candidate) => candidate.id === entry.hubId) : undefined
    return [{ id: entry.id, title: entry.title, hub: hub?.title ?? null, via }]
  })
}
/** Rough token estimate: no tokenizer here, and one that over-guesses is safer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}

/**
 * Picks the notes worth putting in front of the model, in order, within a budget.
 *
 * Tre filtri, in quest'ordine, e l'ordine conta.
 *
 * **La soglia viene prima del limite.** Il limite da solo prenderebbe le cinque note piu'
 * vicine anche se fossero tutte irrelevanti: al modello arriverebbero cinque note che non
 * c'entrano, e una risposta costruita su materiale sbagliato e' peggio di una senza
 * materiale. Meglio non dire niente che dire la cosa sbagliata con sicurezza.
 *
 * **Il budget viene dopo.** Le note gia' scelte si contano e si prosegue finche' c'e' spazio.
 * Il budget e' in token e non in caratteri perche' e' il token quello che costa, e quello che
 * fa scattare il limite del contesto.
 *
 * L'ordine finale e' per punteggio decrescente: quello che somiglia di piu' sta primo, e il
 * modello legge prima quello che conta.
 */
export function retrieveKnowledge(
  query: string,
  entries: readonly KnowledgeEntry[],
  options: RetrievalOptions = {},
): RetrievalResult {
  const { limit, budgetTokens, threshold } = { ...DEFAULT_RETRIEVAL, ...options }
  const hubs = options.hubs ?? []
  const scored: KnowledgeHit[] = []
  /*
   * La rarita' si calcola sull'archivio intero, **una volta sola** per richiesta.
   *
   * Calcolarla dentro il ciclo su ogni nota sarebbe la stessa somma ripetita N volte: con
   * cento note e mille parole ciascuna sono cento mila di operazioni per una domanda che ne
   * ha bisogno di poche migliaia. E il risultato sarebbe identico, perche' l'archivio non
   * cambia dentro il ciclo.
   */
  const inverse = inverseFrequencies(entries.map((entry) => `${entry.title} ${entry.text}`))
  for (const entry of entries) {
    const score = relevance(query, `${entry.title} ${entry.text}`, inverse)
    if (score >= threshold) scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score || a.entry.createdAt - b.entry.createdAt)

  const chosen: KnowledgeHit[] = []
  let used = 0
  for (const hit of scored) {
    if (chosen.length >= limit) break
    const cost = estimateTokens(`${hit.entry.title}\n${hit.entry.text}`)
    // Una nota che da sola sfora il budget non viene troncata: mezzo argomento e' peggio che
    // niente, perche' il modello lo prenderebbe per un pensiero completo.
    if (used + cost > budgetTokens && chosen.length > 0) continue
    chosen.push(hit)
    used += cost
  }

  if (chosen.length === 0) {
    return {
      heading: KNOWLEDGE_BLOCK_HEADING,
      body: '',
      entryIds: [],
      estimatedTokens: 0,
      hits: [],
      nothingRelevant: entries.length > 0,
    }
  }

  const body = chosen
    .map((hit) => {
      /*
       * Il nome del centro precede il titolo, e solo quando la nota ne ha uno.
       *
       * E' l'unico modo in cui la scelta dell'utente arriva al modello. Il resto della
       * mappa — le distanze, i colori, le linee — e' roba da guardare, e al modello non
       * arriva niente di tutto cio'. Qui il raggruppamento diventa una riga di testo, e
       * senza quella riga una nota su «listini» e una su «fisco» citate di fila sembrerebbero
       * due pezzi dello stesso argomento.
       *
       * Il centro resta **fuori** dal conteggio delle note citate: `entryIds` elenca i
       * passaggi che il modello puo' citare, e un nome di comodo non e' un passaggio. Se
       * entrasse in quel conto, un blocco con due note dello stesso centro conterrebbe tre
       * id e il riepilogo mostrerebbe all'utente una terza nota che non esiste.
       */
      const hub = hubs.find((candidate) => candidate.id === hit.entry.hubId)
      const label = hub ? `[${hub.title}] ` : ''
      return `- ${label}${hit.entry.title}\n  ${oneLine(hit.entry.text)}`
    })
    .join('\n')
  return {
    heading: KNOWLEDGE_BLOCK_HEADING,
    body,
    entryIds: chosen.map((hit) => hit.entry.id),
    estimatedTokens: used,
    hits: chosen,
    nothingRelevant: false,
  }
}

/** One note matched by a word the user typed, and where the word sits inside it. */
export interface KnowledgeSearchHit {
  entryId: KnowledgeId
  title: string
  /** The main point it hangs from, so the result line can say what group it is in. */
  hubTitle: string | null
  /** A window of text around the match, with the word still inside it. */
  snippet: string
  /** Where the match starts inside `snippet`, for highlighting. */
  at: number
  /** How long the matched word is, so highlighting knows where to stop. */
  length: number
  /** How many times the word appears in this note. */
  occurrences: number
}

/** The longest window worth showing in a result line. */
const KNOWLEDGE_SNIPPET = 140

/** How far either side of the match the window reaches. */
const KNOWLEDGE_LEAD = 48

/** Counts non-overlapping occurrences, case-insensitively. */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    count += 1
    from = at + needle.length
  }
  return count
}

/** A readable window around the first match, with room for the word to sit inside. */
function knowledgeSnippet(
  text: string,
  at: number,
  length: number,
): { snippet: string; at: number } {
  const start = Math.max(0, at - KNOWLEDGE_LEAD)
  const end = Math.min(text.length, Math.max(at + length, start + KNOWLEDGE_SNIPPET))
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim()
  // Gli scarti si spostano quando gli spazi collassano, quindi la parola viene cercata
  // di nuovo nel testo compattato invece di fidarsi che sia sopravvissuta al passaggio.
  const shifted = snippet.toLowerCase().indexOf(text.slice(at, at + length).toLowerCase())
  if (start > 0) snippet = `…${snippet}`
  if (end < text.length) snippet = `${snippet}…`
  return { snippet, at: shifted < 0 ? 0 : shifted + (start > 0 ? 1 : 0) }
}

/**
 * The notes matching every word the user typed, best first.
 *
 * E' **la stessa regola** della ricerca del workspace — tutte le parole, non qualcuna — e
 * per la stessa ragione: un risultato che contiene una parola su tre e' rumore, e in una
 * ricerca il rumore e' peggio di non trovare niente, perche' l'utente smette di fidarsi e
 * smette anche di guardare quello che c'era davvero.
 *
 * L'ordine mette davanti la nota che contiene il termine **piu' volte**. Tre occorrenze
 * di una parola sono quasi sempre piu' dell'occasione che qualcuno ci abbia scritto una
 * volta per caso, ed e' la differenza fra aprire il file giusto e leggerne quattro prima
 * di trovarlo.
 *
 * La ricerca guarda **anche i collegamenti**: se due note sono state legate a mano e una
 * contiene la parola, l'altra la riporta come «collegata a». Una nota che non contiene
 * nulla di quello che e' stato scritto e' comunque la risposta a «di cosa parla questo
 * insieme?», ed e' esattamente la domanda che un archivio con collegamenti e' in grado di
 * rispondere e che da solo non potrebbe.
 */
export function searchKnowledge(
  entries: readonly KnowledgeEntry[],
  hubs: readonly KnowledgeHub[],
  query: string,
  limit = 40,
): KnowledgeSearchHit[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []
  const hubTitles = new Map(hubs.map((hub) => [hub.id, hub.title]))
  const found: Array<KnowledgeSearchHit & { score: number }> = []

  for (const entry of entries) {
    const body = entry.text
    const lower = body.toLowerCase()
    let occurrences = 0
    let leadAt = -1
    let leadLength = 0
    let matchedAll = true
    for (const term of terms) {
      const at = lower.indexOf(term)
      if (at < 0) {
        matchedAll = false
        break
      }
      const count = countOccurrences(lower, term)
      if (leadAt < 0) {
        leadAt = at
        leadLength = term.length
      }
      occurrences += count
    }
    if (!matchedAll || leadAt < 0) continue
    const { snippet, at } = knowledgeSnippet(body, leadAt, leadLength)
    found.push({
      entryId: entry.id,
      title: entry.title,
      hubTitle: entry.hubId ? hubTitles.get(entry.hubId) ?? null : null,
      snippet,
      at,
      length: leadLength,
      occurrences,
      score: Math.min(occurrences, 999),
    })

    // I collegati entrano in coda, marcati come tali. Non vengono contati come
    // corrispondenze vere e proprie: non contengono la parola, e presentarli come se la
    // contenessero sarebbe dire una cosa falsa su quello che l'utente sta cercando.
    for (const neighbourId of neighboursOf(entries, entry.id)) {
      const neighbour = entries.find((candidate) => candidate.id === neighbourId)
      if (!neighbour || found.some((hit) => hit.entryId === neighbour.id)) continue
      const clean = neighbour.text.trim().replace(/\s+/g, ' ')
      found.push({
        entryId: neighbour.id,
        title: neighbour.title,
        hubTitle: neighbour.hubId ? hubTitles.get(neighbour.hubId) ?? null : null,
        snippet: clean.length > KNOWLEDGE_SNIPPET ? `${clean.slice(0, KNOWLEDGE_SNIPPET - 1)}…` : clean,
        at: 0,
        length: 0,
        occurrences: 0,
        score: 0,
      })
    }
  }

  found.sort((a, b) => b.score - a.score || (a.entryId < b.entryId ? -1 : 1))
  return found.slice(0, limit).map(({ score: _score, ...hit }) => hit)
}

/**
 * The main point a passage most looks like it belongs to.
 *
 * Serve a una cosa sola: **proporre** il centro nella finestra che chiede dove mettere la
 * nota. Non lo sceglie — quello lo fa l'utente, e la finizione resta una proposta
 * comunque, perche' «di cosa parla questo insieme» e' una domanda sul come l'utente vuole
 * raggruppare e non sul testo. Serve pero' a non far scegliere a caso: fra tre centri
 * proporsi quello che non ha niente a che fare e' la stessa aria di minore che scegliere
 * «nessuno».
 *
 * Il confronto e' sul **nome** del centro e non sulle note che vi pendono: la domanda e'
 * «di cosa parla questo centro», e le note gia' appese sono la risposta, non la traccia.
 */
export function suggestHub(
  draft: KnowledgeDraft,
  hubs: readonly KnowledgeHub[],
): KnowledgeHub | null {
  if (hubs.length === 0) return null
  const inverse = inverseFrequencies(hubs.map((hub) => hub.title))
  let best: KnowledgeHub | null = null
  let bestScore = 0
  for (const hub of hubs) {
    const score = relevance(draft.text, hub.title, inverse)
    if (score > bestScore) {
      bestScore = score
      best = hub
    }
  }
  return bestScore > 0 ? best : null
}

/** Notes are quoted on one line: the block is an index of what exists, not the archive. */
function oneLine(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > 320 ? `${clean.slice(0, 319)}…` : clean
}

/**
 * The text handed to the model, notes included.
 *
 * Il blocco si chiude da solo con il proprio tag di chiusura perche' il modello deve poter
 * distinguere **dove finisce** il materiale e comincia la domanda. Senza quella riga, un
 * blocco che arriva a meta' del contesto e' indistinguibile dal testo dell'utente e il
 * modello lo tratta come se l'utente avesse scritto quelle frasi: il difetto peggiore,
 * perche' non si vede e produce risposte sicurissime su cose che l'utente non ha detto.
 *
 * L'avviso di sola lettura va **dentro** il blocco e non come messaggio di sistema a se':
 * in un contesto lungo un messaggio separato puo' restare indietro, e il modello finirebbe
 * per promettere di cancellare — cioe' di fare — qualcosa che non puo' fare.
 */
export function renderKnowledgeBlock(injection: RetrievalResult): string {
  if (injection.entryIds.length === 0) return ''
  const tag = injection.heading.toLowerCase().replace(/\s+/g, '_')
  return [`<${tag}>`, KNOWLEDGE_READ_ONLY_NOTICE, '', injection.body, `</${tag}>`].join('\n')
}
