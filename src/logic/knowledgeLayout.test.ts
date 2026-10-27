/**
 * Il moto della mappa: le tre cose che si possono sbagliare e che la vista non mostra.
 *
 * Qui dentro si decide se la mappa e' **viva** o solo animata, e se e' **leggibile** o solo
 * piena. Sono tre domande diverse, e ognuna ha un modo preciso di rompersi:
 *
 * - **le note si spingono** — e senza questo due note accavallate restano accavallate e non
 *   si vedono;
 * - **la mappa si ferma** — e senza questo non e' viva, e' animata: continua a muoversi e non
 *   ci si puo' fidare di quello che si sta guardando;
 * - **tutto sta al centro** — e senza questo la mappa si distribuisce su un volume che non
 *   entra nella finestra, e l'utente vede tre palline e pensa di aver perso il resto
 *   dell'archivio.
 *
 * L'ultimo e' il difetto che ha fatto perdere piu' tempo, e non perche' fosse complicato:
 * perche' la camera era ferma a una distanza scelta quando l'archivio era vuoto, e nessuno
 * l'aveva piu' guardata dopo. I test qui sotto prendono un archivio sparso — il caso reale,
 * con note a venti unita' dal centro — e verificano che si raccoglie.
 */

import { describe, expect, it } from 'vitest'
import {
  DAMPING,
  GRAVITY_CONTRACT,
  GRAVITY_PULL,
  GRAVITY_RADIUS,
  MIN_SEPARATION,
  REPULSION_RANGE,
  STILL_ENOUGH,
  distance,
  isAtRest,
  relax,
  type MovingBody,
} from './knowledgeLayout'

/** Una nota a `at` unita' dal centro, ferma e senza velocita'. */
function body(at: Vec3Like): MovingBody {
  return {
    position: { ...at },
    anchor: { ...at },
    velocity: { x: 0, y: 0, z: 0 },
    held: false,
  }
}

interface Vec3Like {
  x: number
  y: number
  z: number
}

/** Corre la simulazione per `frames` fotogrammi, e dice se si e' fermata. */
function settle(bodies: MovingBody[], frames: number): boolean {
  for (let i = 0; i < frames; i += 1) relax(bodies)
  return isAtRest(bodies)
}

