/**
 * La forma della mappa: **un nocciolo di punti di contesto e un guscio di note**.
 *
 * Tutto qui dentro e' puro e sincrono, come `knowledgeLayout.ts`, e per la stessa ragione: la
 * domanda «due note finiscono addossate?» e «i punti di contesto stanno al centro?» si
 * rispondono con un risultato atteso, non guardando un'immagine e dichiarando che sembra bene.
 *
 * ---
 *
 * **Perche' due strati e non una nuvola.**
 *
 * La versione precedente appendeva le note attorno al proprio centro con un raggio che cresceva
 * con quante ce n'erano, e i centri stavano su un anello. Il risultato era un volume pieno: le
 * note dei centri vicini si incrociavano, e non si sapeva piu' quale nota appartenesse a cosa
 * guardando la mappa — si sapeva solo guardando il filo.
 *
 * Il nocciolo e il guscio rispondono alla domanda che l'occhio fa per primo, che e' «di chi e'
 * questa nota?». Un centro al centro con le note attorno e' la risposta per costruzione: il
 * raggio dice a chi appartiene, e non costa niente perche' e' gia' li'.
 *
 * ---
 *
 * **Perche' la radice, e non un numero lineare.** E' il punto di tutta questa parte, ed e'
 * l'unica cosa che va provata bene.
 *
 * Su una superficie, `N` punti hanno distanza minima circa `raggio / radice(N)`. Tenere quella
 * distanza costante — cioe' tenere le note separate — vuol dire che il raggio deve crescere
 * **come la radice di N**. Un raggio lineare e' l'opposto di quello che serve: aggiunge spazio
 * dove il guscio e' gia' largo e non lo aggiunge dove si stringe, il centro si riempie fino a
 * diventare una palla, e la repulsione comincia a spingere. E il difetto si presenta piano,
 * perche' regge per sei note e si rompe al settimo.
 *
 * ---
 *
 * **Perche' i centri stanno su una sfera sola.**
 *
 * Il nocciolo e' una **unica** sfera e tutti i centri ci stanno dentro: la posizione `i` e' il
 * punto `i` di una sfera di `totale` punti. Il calcolo precedente indicizzava una sfera
 * *diversa* per ogni centro — la posizione `n` era il punto `n-1` di una sfera di `n` punti — e
 * le direzioni non avevano nessuna relazione fra loro. Il risultato si vedeva: quattro pallini
 * sovrapposti al centro della mappa, che non leggono come «quattro punti di contesto» ma come
 * uno solo.
 */

import type { Vec3 } from '../types/knowledge'
import { MIN_SEPARATION } from './knowledgeLayout'

// ---------------------------------------------------------------------------
// Il nocciolo: i punti di contesto
// ---------------------------------------------------------------------------

/**
 * Half the smallest distance two main points should keep. Times the square root of the count.
 *
 * Con `N` punti a distanza minima `d` su una superficie, il raggio che serve e' circa
 * `d * radice(N) / 2`. Quindi `HUB_CORE_RADIUS * radice(N)` e' il raggio che tiene i centri a
 * distanza `2 * HUB_CORE_RADIUS` l'uno dall'altro, e la repulsione non ha niente da fare.
 */
export const HUB_CORE_RADIUS = 1.2

/** How far the notes have to stay beyond the core, so the two layers never meet. */
export const CORE_CLEARANCE = 2.4

/**
 * Where main point `index` sits, given how many there are in all.
 *
 * Il parametro `total` non e' un dettaglio: e' cio' che rende possibile la separazione. Senza,
 * ogni centro calcolerebbe la propria sfera e le direzioni non avrebbero niente in comune — che
 * e' esattamente il difetto che questo file sostituisce.
 *
 * Il raggio cresce con `radice(totale)` perche' cresca anche la distanza fra i centri: aggiungere
 * un centro non spinge dentro gli altri, li mette un filo piu' la'. E un centro solo ha una sfera
 * che e' un punto: il raggio minimo di una basta a dargli una dimensione, cosi' non viene
 * disegnato come un pixel.
 */
export function corePoint(index: number, total: number): Vec3 {
  const n = Math.max(1, Math.floor(total))
  const i = Math.max(0, Math.min(n - 1, Math.floor(index)))
  const direction = fibonacciDirection(i, n) ?? { x: 0, y: 0, z: 1 }
  const reach = coreRadius(n)
  return { x: direction.x * reach, y: direction.y * reach, z: direction.z * reach }
}

/** The radius of the core for `total` main points. */
export function coreRadius(total: number): number {
  return HUB_CORE_RADIUS * Math.sqrt(Math.max(1, total))
}

