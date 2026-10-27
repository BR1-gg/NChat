/**
 * Il moto della mappa, **fuori** dal disegno.
 *
 * Tutto qui dentro e' **puro e sincrono**: una funzione che prende un insieme di corpi e
 * restituisce il passo successivo. Niente `three`, niente DOM, niente attese.
 *
 * Il motivo non e' la pulizia, e' la stessa cosa che vale in `logic/knowledge.ts`: e' cio'
 * che rende verificabile la parte che costa. «Due note si spingono via» e «la mappa si
 * ferma» sono domande a cui si puo' rispondere con un test e un risultato atteso, senza
 * un contesto WebGL e senza un browser. Dentro `knowledgeScene.ts` quelle risposte sarebbero
 * invisibili: si potrebbe solo guardare una immagine e dichiarare che «sembra andare bene»,
 * che e' la forma di verifica che non trova niente.
 *
 * Il passo e' piccolo e con attrito **per costruzione**: e' un rilassamento, quindi converge.
 * Una mappa che si muove per sempre non e' una mappa viva, e' una mappa di cui non ci si
 * fida — e la parte importante di questo file e' che la **quiete** e' una proprieta'
 * garantita, non una speranza.
 */

import type { Vec3 } from '../types/knowledge'

/** Notes closer than this get pushed apart, so a cluster does not become one blob. */
export const MIN_SEPARATION = 2.1

/**
 * How far a push reaches, past the minimum.
 *
 * La repulsione non e' a scatto: sotto `MIN_SEPARATION` spinge forte e si spegne gradualmente
 * fino a qui. Con una spinta a scatto due note che si toccano si separano di colpo e si
 * fermano — e il «colpo» e' esattamente cio' che fa sembrare una mappa viva **rotta**: un
 * salto, non un movimento. La coda lunga tiene invece le note in una ressoppressione lenta
 * e continua, che e' quello che l'occhio legge come vivo.
 */
export const REPULSION_RANGE = 3.6

/** How hard a body pushes at touching distance. */
export const REPULSION = 0.85

/** How quickly a body is pulled back to where it belongs. */
export const ANCHOR_PULL = 0.05

/** How much of a body's movement survives one step. Below 1 is friction. */
export const DAMPING = 0.8

/** Below this, a movement is not a movement and the map is at rest. */
export const STILL_ENOUGH = 0.001

/**
 * Oltre questa distanza dal centro, l'ancora viene tirata verso il centro.
 *
 * E' la regola che rende la gravita' una **forma** e non un semplice attrito. Dentro
 * questo raggio la gravita' non tocca l'ancora, quindi una disposizione scelta a mano dentro
 * la gruppo resta dov'e' stata messa: si puo' spostare una nota dove si vuole finche' si
 * resta nel gruppo, e non si sente la mappa che richiama tutto al centro ogni volta che si
 * esce. Fuori, invece, l'ancora scende, e la mappa si stringe.
 *
 * Il numero e' volutamente **non piccolo**: e' la taglia oltre la quale un archivio non
 * sta piu' nella finestra. Sotto, tutto e' visibile e la gravita' non serve; sopra, e' cio'
 * che tiene la mappa leggibile invece di distribuita in un volume che non si guarda.
 */
export const GRAVITY_RADIUS = 9

/** How hard a loose body is drawn towards the centre. */
export const GRAVITY_PULL = 0.07

/** How fast a layout contracts: slower than the bodies, so the shape relaxes visibly. */
export const GRAVITY_CONTRACT = 0.05

/** The range over which gravity reaches full strength. Near the centre it eases off. */
export const GRAVITY_REACH = 3

/**
 * Un corpo sulla mappa, e tutto quello che serve per calcolare il suo prossimo passo.
 *
 * `position`, `anchor` e `velocity` sono **copie**, non riferimenti a `three`: il modulo
 * conosce solo numeri, e la scena fa la copia avanti e indietro. Il vantaggio e' che qui
 * dentro non puo' capitare niente che non sia un numero — e il difetto piu' subdolo di una
 * simulazione e' sempre un riferimento condiviso che qualcuno modifica per sbaglio.
 */
