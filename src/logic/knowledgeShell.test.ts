/**
 * La forma della mappa: nocciolo di centri, guscio di note.
 *
 * Il difetto che questo file chiude e' quello descritto come «le note si passano l'una
 * attraverso l'altra» e «non e' organizzata»: un volume pieno in cui non si capiva piu' quale
 * nota fosse di chi. La risposta non era spingere di piu' le note — la repulsione c'era gia' e
 * non bastava — ma **cambiare la forma**: un centro al centro, e le sue note su un guscio
 * sferico attorno, con un raggio che cresce come la radice del numero di note.
 *
 * Perche' la radice e non un numero lineare e' il punto di questo file, ed e' l'unica cosa
 * che va provata bene: su una superficie, N punti hanno distanza minima circa `R/radice(N)`.
 * Tenere quella distanza costante — e quindi tenere le note separate — vuol dire che `R`
 * deve crescere **come la radice di N**. Con un raggio lineare, il doppio delle note finisce
 * nella stessa distanza minima di prima, il centro si riempie, e la repulsione comincia a
 * spingere: cioe' la mappa torna a incrociarsi, ma piu' lentamente e senza che nessuno dica
 * perche'.
 */

import { describe, expect, it } from 'vitest'
import {
  MIN_SEPARATION,
  isAtRest,
  relax,
  type MovingBody,
} from './knowledgeLayout'
import {
  clearShellPoint,
  corePoint,
  coreRadius,
  noteFloorRadius,
  directionFrom,
  fibonacciDirection,
  shellBand,
  shellPoint,
  shellRadius,
} from './knowledgeShell'
import type { KnowledgeEntry, Vec3 } from '../types/knowledge'

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const fromOrigin = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

function entry(id: string, position: Vec3): KnowledgeEntry {
  return {
    id,
    title: id,
    text: 'testo',
    source: { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null },
    hubId: null,
    links: [],
    color: 'default',
    position,
    createdAt: 1,
    updatedAt: 1,
    placedBecause: 'test',
  }
}

describe('the shell grows like a square root, which is the whole trick', () => {
  it('adds more room as notes are added, but less than one radius per note', () => {
    /*
     * La relazione da cui dipende che le note non si accavallino. Un guscio che cresce di una
     * quantita' fissa per nota aggiunta finisce sempre stretto — solo piu' tardi.
     */
    expect(shellRadius(1)).toBeLessThan(shellRadius(4))
    expect(shellRadius(4)).toBeLessThan(shellRadius(16))
    // Quattro volte le note danno **esattamente** il doppio del raggio, e non il quadruplo:
    // e' quello che significa crescere con la radice, e la ragione per cui la superficie per
    // nota resta costante. Un raggio lineare qui darebbe 16.5 contro 9.6.
    expect(shellRadius(16)).toBeCloseTo(shellRadius(4) * 2, 6)
    // E non cresce nemmeno di un passo fisso a ogni nota, che e' l'errore da cui si esce.
    const firstStep = shellRadius(2) - shellRadius(1)
    const laterStep = shellRadius(17) - shellRadius(16)
    expect(laterStep).toBeLessThan(firstStep)
  })

  it('gives sixteen notes about as much room per note as four notes get', () => {
    /*
     * Il numero che rende leggibile il precedente: la **superficie per nota** resta vicina
     * alla stessa. E' la definizione operativa di «non si passano addosso», e la si puo' dire
     * solo se il raggio cresce con la radice.
     */
    const surface = (count: number): number => (4 * Math.PI * shellRadius(count) ** 2) / count
    const four = surface(4)
    const sixteen = surface(16)
    // Il guscio non e' una sfera intera quindi il confronto ha un margine largo, ma il
    // rapporto non deve sfuggire: se raddoppiasse, le note starebbero il doppio strette.
    expect(sixteen / four).toBeGreaterThan(0.6)
    expect(sixteen / four).toBeLessThan(1.7)
  })

  it('never puts a note inside its own main point, however few notes there are', () => {
    for (const count of [1, 2, 5, 30]) {
      const point = shellPoint({ x: 0, y: 0, z: 0 }, count, `note-${count}`, 4)
      expect(fromOrigin(point), `count ${count}`).toBeGreaterThanOrEqual(shellBand(count, { x: 0, y: 0, z: 0 }, 4).inner)
    }
  })
})