/**
 * The closest a note may ever sit to the middle of the map.
 *
 * E' il nocciolo piu' il distacco, e non un numero fisso: il distacco e' quello che serve a tenere
 * le note fuori dai centri, quindi cresce con il nocciolo. Con un numero fisso, dodici centri
 * avrebbero il nocciolo dentro le note e la stratificazione si romperebbe — di nuovo, solo con un
 * archivio grande, che e' il modo peggiore in cui un difetto si presenta.
 */
export function noteFloorRadius(hubCount: number): number {
  return coreRadius(hubCount) + CORE_CLEARANCE
}

// ---------------------------------------------------------------------------
// Il guscio: le note
// ---------------------------------------------------------------------------

/** How much room each note needs, before the square root. */
export const SHELL_UNIT = 2.4

/** The shell never starts closer than this to its main point. */
export const SHELL_FLOOR = 1.9

/**
 * How strongly a note is pushed towards the outside of the map.
 *
 * E' il termine che trasforma «un guscio attorno a ogni centro» in «uno strato fuori dal
 * centro». Senza, le note di un centro interno puntano verso l'esterno in ogni direzione e
 * finiscono dentro gli altri centri: si torna al volume pieno di prima, con un nome piu' bello.
 *
 * Il valore e' sotto `1` di proposito. A `1` tutte le note di un centro andrebbero a finire dal
 * lato opposto rispetto al centro della mappa, e un centro con due note avrebbe le due note
 * **nello stesso punto**. Con 0.6 il guscio resta un guscio e la parte interna e' la minoranza,
 * che serve a dare volume alla sfera invece di una mezzaluna.
 */
export const OUTWARD_BIAS = 0.6

/** How much to push a note further out per attempt when it lands on top of another. */
const CLEARANCE_STEP = 0.42

/** How many times to try before settling for the furthest point found. */
const CLEARANCE_TRIES = 14

/**
 * The gap two notes must keep when they are placed.
 *
 * Un po' piu' di `MIN_SEPARATION`, che e' quello che chiede la simulazione: la simulazione
 * spinge gia' quando due corpi sono troppo vicini, e se la disposizione di partenza rispetta
 * esattamente quella soglia il primo fotogramma li scappa e la mappa si muove per niente.
 * Partire da un margine in piu' vuol dire che il rilassamento non ha niente da fare e la mappa
 * nasce ferma.
 */
const PLACED_SEPARATION = MIN_SEPARATION * 1.15

/**
 * The radius of the shell for `count` notes.
 *
 * `radice`, non lineare, per il motivo scritto in cima al file: e' la relazione che tiene la
 * distanza minima fra due note costante mentre il centro si riempie.
 */
export function shellRadius(count: number): number {
  const n = Math.max(1, Math.floor(count))
  return Math.max(SHELL_FLOOR, SHELL_UNIT * Math.sqrt(n))
}

/**
 * The shell radius of a note, measured from the **middle of the map**.
 *
 * Ed e' qui che sta la correzione che chiude il difetto, ed e' una correzione di **dove** si
 * misura, non di quanto.
 *
 * Il guscio era un raggio **dal centro di contesto**, e la conseguenza era che il raggio giusto
 * dipendeva da quanto quel centro fosse lontano dal mezzo. Per un centro al centro della mappa
 * il raggio minimo per restare fuori dal nocciolo e' `pavimento`; per un centro a 4 dal mezzo e'
 * `pavimento - 4`. Ma quel numero e' un raggio *dal centro di contesto*, e una nota che punta
 * verso l'interno con quel raggio finisce a 4 - (pavimento - 4) dal mezzo — cioe' **dentro il
 * nocciolo**, proprio dalla parte opposta a dove si voleva.
 *
 * Misurando dal mezzo, la proprieta' e' vera per costruzione: la nota e' a `raggio` dal centro
 * della mappa, e `raggio` non scende mai sotto il pavimento. Non c'e' direzione che la faccia
 * finire dentro, perche' non esiste una direzione: il punto e' gia' alla distanza giusta.
 *
 * Il secondo termine serve a un'altra cosa, che e' la vicinanza al proprio centro: la nota non puo'
 * avvicinarsi al centro di contesto piu' di `shellRadius(count)`, altrimenti le note di un centro
 * con molte note si stringerebbero addosso a lui e il centro si riempirebbe di nuovo. Con i due
 * termini presi col massimo, il raggio rispetta **entrambi**: il pavimento della mappa e la
 * distanza dal proprio centro.
 */