export interface MovingBody {
  position: Vec3
  /** Where this body is being pulled back to. */
  anchor: Vec3
  velocity: Vec3
  /** True while the user's hand is on it: nothing fights the pointer. */
  held: boolean
  /**
   * The band this body stays inside, when it belongs to a layer.
   *
   * E' cio' che tiene vivo «primo strato, secondo strato» **dopo** che la mappa si e' messa in
   * moto. Senza, il richiamo all'ancora e la repulsione possono, poco alla volta, tirare una
   * nota dentro il nocciolo: dopo qualche minuto di archivio con note nuove la stratificazione
   * non si vede piu' e la mappa torna a essere il volume pieno di sempre — ma piano, senza che
   * nessuno noti il momento in cui e' successo.
   *
   * Il vincolo e' morbido nel senso giusto: la nota puo' muoversi **libera dentro** la banda,
   * ed e' quello che le permette di non accavallarsi le altre e di stare dove l'utente l'ha
   * messa. Quello che non puo' fare e' uscire dal proprio strato, che e' la forma con cui
   * l'occhio capisce a chi appartiene una nota.
   */
  shell?: Shell
}

/**
 * The layer a body is kept in: a centre, and how far from it the body may get.
 *
 * `inner` e' quello che tiene la nota fuori dal centro, `outer` quello che le permette di
 * sporgersi dal guscio senza fuggire. I due numeri li calcola `shellBand` dal numero di note
 * del centro: piu' note, guscio piu' grande.
 */
export interface Shell {
  centre: Vec3
  inner: number
  outer: number
}

/**
 * True while something is still settling.
 *
 * E' una domanda sul **massimo**, non sulla somma: cento note che ognuna si sposta di un
 * millesimo hanno una somma che sembra un urto e si fermano tutte entro lo stesso
 * fotogramma. Il massimo dice la verita' sul fotogramma, che e' l'unica cosa che decide se
 * smettere di scrivere e se dire che la mappa si e' fermata.
 */
/** How far apart two points are. */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/**
 * One step of the relaxation.
 *
 * Due forze, e la loro somma e' il comportamento:
 *
 * - **la repulsione** spinge indietro quando due corpi sono piu' vicini di quanto
 *   dovrebbero, e gira **sempre**, non una volta sola. E' la richiesta esplicita di una
 *   mappa viva, ed e' anche il motivo per cui il rilascio di un nodo non lascia piu' nulla
 *   di incrociato al centro di un gruppo.
 * - **l'ancora** riporta piano verso dove il corpo sta, ed e' cio' che rende la mappa
 *   **stabile**: senza, la repulsione da sola allontanerebbe ogni nota all'infinito,
 *   perche' spingerebbe sempre e non ci sarebbe mai un punto di quiete.
 *
 * Il passo e' **piccolo e con attrito**, e non un colpo verso la soluzione: e' un
 * rilassamento, quindi converge e si ferma. La mappa si muove per un secondo o due e poi
 * sta ferma, e li' e' il confine oltre il quale «viva» diventa «non fidabile».
 *
 * I corpi vengono **modificati sul posto**: la funzione restituisce `void` perche' il
 * chiamante e' la scena, che ha gia' i suoi oggetti e li aggiorna comunque a ogni
 * fotogramma. Copiare fuori e dentro costerebbe un array e un oggetto per corpo a ogni
 * fotogramma, per niente.
 */