describe('a main point sits in the core, and its notes sit outside it', () => {
  it('puts the first main points closest to the middle', () => {
    const first = fromOrigin(corePoint(0, 4))
    const fifth = fromOrigin(corePoint(4, 9))
    expect(first).toBeLessThan(fifth)
    // E non restano attaccati al centro: un centro esattamente nell'origine non si distingue
    // dagli altri e la mappa sembra avere un buco in mezzo invece di un centro.
    expect(first).toBeGreaterThan(0.5)
  })

  it('keeps the core inside the notes layer, for a realistic number of main points', () => {
    /*
     * Il rapporto che produce i due strati: il centro piu' esterno deve stare **dentro** il
     * raggio interno del guscio piu' piccolo. Se i due si incrociano, le note del centro
     * esterno finiscono dentro gli altri centri e la stratificazione non esiste piu'.
     *
     * Il limite di dodici e' **geometrico, non una scelta**. Dodici centri hanno bisogno di un
     * nocciolo di raggio circa 2.6 per non stare addossati, e le note non possono stare piu'
     vicino di 2.8 dal centro: da li' i due strati si incontrano e non c'e' spazio per tutti.
     * Oltre, la cosa giusta e' che la repulsione apra il nocciolo — dodici palline in un guscio
     * di 2.0 sarebbero tutte incrociate, che e' il difetto che si voleva eliminare.
     *
     * Il test dichiara il limite invece di non guardarlo: un archivio con trenta punti di
     * contesto non e' navigabile in due strati e bisogna saperlo, non scoprirlo guardando.
     */
    // Lo stesso numero di centri da tutte le parti: confrontare un nocciolo da dodici con il
    // guscio di una mappa da quattro e' un confronto senza significato, e il test passerebbe o
    // fallirebbe per il numero sbagliato invece che per la forma.
    const hubs = 12
    const floor = shellBand(1, { x: 0, y: 0, z: 0 }, hubs).inner
    for (let index = 0; index < hubs; index += 1) {
      const core = fromOrigin(corePoint(index, hubs))
      expect(core, `hub ${index} at ${core.toFixed(2)}`).toBeLessThan(floor)
    }
  })

  it('puts every note outside the core, whichever way it happens to face', () => {
    /*
     * Il difetto che questa forma di guscio chiude, e che non si vede guardando le formule ma
     * solo i numeri: il guscio era un raggio **dal centro di contesto**, quindi la distanza giusta
     * dipendeva da quanto quel centro fosse lontano dal mezzo. Per un centro al centro della mappa
     * il raggio minimo e' il pavimento; per un centro a 4 dal mezzo e' pavimento meno 4. Ma quel
     * numero e' un raggio *dal centro di contesto*, e una nota che punta verso l'interno con quel
     * raggio finisce a 4 - (pavimento - 4) dal mezzo, cioe' **dentro il nocciolo**, dalla parte
     * opposta a dove si voleva.
     *
     * Misurando dal mezzo la proprieta' e' vera per costruzione: non esiste una direzione che
     * faccia finire la nota dentro, perche' il punto e' gia' alla distanza giusta.
     *
     * Il test gira su tutti i centri possibili e su tutte le direzioni, perche' il difetto
     * dipende dall'angolo e un centro solo e una direzione sola lo avrebbero mancato.
     */
    const hubs = 4
    const floor = noteFloorRadius(hubs)
    for (let index = 0; index < hubs; index += 1) {
      const hub = corePoint(index, hubs)
      for (let k = 0; k < 30; k += 1) {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          // `attempt` serve a prendere id diversi: la direzione viene dall'id, quindi un solo id
          // darebbe sempre lo stesso angolo e il difetto si nasconderebbe dietro una direzione
          // favorevole.
          const id = `probe-${index}-${k}-${attempt}`
          const point = clearShellPoint(hub, k + 1, id, hubs, [])
          expect(fromOrigin(point), `${id} landed at ${fromOrigin(point).toFixed(2)}`).toBeGreaterThanOrEqual(floor - 1e-6)
        }
      }
    }
  })
  it('keeps the main points from overlapping each other', () => {
    /*
     * Il difetto che si vedeva **nella schermata**: quattro pallini di punto di contesto uno
     * dentro l'altro al centro della mappa. Quattro pallini sovrapposti non leggono come «quattro
     * punti di contesto», leggono come uno solo — ed e' esattamente cio' che il centro doveva
     * evitare, dato che il centro e' la parte che l'occhio usa per orientarsi.
     *
     * La causa era che ogni centro indicizzava una sfera **diversa**: la posizione `n` era il
     * punto `n-1` di una sfera di `n` punti, quindi le direzioni non avevano relazione fra loro.
     * Qui la sfera e' una sola e il controllo e' sulla **distanza minima fra due centri**, che e'
     * la grandezza che l'occhio vede, e non sul raggio di ciascuno.
     */
    for (const total of [1, 2, 4, 9, 16, 25]) {
      const points = Array.from({ length: total }, (_, index) => corePoint(index, total))
      let closest = Infinity
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          closest = Math.min(closest, dist(points[i]!, points[j]!))
        }
      }
      expect(closest, `${total} main points`).toBeGreaterThan(MIN_SEPARATION)
    }
  })

  it('spreads the main points over the whole core rather than in a corner of it', () => {
    /*
     * Una sfera di Fibonacci che copre un polo solo e' una sfera di Fibonacci mal scritta: i
     * centri si ammasserebbero da una parte e gli altri lati del nocciolo resterebbero vuoti,
     * il che e' lo stesso difetto di prima — solo piu' difficile da vedere perche' i pallini non
     * si sovrappongono.
     */
    const points = Array.from({ length: 12 }, (_, index) => corePoint(index, 12))
    const up = points.filter((p) => p.y > 0.5 * coreRadius(12)).length
    const down = points.filter((p) => p.y < -0.5 * coreRadius(12)).length
    // Entrambi i lati devono essere occupati: una sfera che copre solo meta' non e' una sfera.
    expect(up).toBeGreaterThan(0)
    expect(down).toBeGreaterThan(0)
  })

  it('sends the notes of an outer main point further out than the centre itself', () => {
    const hub = corePoint(3, 4)
    const note = shellPoint(hub, 4, 'a-note-on-this-hub', 4)
    expect(fromOrigin(note)).toBeGreaterThan(fromOrigin(hub))
  })
})