describe('notes that were on top of each other', () => {
  it('move apart, because a note you cannot see is a note you have lost', () => {
    const bodies = [body({ x: 0, y: 0, z: 0 }), body({ x: 0.2, y: 0, z: 0 })]
    settle(bodies, 200)
    expect(distance(bodies[0]!.position, bodies[1]!.position)).toBeGreaterThan(MIN_SEPARATION)
  })

  it('separate even when they start in exactly the same place', () => {
    /*
     * Il caso in cui la divisione per la lunghezza del vettore drebbe zero: i due corpi non
     * avrebbero una direzione e resterebbero fermi li' **per sempre**. E' la fine peggiore
     * perche' non si muove niente e non si vede niente: due note identiche, una delle due
     * invisibile, e nessun movimento che spieghi il vuoto.
     */
    const bodies = [body({ x: 4, y: 1, z: 0 }), body({ x: 4, y: 1, z: 0 })]
    settle(bodies, 200)
    expect(distance(bodies[0]!.position, bodies[1]!.position)).toBeGreaterThan(MIN_SEPARATION)
  })

  it('never pushes apart bodies that are already beyond its reach', () => {
    const far = REPULSION_RANGE + 5
    const bodies = [body({ x: -far, y: 0, z: 0 }), body({ x: far, y: 0, z: 0 })]
    const before = distance(bodies[0]!.position, bodies[1]!.position)
    settle(bodies, 10)
    // La repulsione, da sola, non li spingerebbe: sono piu' lontani della sua portata. Qui la
    // distanza puo' solo **restare o diminuire**, perche' e' la gravita' a tirarli al centro,
    // e va bene cosi'. Quel che non deve succedere e' l'opposto: una spinta che agisce sempre
    // tiene le note in espansione per sempre, e una dopo l'altra esce dalla finestra. E' la
    // ragione per cui la repulsione ha una portata e non e' una forza costante.
    expect(distance(bodies[0]!.position, bodies[1]!.position)).toBeLessThanOrEqual(before)
  })

  it('do not move a body the user is holding', () => {
    const held = body({ x: 0, y: 0, z: 0 })
    held.held = true
    const bodies = [held, body({ x: 0.2, y: 0, z: 0 })]
    relax(bodies)
    expect(held.position).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('a map that stops', () => {
  it('comes to rest, instead of drifting forever', () => {
    /*
     * Il confine oltre il quale «viva» diventa «non fidabile». Una mappa che si muove sempre
     * non si puo' studiare: quello che si sta guardando non resta dove era, e ogni
     * posizione va inseguita per essere letta. E' la ragione per cui il passo e' piccolo e
     * con attrito — e' un rilassamento, quindi converge — e non una spinta verso la soluzione.
     */
    const bodies = [body({ x: 0, y: 0, z: 0 }), body({ x: 0.3, y: 0.1, z: 0.2 })]
    const still = settle(bodies, 900)
    expect(still).toBe(true)
    // E resta ferma: non basta che si fermi una volta, deve **restare** ferma.
    const snapshot = bodies.map((entry) => ({ ...entry.position }))
    settle(bodies, 60)
    for (let i = 0; i < bodies.length; i += 1) {
      expect(distance(bodies[i]!.position, snapshot[i]!)).toBeLessThan(0.01)
    }
  })

  it('says it is at rest only when nothing is moving', () => {
    const still = body({ x: 1, y: 1, z: 1 })
    expect(isAtRest([still])).toBe(true)
    still.velocity.x = 1
    expect(isAtRest([still])).toBe(false)
    // Un corpo in mano non e' mai «a riposo», perche' si muove **col dito** e non e' la
    // mappa che si sta muovendo: dirlo fermo farebbe smettere di scrivere mentre si
    // trascina, che e' quando la posizione conta di piu'.
    const held = body({ x: 0, y: 0, z: 0 })
    held.held = true
    expect(isAtRest([held])).toBe(false)
  })
})

describe('gravity towards the centre', () => {
  it('brings a scattered archive back into view', () => {
    /*
     * Il caso reale: un archivio gia' costruito, con note a dodici e venti unita' dal
     * centro, che la finestra non mostra. Senza gravita' restano li' e la mappa sembra
     * vuota — e sembra vuota anche se non e' vuota, che e' il motivo peggiore.
     */
    const bodies = [
      body({ x: 18, y: 2, z: -6 }),
      body({ x: -22, y: -3, z: 4 }),
      body({ x: 9, y: 5, z: 12 }),
    ]
    const before = bodies.map((entry) => Math.hypot(entry.position.x, entry.position.y, entry.position.z))
    settle(bodies, 700)

    for (let i = 0; i < bodies.length; i += 1) {
      const now = Math.hypot(bodies[i]!.position.x, bodies[i]!.position.y, bodies[i]!.position.z)
      expect(now).toBeLessThan(before[i]!)
    }
    // E non solo «meno»: dentro la distanza da cui la camera vede tutto, altrimenti la
    // gravita' avrebbe fatto un movimento e lasciato il problema dove era.
    const spread = bodies.map((entry) => Math.hypot(entry.position.x, entry.position.y, entry.position.z))
    expect(Math.max(...spread)).toBeLessThan(GRAVITY_RADIUS)
  })

  it('pulls a body that is loose but near the centre too', () => {
    const bodies = [body({ x: GRAVITY_RADIUS + 6, y: 0, z: 0 })]
    const before = Math.abs(bodies[0]!.position.x)
    settle(bodies, 400)
    expect(Math.abs(bodies[0]!.position.x)).toBeLessThan(before)
  })

  it('leaves the arrangement inside the cluster alone, so a dragged note stays where it was put', () => {
    /*
     * La gravita' **non deve richiamare al centro il posto** che l'utente ha scelto dentro il
     * gruppo. Se lo facesse, l'ancora scenderebbe di nuovo verso il centro a ogni apertura e
     * la disposizione andrebbe persa: il giorno dopo la mappa sarebbe diversa e nessuno
     * saprebbe perche'. E' la stessa promessa che vale per la posizione salvata, applicata al
     * posto in cui la mappa si assesta.
     *
     * La **pallina** invece si sposta un poco verso il centro, e va bene: e' proprio quello
     * che e' stato chiesto. La distinzione e' fra il posto e la posizione disegnata, e qui si
     * verifica la prima, che e' quella che non si vede quando e' rotta.
     */
    const bodies = [body({ x: GRAVITY_RADIUS - 1, y: 0, z: 0 })]
    const anchorBefore = { ...bodies[0]!.anchor }
    settle(bodies, 400)
    expect(bodies[0]!.anchor.x).toBeCloseTo(anchorBefore.x, 3)
  })

  it('gathers a cluster towards the middle without shrinking it for ever', () => {
    /*
     * La domanda che viene subito dopo «la gravita' tira dentro»: e se continua a tirare?
     *
     * Se tirasse per sempre, il gruppo si ridurrebbe di un filo a ogni apertura finche' tutte
     * le note sarebbero nello stesso punto — cioe' esattamente il difetto che la repulsione
     * doveva risolvere, ricomparso dall'altra parte. La risposta e' che l'ancora **non** si
     * contrae dentro il raggio: la posizione si assesta dove gravita' e richiamo si
     * compensano, e li' resta.
     */
    const bodies = [
      body({ x: 6, y: 0, z: 0 }),
      body({ x: -6, y: 1, z: 2 }),
      body({ x: 0, y: 5, z: -4 }),
    ]
    settle(bodies, 600)
    const settled = bodies.map((entry) => Math.hypot(entry.position.x, entry.position.y, entry.position.z))
    settle(bodies, 400)
    for (let i = 0; i < bodies.length; i += 1) {
      const now = Math.hypot(bodies[i]!.position.x, bodies[i]!.position.y, bodies[i]!.position.z)
      // Non e' che non debba muoversi: e' che non deve **continuare** a muoversi.
      expect(Math.abs(now - settled[i]!)).toBeLessThan(0.05)
    }
  })

  it('is not a black hole: notes stop near the middle instead of collapsing into one point', () => {
    const bodies = [body({ x: 20, y: 0, z: 0 }), body({ x: -20, y: 0, z: 0 })]
    settle(bodies, 800)
    // Il centro e' un posto in cui le note **si fermano**, non un buco: due note che
    // crollassero nello stesso punto sarebbero di nuovo invisibili, e stavolta perche' la
    // forza le ha portate li' invece di lasciare che si accostassero.
    expect(distance(bodies[0]!.position, bodies[1]!.position)).toBeGreaterThan(MIN_SEPARATION)
  })

  it('keeps working when a body is exactly at the centre, where the pull has no direction', () => {
    // Al centro il vettore e' nullo e la divisione drebbe zero: il corpo deve restare fermo
    // e non produrre un `NaN` che lo manderebbe fuori dalla scena per sempre.
    const bodies = [body({ x: 0, y: 0, z: 0 }), body({ x: 0.4, y: 0, z: 0 })]
    settle(bodies, 120)
    expect(Number.isFinite(bodies[0]!.position.x)).toBe(true)
    expect(distance(bodies[0]!.position, bodies[1]!.position)).toBeGreaterThan(0.5)
  })
})

describe('the numbers the map rests on', () => {
  it('contracts the layout faster than it moves the bodies, so the shape relaxes visibly', () => {
    /*
     * Se i due numeri fossero uguali la mappa si muoverebbe tutta insieme, come un blocco
     * che scorre, e non si vedrebbe il restringimento: si vedrebbe solo che le note si
     * spostano. Con la contrazione piu' lenta del moto, le note restano dove sono e il vuoto
     * fra loro si chiude — che e' cio' che l'occhio legge come «la mappa si raccoglie».
     */
    expect(GRAVITY_CONTRACT).toBeLessThan(GRAVITY_PULL)
    expect(DAMPING).toBeLessThan(1)
    expect(STILL_ENOUGH).toBeGreaterThan(0)
  })
})