export function relax(bodies: MovingBody[]): void {
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const a = bodies[i]!
      const b = bodies[j]!
      let dx = a.position.x - b.position.x
      let dy = a.position.y - b.position.y
      let dz = a.position.z - b.position.z
      let gap = Math.hypot(dx, dy, dz)
      if (gap >= REPULSION_RANGE) continue
      if (gap < 0.0001) {
        /*
         * Due corpi esattamente sovrapposti non hanno una direzione: dividere per la
         * lunghezza nulla drebbe zero e i due resterebbero fermi li' per sempre. Si da' loro
         * una direzione fissa, e la separazione diventa una questione di qualche fotogramma
         * invece che di sempre. Il caso non e' raro: succede quando due note vengono
         * appese al centro con lo stesso indice, e senza questo resterebbero invisibili una
         * dietro l'altra per sempre — cioe' una nota che non si vede e non si sa perche'.
         */
        dx = 0.31
        dy = 0.17
        dz = 0.93
        gap = Math.hypot(dx, dy, dz)
      }
      /*
       * Spinta piena fino alla distanza minima, e poi un rivale che si spegne fino al raggio
       * massimo. La parte piena e' quella che scioglie un accavallamento vero, e il rivale
       * e' quello che tiene le note vicine in una ressoppressione lenta invece di farle
       * saltare e fermarsi — che e' la differenza fra una mappa viva e una mappa che scatta.
       */
      const over =
        gap <= MIN_SEPARATION
          ? 1
          : 1 - (gap - MIN_SEPARATION) / (REPULSION_RANGE - MIN_SEPARATION)
      const push = (REPULSION * over) / gap
      const ux = dx * push
      const uy = dy * push
      const uz = dz * push
      if (!a.held) {
        a.velocity.x += ux
        a.velocity.y += uy
        a.velocity.z += uz
      }
      if (!b.held) {
        b.velocity.x -= ux
        b.velocity.y -= uy
        b.velocity.z -= uz
      }
    }
  }

  for (const body of bodies) {
    if (body.held) continue
    // Il richiamo all'ancora e' di gran lunga piu' debole della repulsione, cosi' la mappa
    // si allarga dove il confronto fra le parole ha detto che le note stanno vicine e non
    // si stringe mai in un punto solo.
    body.velocity.x += (body.anchor.x - body.position.x) * ANCHOR_PULL
    body.velocity.y += (body.anchor.y - body.position.y) * ANCHOR_PULL
    body.velocity.z += (body.anchor.z - body.position.z) * ANCHOR_PULL

    /*
     * **La gravita'**: un'attrazione verso il centro dello spazio, piu' forte quanto piu' il
     * corpo e' lontano.
     *
     * Senza, le note si distribuiscono su un volume che non entra nella finestra: si salva
     * una nota, si salva un'altra, e quello che si vede sono tre palline al centro e il resto
     * fuori dallo schermo. Il difetto non e' estetico — e' che la mappa non mostra niente,
     * che e' la sua funzione.
     *
     * La forza cresce con la distanza e si spegne vicino al centro: cosi' il centro e' un
     * punto in cui le note **si fermano** e non un buco nero in cui tutte crollano. E la
     * repulsione fa il resto: il centro si riempie fino a trovare la propria dimensione e
     * li' le note si accostano.
     */
    const away = Math.hypot(body.position.x, body.position.y, body.position.z)
    if (away > 0.0001) {
      const reach = Math.min(1, away / GRAVITY_REACH)
      const pull = (GRAVITY_PULL * reach) / away
      body.velocity.x -= body.position.x * pull
      body.velocity.y -= body.position.y * pull
      body.velocity.z -= body.position.z * pull
    }

    body.velocity.x *= DAMPING
    body.velocity.y *= DAMPING
    body.velocity.z *= DAMPING
    body.position.x += body.velocity.x
    body.position.y += body.velocity.y
    body.position.z += body.velocity.z

    /*
     * E l'ancora scende, altrimenti il richiamo di sopra la riporterebbe al posto di prima
     * e la gravita' non avrebbe nessun effetto che dura: la mappa si contrarrebbe per
     * qualche fotogramma e poi tornerebbe esattamente dov'era.
     *
     * Solo **oltre** `GRAVITY_RADIUS`, cosi' dentro il gruppo la gravita' non tocca la
     * disposizione e spostare una nota a mano resta una scelta che viene rispettata.
     */
    const span = Math.hypot(body.anchor.x, body.anchor.y, body.anchor.z)
    if (span > GRAVITY_RADIUS) {
      const shrink = (GRAVITY_CONTRACT * (span - GRAVITY_RADIUS)) / span
      body.anchor.x -= body.anchor.x * shrink
      body.anchor.y -= body.anchor.y * shrink
      body.anchor.z -= body.anchor.z * shrink
    }

    /*
     * E il **vincolo di strato**, che e' l'ultima cosa che agisce e quindi quella che vince.
     *
     * Tutto quello che c'e' sopra — repulsione, richiamo, gravita' — spinge in ogni direzione,
     * e nessuna di queste forze sa che una nota con un centro appeso non dovrebbe farsi
     * tirare dentro il nocciolo. Il vincolo dice: la distanza dal tuo centro resta fra questi
     * due numeri.
     *
     * Sta **per ultimo** perche' e' una condizione, non una forza: dopo averla applicata non
     * si lascia piu' niente che possa ripartire, quindi il fotogramma successivo parte gia'
     * dentro la banda e non si vede alcuno scatto. Applicandola prima, la repulsione del
     * fotogramma dopo la porterebbe fuori e la mappa vibrarebbe lungo il bordo.
     *
     * La velocita' viene azzerata **solo sul ramo che e' uscito**: cosi' la nota si ferma sul
     * bordo invece di rimbalzare indietro, e il bordo sembra un muro e non un trampolino.
     */
    if (body.shell) holdInShell(body)
  }
}