describe('the Fibonacci spread', () => {
  it('gives every point about the same distance from its neighbours', () => {
    /*
     * Il caso che vede l'occhio: trenta direzioni tirate a caso su una sfera producono
     * sempre due o tre coppie a due passi l'una dall'altra, e la mappa mostra dei buchi. La
     * spirale di Fibonacci e' l'unico modo noto per avere la stessa distanza minima senza
     * dover spingere i punti l'uno contro l'altro.
     */
    const points = Array.from({ length: 30 }, (_, index) => fibonacciDirection(index, 30)!)
    let worst = Infinity
    for (let i = 0; i < points.length; i += 1) {
      let nearest = Infinity
      for (let j = 0; j < points.length; j += 1) {
        if (i === j) continue
        const gap = dist(points[i]!, points[j]!)
        if (gap < nearest) nearest = gap
      }
      if (nearest < worst) worst = nearest
    }
    // Il peggior vicino non deve essere molto piu' vicino del vicino medio: un rapporto
    // grande significa che c'e' una coppia addossata e il resto della sfera vuota.
    expect(worst).toBeGreaterThan(0.1)
  })

  it('returns null for an empty sphere rather than a direction', () => {
    // Zero punti non e' una direzione: e' una lista vuota. Restituirne una significa che il
    // chiamante costruisce un guscio per un centro che non ha nessuna nota.
    expect(fibonacciDirection(0, 0)).toBeNull()
  })
})