export function shellRadiusFrom(count: number, hub: Vec3, hubCount: number): number {
  const floor = noteFloorRadius(hubCount)
  const away = reachOf(safe(hub)) + shellRadius(count)
  return Math.max(floor, away)
}

/**
 * The spot on a main point's shell where a note hangs.
 *
 * Il punto nasce **dal centro della mappa** e non dal centro di contesto: vedi `shellRadiusFrom` per
 * la ragione, che e' l'unica cosa che tiene vera la divisione in due strati.
 *
 * La direzione viene dall'id, mescolata con quella del proprio centro: e' cio' che tiene le note di
 * un centro **nello stesso angolo** della mappa, cosi' il filo resta corto e l'occhio capisce a chi
 * appartiene la nota senza doverla cercare. La direzione e' anche l'unica cosa che rende la
 * posizione **stabile** fra un caricamento e l'altro, perche' viene dall'id e non dall'ordine.
 */
export function shellPoint(
  hub: Vec3,
  count: number,
  entryId: string,
  hubCount: number,
): Vec3 {
  const centre = safe(hub)
  const fromId = unit(directionFrom(entryId))
  const outward = unit(centre)
  const direction = unit({
    x: fromId.x + outward.x * OUTWARD_BIAS,
    y: fromId.y + outward.y * OUTWARD_BIAS,
    z: fromId.z + outward.z * OUTWARD_BIAS,
  })
  const radius = shellRadiusFrom(count, centre, hubCount)
  return { x: direction.x * radius, y: direction.y * radius, z: direction.z * radius }
}

/**
 * The band a note is kept inside, measured from the middle of the map.
 *
 * Il limite **interno** e' il pavimento delle note, e non un numero tolto dal raggio: e' la stessa
 * soglia che `shellPoint` usa, quindi la nota non puo' essere trascinata dentro il nocciolo. Senza
 * questa coerenza — la stessa soglia in due posti — il richiamo all'ancora e la repulsione
 * porterebbero una nota dentro nell'arco di qualche secondo e la mappa tornerebbe al volume pieno,
 * lentamente e senza che nessuno se ne accorga.
 *
 * Il limite **esterno** e' generoso, e non un multiplo del raggio: con trenta note sullo stesso
 * centro il guscio arriva a 13, e un tetto a `pavimento * 1.3` — 6.2 — ricollasserebbe le trenta
 * note in una corona stretta proprio quando il centro e' pieno. Il tetto segue quindi il guscio con
 * un margone, e il pavimento resta il pavimento.
 */
export function shellBand(
  count: number,
  _hub: Vec3,
  hubCount: number,
): { inner: number; outer: number } {
  const floor = noteFloorRadius(hubCount)
  return {
    inner: floor,
    outer: Math.max(shellRadius(count) * 1.35, floor * 1.35),
  }
}

/**
 * The shell point, pushed out along its own direction until it touches nobody.
 *
 * Il punto e' che la correzione e' **lungo la stessa direzione**: la nota resta sul suo strato e non
 * viene spostata in un angolo nuovo. Spostarla in un angolo nuovo la porterebbe dentro il guscio
 * di un altro centro, che e' proprio il difetto da evitare — e sarebbe un difetto invisibile,
 * perche' il filo continua a puntare al centro giusto mentre la nota e' dentro un altro.
 *
 * Il caso in cui il posto e' davvero pieno si chiude con il punto **piu' lontano** trovato, che e'
 * comunque legittimo: e' meglio una nota stretta che una nota messa in mezzo a due altre.
 */
export function clearShellPoint(
  hub: Vec3,
  count: number,
  entryId: string,
  hubCount: number,
  existing: readonly { position: Vec3 }[],
): Vec3 {
  const centre = safe(hub)
  const base = shellPoint(centre, count, entryId, hubCount)
  const best = { point: base, gap: gapTo(base, existing) }
  if (best.gap >= PLACED_SEPARATION) return base

  /*
   * `away`, e non `unit`: `unit` e' la funzione che normalizza, e chiamarla `unit` qui dentro
   * questa funzione la farebbe riferire a se stessa — un nome che si cancella.
   */
  const away = unit(directionFrom(entryId))
  let radius = shellRadiusFrom(count, centre, hubCount)
  for (let attempt = 0; attempt < CLEARANCE_TRIES; attempt += 1) {
    radius += CLEARANCE_STEP
    const candidate = {
      x: away.x * radius,
      y: away.y * radius,
      z: away.z * radius,
    }
    const gap = gapTo(candidate, existing)
    if (gap > best.gap) {
      best.point = candidate
      best.gap = gap
    }
  }
  return best.point
}

// ---------------------------------------------------------------------------
// La sfera di Fibonacci e i numeri che non devono poter sparire
// ---------------------------------------------------------------------------