/**
 * Keeps one body inside its layer, and stops it dead at whichever edge it crossed.
 *
 * La funzione e' separata perche' ha una sola chiamata ma una logica che merita di essere
 * letta da sola: sono quattro righe di geometria e ognuna ha un «perche'», e mescolate nel
 * ciclo dei corpi si perdono.
 */
function holdInShell(body: MovingBody): void {
  const shell = body.shell
  if (!shell) return
  const dx = body.position.x - shell.centre.x
  const dy = body.position.y - shell.centre.y
  const dz = body.position.z - shell.centre.z
  const span = Math.hypot(dx, dy, dz)
  if (span < 1e-6) return
  if (span >= shell.inner && span <= shell.outer) return
  const wanted = span < shell.inner ? shell.inner : shell.outer
  const move = wanted / span
  body.position.x = shell.centre.x + dx * move
  body.position.y = shell.centre.y + dy * move
  body.position.z = shell.centre.z + dz * move
  /*
   * L'ancora segue, perche' anchorsa altrimenti riporterebbe la nota fuori dal guscio al
   * fotogramma successivo, e il vincolo la caccerebbe di nuovo: le due forze si azzannerebbero
   * e la nota tremolerebbe sul bordo per sempre. L'ancora che segue vuol dire che la nota
   * **resta** sul bordo, che e' una scelta legittima: ci si e' trascinata e li' si e' lasciata.
   */
  body.anchor.x = body.position.x
  body.anchor.y = body.position.y
  body.anchor.z = body.position.z
  body.velocity.x = 0
  body.velocity.y = 0
  body.velocity.z = 0
}

/**
 * True while something is still settling.
 *
 * E' una domanda sul **massimo**, non sulla somma: cento note che ognuna si sposta di un
 * millesimo hanno una somma che sembra un urto e si fermano tutte entro lo stesso
 * fotogramma. Il massimo dice la verita' sul fotogramma, che e' l'unica cosa che decide se
 * smettere di scrivere e se dire che la mappa si e' fermata.
 */
export function isAtRest(bodies: readonly MovingBody[]): boolean {
  for (const body of bodies) {
    if (body.held) return false
    if (Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z) > STILL_ENOUGH) return false
  }
  return true
}

/** The largest movement anyone made in one step, for saying how lively the map is. */
export function busiest(bodies: readonly MovingBody[]): number {
  let worst = 0
  for (const body of bodies) {
    const speed = Math.hypot(body.velocity.x, body.velocity.y, body.velocity.z)
    if (speed > worst) worst = speed
  }
  return worst
}