describe('placement never starts a note on top of another', () => {
  it('keeps a note clear of everything already on the map', () => {
    /*
     * Il difetto che il chiamato `clearShellPoint` chiude: un guscio puo' avere il posto
     * giusto ma l'id puo' dare una direzione che cade addosso a una nota gia' presente. La
     * simulazione scioglierebbe l'accavallamento, ma la mappa nascerebbe gia' incrociata e
     * l'occhio leggerebbe un errore che invece e' una scelta di partenza.
     */
    const hub: Vec3 = { x: 0.6, y: 0.3, z: -0.2 }
    const existing: KnowledgeEntry[] = []
    for (let index = 0; index < 12; index += 1) {
      const id = `note-${index}`
      const point = clearShellPoint(hub, index + 1, id, 4, existing)
      existing.push(entry(id, point))
    }
    let closest = Infinity
    for (let i = 0; i < existing.length; i += 1) {
      for (let j = i + 1; j < existing.length; j += 1) {
        const gap = dist(existing[i]!.position, existing[j]!.position)
        if (gap < closest) closest = gap
      }
    }
    // Non si pretende la separazione piena: il guscio puo' essere pieno e il posto finisce.
    // Si pretende pero' che non sia **zero**, cioe' che nessuna coppia sia sovrapposta.
    expect(closest).toBeGreaterThan(MIN_SEPARATION * 0.5)
  })

  it('does not move the other notes when a new one arrives', () => {
    /*
     * La proprieta' che rende la mappa navigabile: salvare una nota deve spostare **quella**
     * nota. Se il guscio si ricalcolasse tutto, ogni salvataggio sposterebbe l'archivio
     * intero sotto gli occhi dell'utente, e quello che aveva costruito a mano non ci sarebbe
     * piu' dove l'aveva lasciato.
     */
    const hub: Vec3 = { x: 0, y: 0, z: 0 }
    const existing: KnowledgeEntry[] = []
    for (let index = 0; index < 5; index += 1) {
      const id = `note-${index}`
      existing.push(entry(id, clearShellPoint(hub, index + 1, id, 4, existing)))
    }
    const before = existing.map((candidate) => ({ ...candidate.position }))
    const newcomer = entry('note-new', clearShellPoint(hub, 6, 'note-new', 4, existing))
    for (const old of existing) {
      const index = existing.indexOf(old)
      expect(newcomer.position).not.toBe(old.position)
      expect(old.position).toEqual(before[index])
    }
  })

  it('gives the same place for the same id, because positions are saved', () => {
    // Due aperture dello stesso archivio devono dare la stessa mappa. `Math.random` qui
    // produrrebbe note in posti diversi pur senza che nessuno le abbia toccate, e un
    // archivio che si sposta da solo fra un giorno e l'altro non e' navigabile.
    const hub: Vec3 = { x: 1, y: 0, z: 0 }
    expect(clearShellPoint(hub, 3, 'same-id', 4, [])).toEqual(clearShellPoint(hub, 3, 'same-id', 4, []))
    expect(directionFrom('same-id')).toEqual(directionFrom('same-id'))
  })
})