/** The `index`-th of `total` points spread evenly over a sphere. */
export function fibonacciDirection(index: number, total: number): Vec3 | null {
  if (total <= 0) return null
  const n = Math.max(1, Math.floor(total))
  const i = Math.max(0, Math.min(n - 1, Math.floor(index)))
  /*
   * Il `+ 0.5` dentro: e' quello che rende la serie **uniforme**.
   *
   * Senza il mezzo, `y` andava da 1 a `1 - 2/n`: trenta punti su una sfera finivano tutti dentro
   * una fascia di 0.067 vicino al polo nord, e la distanza minima fra due di loro era 0.068
   * invece di circa 0.65. Non e' una questione estetica: quei trenta punti si accavallavano
   * tutti, che e' esattamente il difetto che la funzione doveva togliere.
   */
  const y = 1 - ((i + 0.5) * 2) / n
  const radius = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = i * 2.399963229728653
  return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius }
}

/**
 * A stable pseudo-random direction, from the entry's id.
 *
 * `Math.random` qui sarebbe un errore, e non per il gusto della determinazione: la posizione viene
 * **salvata**, quindi un caso diverso a ogni esecuzione produrrebbe note in posti diversi pur senza
 * che nessuno le abbia toccate. Un archivio che si sposta da solo fra un giorno e l'altro non e'
 * piu' navigabile, ed e' il difetto che fa smettere di fidarsi di una mappa.
 */
export function directionFrom(id: string): Vec3 {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // Tre numeri distinti dallo stesso hash: FNV-32 e' un intero, e per tre direzioni diverse serve
  // mescolarlo in modo che i pezzi non si sommino in modo ovvio.
  const a = ((hash >>> 0) % 10007) / 10007
  const b = ((Math.imul(hash, 2654435761) >>> 0) % 10007) / 10007
  const c = ((Math.imul(hash, 40503) >>> 0) % 10007) / 10007
  const theta = a * Math.PI * 2
  const phi = Math.acos(2 * b - 1)
  const radius = Math.sqrt(c)
  return {
    x: Math.sin(phi) * Math.cos(theta) * radius,
    y: Math.cos(phi) * radius,
    z: Math.sin(phi) * Math.sin(theta) * radius,
  }
}

/**
 * A point with no `NaN` in it, whatever came in.
 *
 * Il difetto che questa funzione chiude e' **la nota invisibile**: `NaN` non e' «in un posto
 * sbagliato», e' fuori dal mondo. Non si vede, non si tocca, non si seleziona, e nessun errore lo
 * segnala — `three` lo moltiplica e la sfera sparisce. Il caso arriva da un file salvato o da uno
 * store, dove un campo puo' non essere un numero: `positionX` al posto di `x`, `null`, una divisione
 * per zero prima.
 *
 * Il fallback non e' lanciare un errore. Qui dentro non c'e' niente a cui fare eccezione, e lanciare
 * lascerebbe la nota senza posto — che e' esattamente il guaio da evitare. Si mette zero sul
 * componente rotto: la nota finisce in un posto **guardabile**, e se il dato e' sbagliato l'utente
 * lo vede invece di accorgersi che una nota e' sparita.
 */
export function safe(v: Vec3): Vec3 {
  return {
    x: Number.isFinite(v.x) ? v.x : 0,
    y: Number.isFinite(v.y) ? v.y : 0,
    z: Number.isFinite(v.z) ? v.z : 0,
  }
}

/**
 * A vector of length one, or straight up if the input cannot be measured.
 *
 * Come `safe`, il controllo su `Number.isFinite` serve perche' `NaN` supera il confronto
 * `length < 1e-6`, si divide per se stesso e restituisce `NaN`. Il fallback e' una direzione
 * **valida**, quindi la nota finisce in un posto guardabile invece che da nessuna parte.
 */
export function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z)
  if (!Number.isFinite(length) || length < 1e-6) return { x: 0, y: 1, z: 0 }
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

/** How far a point is from the middle, treating an unmeasurable point as the middle. */
export function reachOf(v: Vec3): number {
  const reach = Math.hypot(v.x, v.y, v.z)
  return Number.isFinite(reach) ? reach : 0
}

/** The distance from `point` to the nearest note already on the map. */
function gapTo(point: Vec3, existing: readonly { position: Vec3 }[]): number {
  let worst = Infinity
  for (const entry of existing) {
    const gap = Math.hypot(
      point.x - entry.position.x,
      point.y - entry.position.y,
      point.z - entry.position.z,
    )
    if (gap < worst) worst = gap
  }
  return worst
}