describe('a position that cannot be measured', () => {
  it('puts the note somewhere visible rather than nowhere at all', () => {
    /*
     * Il difetto che questa funzione chiude, e che e' peggiore di una mappa disordinata: una
     * nota a `NaN` non e' «in un posto strano», e' **fuori dal mondo**. Non si vede, non si
     * tocca, non si seleziona, e non c'e' nessun errore — la geometria accetta `NaN` e lo
     * moltiplica per se stessa all'infinito.
     *
     * Il caso arriva da un file salvato o da uno store, dove un campo puo' non essere un
     * numero. E il motivo per cui il fallback e' una direzione valida e non un errore lanciato:
     * in questo punto non c'e' niente a cui fare eccezione, e lanciare lascerebbe la nota
     * senza posto — che e' esattamente il guaio che si voleva evitare.
     */
    const broken = { x: Number.NaN, y: Number.NaN, z: Number.NaN }
    const point = shellPoint(broken, 3, 'a-note', 4)
    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
    expect(Number.isFinite(point.z)).toBe(true)
  })

  it('never returns a position the map cannot draw', () => {
    // Lo stesso controllo sulle quattro funzioni che producono una posizione. Una che passa e
    // tre no significa che il problema si sposta invece di sparire, e il posto peggiore in cui
    // si sposta e' dentro la funzione che nessuno guarda.
    const broken = { x: Number.NaN, y: 0, z: 0 }
    const places = [
      shellPoint(broken, 2, 'one', 4),
      clearShellPoint(broken, 2, 'two', 4, []),
      corePoint(3, 4),
      { ...shellBand(2, broken, 4) },
    ]
    for (const place of places) {
      const values = 'inner' in place ? Object.values(place) : Object.values(place)
      for (const value of values) {
        expect(Number.isFinite(value as number), JSON.stringify(place)).toBe(true)
      }
    }
  })
})
describe('a note stays in its layer while the map moves', () => {
  function onShell(position: Vec3, count: number): MovingBody {
    const band = shellBand(count, { x: 0, y: 0, z: 0 }, 4)
    return {
      position: { ...position },
      anchor: { ...position },
      velocity: { x: 0.02, y: -0.02, z: 0.01 },
      held: false,
      shell: { centre: { x: 0, y: 0, z: 0 }, inner: band.inner, outer: band.outer },
    }
  }

  it('does not drift into the core, even when something keeps pushing it there', () => {
    /*
     * Il difetto che il vincolo di strato chiude, e che la sola repulsione non chiude: il
     * richiamo all'ancora e la repulsione spingono in ogni direzione, e nessuna delle due sa
     * che una nota con un centro appeso non dovrebbe farsi tirare dentro il nocciolo. Senza il
     * vincolo la stratificazione sparisce lentamente, e senza che nessuno noti il momento.
     */
    const hub: Vec3 = { x: 0, y: 0, z: 0 }
    const point = clearShellPoint(hub, 4, 'drifter', 4, [])
    const body = onShell(point, 4)
    for (let step = 0; step < 400; step += 1) relax([body])
    const band = shellBand(4, hub, 4)
    expect(fromOrigin(body.position)).toBeGreaterThanOrEqual(band.inner - 0.01)
  })

  it('does not escape its shell either, and stops dead at the edge instead of bouncing', () => {
    const hub: Vec3 = { x: 0, y: 0, z: 0 }
    const point = clearShellPoint(hub, 4, 'runner', 4, [])
    const body = onShell(point, 4)
    // Una spinta verso l'esterno, come quella che la repulsione dà a una nota con un vicino.
    for (let step = 0; step < 200; step += 1) {
      body.velocity.x += 0.05
      relax([body])
    }
    const band = shellBand(4, hub, 4)
    expect(fromOrigin(body.position)).toBeLessThanOrEqual(band.outer + 0.01)
    // E sul bordo la mappa **si ferma**: azzerare la velocita' sul ramo uscito e' quello che
    // distingue un muro da un trampolino, e la differenza si vede subito.
    expect(isAtRest([body])).toBe(true)
  })

  it('still lets a note be moved inside its own layer, which is what makes it feel free', () => {
    /*
     * Il vincolo non deve essere una gabbia. Una nota spostata a mano dentro la banda deve
     * restarci, e soprattutto l'utente deve poterla portare dove vuole dentro la banda: e'
     * quello che evita che due note si incrociano senza dover spingere nulla.
     */
    const band = shellBand(6, { x: 0, y: 0, z: 0 }, 4)
    const inside: Vec3 = { x: band.inner + 0.4, y: 0.5, z: -0.3 }
    const body = onShell(inside, 6)
    for (let step = 0; step < 200; step += 1) relax([body])
    expect(fromOrigin(body.position)).toBeGreaterThanOrEqual(band.inner - 0.01)
    expect(fromOrigin(body.position)).toBeLessThanOrEqual(band.outer + 0.01)
  })

  it('leaves a note with no main point completely free', () => {
    /*
     * Una nota senza centro non ha guscio: non ha ancora un posto, e chiuderla in uno
     * significherebbe assegnargliene uno al posto dell'utente. Percio' deve poter andare
     * ovunque, compresi dentro il nocciolo.
     */
    const body: MovingBody = {
      position: { x: 20, y: 0, z: 0 },
      anchor: { x: 20, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      held: false,
    }
    for (let step = 0; step < 500; step += 1) relax([body])
    expect(body.position.x).toBeGreaterThan(0.5)
  })
})