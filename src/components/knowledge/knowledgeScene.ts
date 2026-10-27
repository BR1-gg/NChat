import * as THREE from 'three'
import { linkPairs } from '../../logic/knowledge'
import { isAtRest, relax, type MovingBody, type Shell } from '../../logic/knowledgeLayout'
import { shellBand } from '../../logic/knowledgeShell'
import { shadeFor } from '../../logic/knowledgeColour'
import type { KnowledgeEntry, KnowledgeHub, KnowledgeId, Vec3 } from '../../types/knowledge'

/**
 * La mappa in 3D, disegnata da tre.
 *
 * E' **imperativa** e isolata in questo file su due motivi, e non per preferenza di stile.
 *
 * Il primo e' che il motore e' di tre e non di React: si crea un `WebGLRenderer`, si tiene
 * un ciclo di disegno e si agisce sugli oggetti della scena. Se fosse dentro un componente
 * con stato, ogni cambiamento di una nota farebbe ricostruire l'albero dei nodi 3D — che e'
 * costoso, e qui non serve: la scena non cambia nella forma, cambiano i pezzi che la
 * compongono.
 *
 * Il secondo e' che il ciclo di disegno va **ferrato** quando la finestra non si vede.
 * Un `requestAnimationFrame` che gira su una scheda in secondo piano costa batteria e
 * scalda il portatile per un'immagine che nessuno sta guardando — ed e' il motivo per cui
 * una pagina 3D in una tab non aperta e' il modo piu' rapido per far durare poco un portatile.
 */

/** How far the camera starts when there is nothing to frame yet. */
const START_DISTANCE = 18

/**
 * How close and how far the camera may ever get.
 *
 * Il limite ravvicinato serve perche' a zero distanza si entra dentro una palla e lo schermo
 * diventa un colore pieno; quello lontano perche' oltre un certo punto non si distingue piu'
 * niente e il ridisegnare un archivio intero a ogni fotogramma e' buttato. Il massimo e'
 * anche quello che decide quanto costa: i fili si ricalcolano a ogni passo, e con un archivio
 * grande e una camera troppo lontana sono milioni di operazioni per un'immagine vuota.
 */
const MIN_CAMERA_DISTANCE = 2.5
const MAX_CAMERA_DISTANCE = 120

/** How big a body is, so the camera frames the spheres and not just their centres. */
const BODY_RADIUS = 0.9

/**
 * How long the map may keep moving before it is written back to disk.
 *
 * Il numero e' voluto grande. La mappa si assesta in un secondo o due e poi sta ferma, e
 * finche' si muove quella disposizione non e' ancora quella che l'utente sta guardando: e'
 * quello il momento in cui vale la pena scriverla. Ogni secondo prima si rischierebbe di
 * registrare una mappa che e' ancora in mezzo al rimescolamento.
 */
const SAVE_EVERY_MS = 1200

/** What the user is pointing at. Either a note or a main point. */
export interface SceneSelection {
  kind: 'note' | 'hub'
  id: KnowledgeId
}

export interface KnowledgeSceneOptions {
  /** Called when a note or a main point is clicked. */
  onPick: (selection: SceneSelection) => void
  /** Called when the background is clicked, to clear the selection. */
  onClear: () => void
  /**
   * Called when two things are tied together from the map itself.
   *
   * `from` is what was picked first and `to` is what was picked with the link tool on.
   * The scene does not write anything: it says what the user did, and the store decides
   * whether that is a link that should exist. Keeping the decision outside is what stops
   * a stray click on the canvas from putting a line between two notes.
   */
  onLink: (from: SceneSelection, to: SceneSelection) => void
  /**
   * Where the notes ended up, so the arrangement survives a reload.
   *
   * Called sparingly, not every frame: la mappa si muove per un secondo o due e poi si
   * ferma, e scrivere a ogni fotogramma costerebbe una scrittura per nota per sessanta
   * fotogrammi al secondo su un archivio che in quel momento e' fermo da decenni.
   */
  /*
   * I due insiemi sono separati perche' sono **due cose diverse da scrivere**: le note
   * stanno in una tabella e i centri in un'altra, e una posizione finita nel posto sbagliato
   * non si corregge — alla riapertura la mappa mostrerebbe un centro dove non c'e' e non si
   * saprebbe quale dei due sia stato spostato.
   */
  onSettle: (positions: { notes: Map<KnowledgeId, Vec3>; hubs: Map<KnowledgeId, Vec3> }) => void
}

interface Body {
  entry?: KnowledgeEntry
  hub?: KnowledgeHub
  group: THREE.Group
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  /** Extra materials this body owns beyond `material`, e.g. a hub's wireframe. */
  extras: THREE.Material[]
  glow: THREE.Sprite
  glowMaterial: THREE.SpriteMaterial
  label: THREE.Sprite | null
  labelMaterial: THREE.SpriteMaterial | null
  /**
   * Il moto di questo corpo, **calcolato fuori**.
   *
   * Vive in un oggetto a parte e non direttamente sui `Vector3` di `three` perche' la
   * simulazione e' in `logic/knowledgeLayout.ts`, dove e' pura e quindi verificabile con un
   * test. Qui dentro ci sono solo i pezzi che `three` deve disegnare; il moto si calcola
   * altrove e alla fine del passo si copia dentro.
   */
  motion: MovingBody
}

interface Thread {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  from: Body
  to: Body
}

/** The one colour the user chose: every main point, and every note hung on one. */
const MAIN_COLOUR = 0xf3ede0

/** The colour of a tie between two notes, as opposed to the faint threads to a main point. */
const NOTE_LINK_COLOUR = 0x8fd0ff

/**
 * Builds the scene and owns its lifetime.
 *
 * Ogni cosa che va creata una volta sola — il renderer, la scena, la camera, il ciclo —
 * sta qui e viene liberata da `dispose`. E' l'unico modo che funziona: una `WebGLRenderer`
 * non registrata per essere liberata tiene il contesto vivo per tutta la sessione, e aprendo
 * e chiudendo la pagina piu' volte si esaurisce il numero di contesti WebGL che il browser
 * concede — a quel punto la mappa smette di disegnarsi e il difetto sembra del computer.
 */
export function createKnowledgeScene(
  canvas: HTMLCanvasElement,
  options: KnowledgeSceneOptions,
): {
  setEntries: (entries: readonly KnowledgeEntry[], hubs: readonly KnowledgeHub[]) => void
  setSelected: (selection: SceneSelection | null) => void
  /** Turns the link tool on and off. While on, two clicks tie two things together. */
  setLinking: (linking: boolean) => void
  /**
   * Puts every body in view, at the distance that fits them all.
   *
   * Esposta perche' il tasto che la chiama e' quello di Blender, e una mappa che si comporta
   * come un'altra applicazione deve avere anche i tasti: si impara una volta sola.
   */
  frameAll: () => void
  /**
   * The camera keys, handled here because the canvas owns the camera.
   *
   * Restituisce `true` quando il tasto e' stato usato, e `false` quando non e' un tasto
   * della camera: cosi' il chiamante puo' lasciare agli altri gli altri tasti senza dover
   * conoscere la lista, che cresce a ogni tasto nuovo e resterebbe scollegata.
   */
  handleKey: (event: KeyboardEvent) => boolean
  /**
   * Counts `selection` as the **first** half of a tie, already chosen.
   *
   * Serve quando il primo tocco e' stato gia' fatto altrove — il pulsante «Link to…» sul
   * dettaglio della nota sceglie la prima meta' senza toccare la mappa. Senza, l'utente
   * accenderebbe lo strumento e dovrebbe riclickare la nota che aveva appena scelto, e il
   * primo dei due clic si consumerebbe come se fosse il primo: il legame non partirebbe
   * mai e sembrerebbe che il pulsante non funzioni.
   */
  beginLink: (selection: SceneSelection) => void
  focus: (id: KnowledgeId) => void
  resetView: () => void
  dispose: () => void
} {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  // Fondo appena diverso dalla superficie: se fosse nero pieno su un tema chiaro, la
  // finestra diventerebbe un buco scuro nel mezzo dell'applicazione, e su un tema scuro
  // non si distinguerebbe dalla tela.
  scene.background = new THREE.Color(0x14120f)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000)

  // La camera guarda da un angolo alto di lato, non di fronte: vista di fronte la mappa
  // sembrerebbe un muro di palline, e non si capirebbe che c'e' profondita'. L'angolo e' di
  // poco piu' di un terzo di giro, che mostra i tre assi insieme.
  const cameraTarget = new THREE.Vector3(0, 0, 0)
  const orbit = { theta: 0.7, phi: 1.05, distance: START_DISTANCE }

  const root = new THREE.Group()
  scene.add(root)

  /*
   * Il pallino di ogni nota.
   *
   * Una `SphereGeometry` con 12 segmenti per lato: e' rotonda abbastanza da non sembrare
   * un quadrato, e abbastanza leggera da poterne disegnare centinaia. Con 32 segmenti il
   * costo raddoppia e a questa distanza non si vede la differenza.
   */
  const sphereGeometry = new THREE.SphereGeometry(0.42, 12, 8)

  /*
   * Il centro di contesto e' un guscio, non una pallina.
   *
   * Un guscio dice due cose che una pallina non dice: e' **vuoto dentro** — quindi le note
   * non ci stanno dentro di lui, ci stanno intorno — e si vede da che parte e' guardato.
   * Un centro e' un posto dove appendere, e la forma che dice «appendere qui» e' quella
   * che ha il buco in mezzo.
   */
  const hubGeometry = new THREE.IcosahedronGeometry(0.85, 1)

  /*
   * I fili sono cilindri e non linee.
   *
   * `LineBasicMaterial` non ha spessore: `linewidth` viene ignorato da quasi tutti i
   * browser e il filo esce di un pixel, che a questa scala sparisce e sembra un errore di
   * disegno. Un cilindro sottile ha spessore vero e puo' essere colorato per stato, e il
   * costo e' lo stesso perche' la geometria e' condivisa e si cambia solo la scala.
   */
  const threadGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 6, 1, true)

  /** The halo texture, drawn once and shared by every glow. */
  const glowTexture = makeGlowTexture()

  const notes = new Map<KnowledgeId, Body>()
  const hubs = new Map<KnowledgeId, Body>()
  const threads = new Map<string, Thread>()
  let selected: SceneSelection | null = null
  /** Where the camera is heading, so it can glide instead of jumping. */
  const wanted = { theta: orbit.theta, phi: orbit.phi, distance: orbit.distance }
  const wantedTarget = new THREE.Vector3(0, 0, 0)
  let spinning = true
  let frame = 0

  /** The link tool, and the first half of the tie it is making. */
  let linking = false
  let linkFrom: SceneSelection | null = null

  /** Last written positions, so nothing is written twice. */
  const written = new Map<KnowledgeId, Vec3>()
  let sinceSave = 0

  /*
   * Il colore di una nota, e in questo archivio il colore ha **due** significati, non uno.
   *
   * Da quanto e' nell'archivio dice qualcosa che la posizione non dice gia'. Ma appena una
   * nota e' appesa a un centro, il colore passa a dire la parentela **scelta dall'utente**,
   * perche' quella e' l'unica parentela che non si puo' dedurre da un confronto di parole:
   * «di cosa parla questo insieme» e' una domanda sul come si vuole raggruppare.
   *
   * Il tempo resta, come alone: il alone e' il colore della data dentro quello del centro,
   * cosi' il raggruppamento si legge dal corpo e la data si legge dal bordo, e due note
   * vicine nel tempo non sembrano nate insieme perche' lo sono state salvate.
   */
  /**
   * The shade a note is drawn in: **quello che l'utente ha scelto**, e nient'altro.
   *
   * Prima il colore diceva quanto era vecchia la nota, con quattro sfumature di eta'. Adesso
   * non e' piu' cosi', e la ragione sta nel fatto che l'utente puo' scegliere: se il colore
   * segnalasse l'eta', scegliere un colore non cambierebbe niente e sembrerebbe funzionare
   * mentre non serve a nulla. Meglio una tinta neutra che vuol dire «nessuna scelta» che una
   * scelta finta.
   *
   * Il centro di contesto non ha una tinta tutta sua: e' un punto a cui si appende, e
   * renderlo di un colore diverso da quello delle note che ci pendono farebbe pensare che
   * sia una nota fra le altre.
   */
  function colourFor(entry: KnowledgeEntry, hubbed: boolean): number {
    return hubbed ? MAIN_COLOUR : shadeFor(entry.color, MAIN_COLOUR)
  }

  function makeGlowTexture(): THREE.CanvasTexture {
    const size = 128
    const off = document.createElement('canvas')
    off.width = size
    off.height = size
    const ctx = off.getContext('2d')
    if (ctx) {
      // Un alone piatto e pieno avrebbe un bordo netto — un disco, non una luce. Il
      // gradiente radiale che arriva a zero e' quello che fa leggere il bordo come aria:
      // la piena luminosita' resta al centro e sfuma, quindi la pallina sembra accesa
      // invece che circondata da un cerchio.
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
      gradient.addColorStop(0.28, 'rgba(255,255,255,0.42)')
      gradient.addColorStop(0.62, 'rgba(255,255,255,0.12)')
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, size, size)
    }
    const texture = new THREE.CanvasTexture(off)
    texture.needsUpdate = true
    return texture
  }

  function makeLabelTexture(text: string, wide: boolean): THREE.CanvasTexture | null {
    const width = wide ? 320 : 256
    const height = 48
    const off = document.createElement('canvas')
    const ctx = off.getContext('2d')
    if (!ctx) {
      // Senza un contesto 2D non c'e' niente su cui scrivere. Si rinuncia all'etichetta e
      // si lascia il corpo com'e': e' comunque la' da cliccare, e un riquadro vuoto al
      // posto di un nome sarebbe peggio di nessun nome.
      return null
    }
    off.width = width
    off.height = height
    ctx.clearRect(0, 0, width, height)
    ctx.font = wide ? '700 24px system-ui, sans-serif' : '600 22px system-ui, sans-serif'
    ctx.fillStyle = wide ? '#fbf6ec' : '#efe9e1'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const clean = text.trim().replace(/\s+/g, ' ')
    const max = Math.floor((width - 24) / (wide ? 13 : 11))
    ctx.fillText(clean.length > max ? `${clean.slice(0, max - 1)}…` : clean, width / 2, height / 2)
    const texture = new THREE.CanvasTexture(off)
    texture.needsUpdate = true
    return texture
  }

  function makeBody(
    position: Vec3,
    colour: number,
    labelText: string,
    isHub: boolean,
    /*
     * The layer this body must stay in, when it has one.
     *
     * Passato dentro il corpo e non impostato dopo, perche' il primo fotogramma deve partire
     * gia' col vincolo. Se il guscio arrivasse un passo dopo, la nota ci correrebbe dentro e
     * verrebbe spinta fuori al fotogramma successivo: uno scatto che nessuna delle altre
     * condizioni della simulazione produce, e che si vede come un lampo.
     */
    shell?: Shell,
  ): Body {
    const group = new THREE.Group()
    group.position.set(position.x, position.y, position.z)
    const material = new THREE.MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: isHub ? 0.16 : 0.94,
    })
    const mesh = new THREE.Mesh(isHub ? hubGeometry : sphereGeometry, material)
    const extras: THREE.Material[] = []

    if (isHub) {
      // Il guscio si vede come una **rete**: chiuso sembrerebbe una palla, e una pappa
      // piena dentro non si lascia guardare dentro. La rete si vede attraverso e si vede
      // anche da dietro, che e' quello che fa capire che e' un involucro e non una sfera.
      const wire = new THREE.LineBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.8,
      })
      extras.push(wire)
      group.add(new THREE.LineSegments(new THREE.WireframeGeometry(hubGeometry), wire))
    }

    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: colour,
      transparent: true,
      opacity: isHub ? 0.45 : 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const glow = new THREE.Sprite(glowMaterial)
    glow.scale.setScalar(isHub ? 5.2 : 2.6)
    group.add(glow)

    let label: THREE.Sprite | null = null
    let labelMaterial: THREE.SpriteMaterial | null = null
    const texture = makeLabelTexture(labelText, isHub)
    if (texture) {
      labelMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
      label = new THREE.Sprite(labelMaterial)
      label.scale.set(isHub ? 6.2 : 4.6, 0.86, 1)
      label.position.set(0, isHub ? 1.6 : 1.05, 0)
      group.add(label)
    }

    group.add(mesh)
    root.add(group)
    /*
     * Il moto parte gia' col vincolo di strato dentro, non con uno da mettere dopo.
     *
     * Perche' la banda dipende dal numero di note del centro, e quel numero cambia quando se ne
     * salva una: chi la imposta e' setEntries, che puo' farlo una volta sola per corpo, e non
     * nel ciclo di ogni fotogramma.
     */
    const motion: MovingBody = {
      position: { x: position.x, y: position.y, z: position.z },
      anchor: { x: position.x, y: position.y, z: position.z },
      velocity: { x: 0, y: 0, z: 0 },
      held: false,
      ...(shell ? { shell } : {}),
    }

    const body: Body = {
      group,
      mesh,
      material,
      extras,
      glow,
      glowMaterial,
      label,
      labelMaterial,
      motion,
    }
    return body
  }

  function relabel(body: Body, text: string, isHub: boolean): void {
    if (!body.labelMaterial) return
    const texture = makeLabelTexture(text, isHub)
    body.labelMaterial.map?.dispose()
    // Se la texture non c'e', l'etichetta resta com'era con la mappa vecchia: il nome
    // precedente e' comunque piu' utile di nessuno, e sostituirla con un riquadro vuoto
    // sarebbe un peggioramento che l'utente non ha chiesto.
    if (!texture) return
    body.labelMaterial.map = texture
    body.labelMaterial.needsUpdate = true
  }

  function disposeBody(body: Body): void {
    root.remove(body.group)
    body.material.dispose()
    for (const extra of body.extras) extra.dispose()
    body.glowMaterial.dispose()
    body.labelMaterial?.map?.dispose()
    body.labelMaterial?.dispose()
  }

  function allBodies(): Body[] {
    return [...notes.values(), ...hubs.values()]
  }

  function bodyOf(selection: SceneSelection | null): Body | null {
    if (!selection) return null
    return (selection.kind === 'hub' ? hubs : notes).get(selection.id) ?? null
  }

  function selectionFor(body: Body): SceneSelection {
    return body.hub ? { kind: 'hub', id: body.hub.id } : { kind: 'note', id: body.entry!.id }
  }

  function syncSelectionVisuals(): void {
    const crowd = allBodies().length <= 40
    for (const [id, note] of notes) {
      const isSelected = selected?.kind === 'note' && selected.id === id
      const colour = colourFor(note.entry!, Boolean(note.entry?.hubId))
      const opacity = isSelected ? 1 : 0.94
      /*
       * Il materiale si rifa **solo quando cambiano colore o opacita'**.
       *
       * Questa funzione gira a ogni cambio dell'archivio, e l'archivio cambia ogni volta
       * che la mappa si sistema — cioe' piu' volte al secondo per qualche istante. Rifare
       * un `MeshBasicMaterial` per ogni nota a ogni passaggio non costa quasi niente finche'
       * le note sono poche, e con mille note significa mille materiali da registrare e poi
       * liberare ogni volta che una palla si assesta di un millimetro: il costo invisibile
       * di una mappa che sembra ferma.
       */
      if (note.material.color.getHex() !== colour || note.material.opacity !== opacity) {
        note.material.dispose()
        note.material = new THREE.MeshBasicMaterial({
          color: colour,
          transparent: true,
          opacity,
        })
        note.mesh.material = note.material
      }
      if (note.glowMaterial.color.getHex() !== colour) note.glowMaterial.color.setHex(colour)
      note.mesh.scale.setScalar(isSelected ? 1.5 : 1)
      // Il alone cresce con la nota scelta: e' il modo piu' economico di dire «questa e'
      // quella che hai toccato» senza dover rifare un materiale separato.
      note.glow.scale.setScalar(isSelected ? 4.4 : 2.6)
      note.glowMaterial.opacity = isSelected ? 0.8 : 0.42
      if (note.label) {
        const hubbed = note.entry?.hubId
        const hubSelected = Boolean(hubbed) && selected?.kind === 'hub' && selected.id === hubbed
        note.label.visible = isSelected || hubSelected || crowd
      }
    }
    for (const [id, hub] of hubs) {
      const isSelected = selected?.kind === 'hub' && selected.id === id
      hub.glow.scale.setScalar(isSelected ? 8.4 : 5.2)
      hub.glowMaterial.opacity = isSelected ? 0.85 : 0.45
      if (hub.label) hub.label.visible = isSelected || hubs.size <= 12
    }
  }

  function setEntries(entries: readonly KnowledgeEntry[], hubList: readonly KnowledgeHub[]): void {
    const wantedIds = new Set(entries.map((entry) => entry.id))
    for (const [id, note] of notes) {
      if (wantedIds.has(id)) continue
      disposeBody(note)
      written.delete(id)
      notes.delete(id)
    }
    const wantedHubIds = new Set(hubList.map((hub) => hub.id))
    for (const [id, hub] of hubs) {
      if (wantedHubIds.has(id)) continue
      disposeBody(hub)
      hubs.delete(id)
    }

    for (const hub of hubList) {
      const existing = hubs.get(hub.id)
      if (existing) {
        existing.hub = hub
        /*
         * Un centro mosso a mano non viene richiamato indietro, per lo stesso motivo delle
         * note: il richiamo serve a sciogliere gli accavallamenti, non a cancellare una
         * scelta.
         *
         * La posizione del gruppo viene seguita anche perche' e' il posto a cui le note
         * appese torneranno: senza, un centro spostato avrebbe le note ancora dove erano e
         * i fili che non arrivano piu' al centro — la mappa direbbe che sono sue mentre la
         * posizione direbbe il contrario, e il segnale che si vede di piu' e' quello falso.
         */
        if (!existing.motion.held) {
          anchorAt(existing, hub.position)
          place(existing, hub.position)
        }
        relabel(existing, hub.title, true)
        continue
      }
      const body = makeBody(hub.position, MAIN_COLOUR, hub.title, true)
      body.hub = hub
      hubs.set(hub.id, body)
    }

    for (const entry of entries) {
      const existing = notes.get(entry.id)
      if (existing) {
        /*
         * Il testo non e' cambiato ma la posizione puo' esserlo, perche' il testo e'
         * quello su cui la somiglianza e' stata calcolata e un rinominamento la cambia.
         *
         * L'ancora viene seguita solo finche' la nota non e' stata presa a mano. Senza
         * questa distinzione, la mappa continuerebbe a tirare indietro una nota che
         * l'utente ha appena posizionato lui, e il gesto che sistema la mappa sarebbe
         * quello che la rimette com'era.
         */
        existing.entry = entry
        if (!existing.motion.held) {
          anchorAt(existing, entry.position)
          place(existing, entry.position)
        }
        relabel(existing, entry.title, false)
        continue
      }
      /*
       * La banda della nota viene dal **suo** centro, e dipende da quante note ci sono
       * gia' su quel centro: e' il numero che decide se il guscio e' stretto o largo.
       *
       * Il conteggio passa per entries e non per i corpi gia' costruiti perche' una
       * nota puo' essere senza centro, e quelle non hanno banda.
       *
       * Una nota senza centro e' l'unica che puo' attraversare il nocciolo, ed e' giusto:
       * e' una nota che non ha ancora un posto, e chiuderla in un guscio le assegnerebbe
       * un posto al posto dell'utente.
       */
      const home = entry.hubId
        ? hubList.find((candidate) => candidate.id === entry.hubId)
        : undefined
      const siblings = home
        ? entries.filter((c) => c.hubId === home.id && c.id !== entry.id).length + 1
        : 0
      const band = home ? shellBand(siblings, home.position, hubList.length) : null
      /*
       * Il centro della banda e' il **mezzo della mappa**, non il centro di contesto.
       *
       * Non e' una semplificazione: e' cio' che rende vera la divisione in due strati. La banda e'
       * una distanza dal centro della mappa, quindi il vincolo che ne deriva e' «questa nota non
       * entra nel nocciolo» — che e' esattamente la promessa. Se il centro della banda fosse il
       * centro di contesto, il vincolo direbbe «questa nota non si avvicina al suo centro», che
       * e' un'altra cosa, e lascerebbe passare tutte le note verso il mezzo della mappa: la mappa
       * si riempirebbe al centro di note che dovrebbero stare fuori, e nessuno saprebbe spiegare
       * perche' lo strato non si vede piu'.
       */
      const shell: Shell | undefined =
        home && band
          ? { centre: { x: 0, y: 0, z: 0 }, inner: band.inner, outer: band.outer }
          : undefined
      const body = makeBody(
        entry.position,
        colourFor(entry, Boolean(entry.hubId)),
        entry.title,
        false,
        shell,
      )
      body.entry = entry
      notes.set(entry.id, body)
    }

    syncThreads(entries)
    syncSelectionVisuals()
  }

  /**
   * Rebuilds the threads: one per note-to-note tie, one per note-to-hub tie.
   *
   * Il filo verso il centro e' quello che rende la mappa leggibile come **organizzazione**:
   * senza, le note resterebbero una nuvola con qualche zona piu' densa, e «quella nota
   * appartiene a quel gruppo» resterebbe una cosa da indovinare dalla distanza. Con il
   * filo, e' scritto.
   */
  function syncThreads(entries: readonly KnowledgeEntry[]): void {
    const wanted = new Map<string, [Body, Body]>()
    for (const [a, b] of linkPairs(entries)) {
      const from = notes.get(a)
      const to = notes.get(b)
      if (from && to) wanted.set(`${a}~${b}`, [from, to])
    }
    for (const entry of entries) {
      if (!entry.hubId) continue
      const hub = hubs.get(entry.hubId)
      const note = notes.get(entry.id)
      if (hub && note) wanted.set(`h:${entry.hubId}~${entry.id}`, [hub, note])
    }

    for (const [key, thread] of threads) {
      if (wanted.has(key)) continue
      root.remove(thread.mesh)
      thread.material.dispose()
      threads.delete(key)
    }
    for (const [key, [from, to]] of wanted) {
      const existing = threads.get(key)
      if (existing) {
        existing.from = from
        existing.to = to
        continue
      }
      // I fili che tengono un centro sono piu' tenui e vanno dietro a tutto il resto:
      // sono la struttura, non il contenuto. Un filo fra due note e' una relazione che
      // l'utente ha scritto lui e merita di vedersi per primo.
      const isHub = Boolean(from.hub || to.hub)
      const material = new THREE.MeshBasicMaterial({
        color: isHub ? MAIN_COLOUR : NOTE_LINK_COLOUR,
        transparent: true,
        opacity: isHub ? 0.22 : 0.6,
      })
      const mesh = new THREE.Mesh(threadGeometry, material)
      mesh.renderOrder = isHub ? 0 : 1
      root.add(mesh)
      threads.set(key, { mesh, material, from, to })
    }
  }

  /**
 * One step of the relaxation, e la copia del risultato dentro `three`.
 *
 * Il calcolo **non** e' qui: e' `relax` in `logic/knowledgeLayout.ts`, che e' puro e quindi
 * ha un test che verifica che le note si spingano e che la mappa si fermi. Qui sotto c'e'
 * solo il passaggio di mano: si chiama il calcolo con i corpi, e si copia il risultato nei
 * `Vector3` che `three` disegna.
 *
 * Il passaggio attraverso numeri semplici non e' un costo da ottimizzare: sono tre per
 * corpo, e il vantaggio e' che la simulazione non puo' essere alterata per sbaglio dalla
 * scena. Il difetto peggiore di una mappa e' una nota che si muove perche' qualcuno ha
 * toccato un oggetto che non c'entra, e qui la sola cosa che la muove e' il calcolo.
 */
function stepPhysics(): void {
  const bodies = allBodies()
  if (bodies.length === 0) return
  const motions = bodies.map((body) => body.motion)
  relax(motions)
  for (let i = 0; i < bodies.length; i += 1) {
    place(bodies[i]!, motions[i]!.position)
  }
}

/** Moves a body and its simulation together, so the two never disagree. */
function place(body: Body, position: Vec3): void {
  body.group.position.set(position.x, position.y, position.z)
  body.motion.position = { x: position.x, y: position.y, z: position.z }
}

/** Puts the anchor where the user put the body, so it stays there. */
function anchorAt(body: Body, position: Vec3): void {
  body.motion.anchor = { x: position.x, y: position.y, z: position.z }
}

  function placeThreads(): void {
    const up = new THREE.Vector3(0, 1, 0)
    for (const thread of threads.values()) {
      const from = thread.from.group.position
      const to = thread.to.group.position
      const span = from.distanceTo(to)
      thread.mesh.position.addVectors(from, to).multiplyScalar(0.5)
      // Il cilindro nasce lungo l'asse Y: lo si ruota sul verso che unisce i due corpi.
      // Quando i due sono coincidenti la direzione e' zero e il filo si accorcia a zero,
      // che e' quello che deve succedere quando due corpi si sovrappongono.
      if (span > 0.0001) {
        thread.mesh.quaternion.setFromUnitVectors(
          up,
          new THREE.Vector3().subVectors(to, from).normalize(),
        )
      }
      thread.mesh.scale.set(1, span, 1)

      const touches = selected !== null &&
        (bodyOf(selected) === thread.from || bodyOf(selected) === thread.to)
      const isHub = Boolean(thread.from.hub || thread.to.hub)
      thread.material.opacity = touches ? 0.9 : isHub ? 0.22 : 0.6
      const colour = touches ? 0xfff0c2 : isHub ? MAIN_COLOUR : NOTE_LINK_COLOUR
      if (thread.material.color.getHex() !== colour) thread.material.color.setHex(colour)
    }
  }

  /**
   * Sends where the notes ended up, but only what actually moved.
   *
   * Il confronto con la posizione **gia' scritta** serve a una cosa precisa: la mappa
   * chiama questa funzione anche quando e' ferma, e senza il confronto ogni chiamata
   * scriverebbe un file identico a quello di prima. Il costo di una scrittura che non
   * cambia niente non e' niente finche' sono poche note, e diventa tutto quando sono mille
   * e la mappa si muove di continuo.
   */
  function publishPositions(): void {
    const out = { notes: new Map<KnowledgeId, Vec3>(), hubs: new Map<KnowledgeId, Vec3>() }
    for (const [id, note] of notes) {
      const next = movedSince(id, note)
      if (next) out.notes.set(id, next)
    }
    // Anche i centri, non solo le note: un centro trascinato a mano e non scritto
    // tornerebbe indietro alla riapertura, e tornerebbero indietro anche tutte le note
    // appese a lui. Trascinare un oggetto costerebbe il lavoro di tutto il gruppo, e
    // l'utente avrebbe perso la disposizione senza che nulla lo mostrasse.
    for (const [id, hub] of hubs) {
      const next = movedSince(id, hub)
      if (next) out.hubs.set(id, next)
    }
    if (out.notes.size > 0 || out.hubs.size > 0) options.onSettle(out)
  }

  /** La posizione se e' cambiata abbastanza da valere una scrittura, altrimenti `null`. */
  function movedSince(id: KnowledgeId, body: Body): Vec3 | null {
    const position = body.group.position
    const was = written.get(id)
    if (
      was &&
      Math.abs(was.x - position.x) < 0.01 &&
      Math.abs(was.y - position.y) < 0.01 &&
      Math.abs(was.z - position.z) < 0.01
    ) {
      return null
    }
    const next = { x: position.x, y: position.y, z: position.z }
    written.set(id, next)
    return next
  }

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let dragging = false
  let dragged = false
  /** The body under the pointer at press time, if the pointer went down on one. */
  let held: Body | null = null
  let lastX = 0
  let lastY = 0
  /**
   * Where the body was relative to the pointer at press time.
   *
   * Vedi il commento al trascinamento: senza questo delta la nota salta sotto il cursore al
   * primo movimento, e sembra che il mouse «prenda» il punto sbagliato invece della nota.
   */
  const grabOffset = new THREE.Vector3()
  /** How far the pointer may travel before a press stops counting as a click. */
  const CLICK_SLOP = 3

  function bodyAt(event: PointerEvent): Body | null {
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return null
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const meshes = allBodies().map((body) => body.mesh)
    const hit = raycaster.intersectObjects(meshes, false)[0]
    if (!hit) return null
    return allBodies().find((body) => body.mesh === hit.object) ?? null
  }

  function pick(event: PointerEvent): void {
    const body = bodyAt(event)
    if (!body) {
      options.onClear()
      return
    }
    const hit = selectionFor(body)
    /*
     * Con il collegamento acceso, due clic fanno il filo.
     *
     * Il primo clic **sceglie** e il secondo **collega**, e non viceversa: e' l'ordine in
     * cui si guarda e si decide. Se il primo collegasse subito, ogni clic su una nota
     * mentre lo strumento e' acceso creerebbe un legame — e una mappa piena di fili
     * accidentali e' una mappa su cui non si puo' contare niente, quindi non si puo'
     * nemmeno usare per orientarsi.
     *
     * Il secondo tocco sullo stesso corpo non collega niente: un filo da una nota a se
     * stessa non significa niente e si vedrebbe come un punto.
     */
    if (linking) {
      if (!linkFrom) {
        linkFrom = hit
        options.onPick(hit)
        return
      }
      if (linkFrom.kind === hit.kind && linkFrom.id === hit.id) return
      options.onLink(linkFrom, hit)
      linkFrom = null
      return
    }
    options.onPick(hit)
  }

  /**
 * Cosa il puntatore sta trascinando: il corpo, la camera, o niente.
   *
   * I tre modi sono i tre di Blender, piu' il sinistro perche' quasi nessuno ha un mouse con
   * tre tasti: in Blender il **tasto centrale** sposta la vista e il centrale con `Maiusc`
   * la gira; il tasto destro gira. Il sinistro, che su un portatile non esiste, trascina un
   * corpo della mappa — ed e' anche l'unico modo di spostare una nota con il mouse.
   */
type DragMode = 'body' | 'orbit' | 'pan'

let dragMode: DragMode = 'orbit'

function modeFor(event: PointerEvent): DragMode {
  // Il tasto centrale con Maiusc e' l'orbita in Blender, e non il viceversa: e' l'ordine in
  // cui il gesto piu' frequente (girare) sta sul tasto che non si preme per sbaglio.
  if (event.button === 1) return event.shiftKey ? 'orbit' : 'pan'
  if (event.button === 2) return 'orbit'
  if (linking) return 'orbit'
  return bodyAt(event) ? 'body' : 'orbit'
}

function onPointerDown(event: PointerEvent): void {
    dragging = true
    dragged = false
    lastX = event.clientX
    lastY = event.clientY
    /*
     * Prendere un corpo e portarlo altrove e' un gesto distinto dal girare la camera, e i due
     * si distinguono dal **tasto** e dal punto in cui comincia il trascinamento: il sinistro
     * su un corpo sposta il corpo, il sinistro sul vuoto e i tasti della camera girano la
     * vista.
     *
     * Senza questa distinzione l'uno impedisce l'altro: girare la mappa e' la cosa che si fa
     * di piu', e non si puo' girare con un gesto che sposta anche i pallini senza volerlo.
     */
    dragMode = modeFor(event)
    if (dragMode === 'body') {
      const body = bodyAt(event)
      if (body) {
        held = body
        body.motion.held = true
        body.motion.velocity = { x: 0, y: 0, z: 0 }
        /*
         * Si memorizza **dove** e' stata presa, non solo **cosa** e' stato preso.
         *
         * Il delta e' fra il punto del piano sotto il puntatore e il centro del corpo. Serve
         * perche' il raggio del puntatore non passa mai per il centro della sfera — arriva
         * sulla sua faccia — e senza questo delta la nota si sposterebbe di tutta la differenza
         * fra il punto toccato e il suo centro, al primo solo pixel di movimento. Un click su
         * una sfera e' un click sulla superficie: e' l'unico punto che l'occhio sente di aver
         * toccato, ed e' quello che deve restare sotto il puntatore.
         */
        const bounds = canvas.getBoundingClientRect()
        if (bounds.width !== 0 && bounds.height !== 0) {
          pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
          pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
          raycaster.setFromCamera(pointer, camera)
          const normal = new THREE.Vector3()
          camera.getWorldDirection(normal)
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, body.group.position)
          const at = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(plane, at)) {
            grabOffset.set(
              body.group.position.x - at.x,
              body.group.position.y - at.y,
              body.group.position.z - at.z,
            )
          } else {
            grabOffset.set(0, 0, 0)
          }
        } else {
          grabOffset.set(0, 0, 0)
        }
      }
      canvas.style.cursor = 'grabbing'
    } else if (dragMode === 'pan') {
      canvas.style.cursor = 'move'
    }
    canvas.setPointerCapture(event.pointerId)
  }

  /**
   * Moves the view sideways, the way Blender's middle-drag does.
   *
   * Si sposta il **punto** su cui la camera guarda, lungo i due assi della camera. Spostare
   * la camera mantenendola ferma sembrerebbe la stessa cosa e non lo e': se il punto non si
   * sposta, avvicinandosi la mappa scivola fuori dal centro dello schermo, e con un archivio
   * grande una vista che si sposta ma non si centra finisce sempre col centro del monitor
   * su un angolo vuoto.
   *
   * La velocita' e' proporzionale alla distanza perche' i pixel devono valere uguali a ogni
   * distanza: a una camera lontana un pixel corrisponde a piu' metri di mondo, e senza questa
   * proporzione la mappa volerebbe via appena ci si allontana.
   */
  function panBy(dx: number, dy: number): void {
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    camera.matrixWorld.extractBasis(right, up, new THREE.Vector3())
    // Il fattore tiene conto dell'altezza dello schermo, cosi' la scala e' la stessa su un
    // portatile e su un monitor grande invece di dipendere dai pixel.
    const perPixel = (2 * wanted.distance * Math.tan((camera.fov * Math.PI) / 360)) / 800
    wantedTarget.addScaledVector(right, -dx * perPixel)
    wantedTarget.addScaledVector(up, dy * perPixel)
    spinning = false
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    lastX = event.clientX
    lastY = event.clientY
    // Una pressione che si muove di tre pixel non e' una pressione: senza questa soglia,
    // ogni clic su una nota trascina la camera e la nota si sposta mentre si crede di
    // averla soltanto scelta.
    if (!dragged && Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) dragged = true
    if (!dragged) return

    if (dragMode === 'pan') {
      panBy(dx, dy)
      return
    }

    if (held) {
      /*
       * Si sposta il corpo nel piano che passa per lui ed e' **perpendicolare alla direzione
       * della camera**: cioe' il piano che contiene la destra e l'alto della camera, e che
       * l'occhio vede come uno schermo piano.
       *
       * Qui era il difetto, ed e' la cosa che «si muove su un solo asse» significava. La
       * normale era `(0,1,0) x avanti`, cioe' il piano che contiene la **linea di vista** e
       * l'alto: in quel piano il trascinamento orizzontale del mouse spingeva la nota verso
       * la camera o lontano — si vedeva rimpicciolire o ingrandirsi mentre la mano andava
       * di lato — e il verso non corrispondeva a quello del puntatore. Trascinando in su e in
       * giu' funzionava, perche' quell'asse era nel piano; trascinando a lato no.
       *
       * Con la normale data dall'avanti della camera il piano e' esattamente quello che si
       * vede, quindi la nota segue il puntatore in entrambe le direzioni e alla stessa
       * velocita'. E' il comportamento di Blender, che e' la regola che questa mappa segue
       * gia' per la camera e per i tasti.
       */
      const normal = new THREE.Vector3()
      camera.getWorldDirection(normal)
      if (normal.lengthSq() < 0.0001) return
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width === 0 || bounds.height === 0) return
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, held.group.position)
      const at = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, at)) return
      /*
       * L'offset resta quello del momento in cui si e' afferrato.
       *
       * Senza, la nota **salta** sotto il puntatore al primo movimento: il piano passa per la
       * nota, ma il raggio del puntatore lo incontra in un altro punto, e il corpo ci andrebbe
       * senza chiedere. Sembra uno scatto e non una presa, e con una sfera davanti e' il
       * difetto piu' fastidioso da cui non si capisce di poter uscire.
       *
       * Si trascina quindi il **delta** fra il punto di presa e la posizione della nota, che
       * e' la differenza fra «la nota e' qui» e «il puntatore e' qui». E' la stessa cosa che
       * fa un cursore che afferra un'immagine: l'immagine resta sotto il punto in cui e' stata
       * presa, anche se non e' il centro dell'immagine.
       */
      const x = at.x + grabOffset.x
      const y = at.y + grabOffset.y
      const z = at.z + grabOffset.z
      place(held, { x, y, z })
      // L'ancora segue il punto di caduta, e cosi' la nota resta dove e' stata messa: il
      // richiamo all'ancora serve a sciogliere gli accavallamenti, non a cancellare una
      // scelta.
      anchorAt(held, { x, y, z })
      return
    }

    wanted.theta -= dx * 0.006
    wanted.phi = clamp(wanted.phi - dy * 0.006, 0.15, Math.PI - 0.15)
  }

  function onPointerUp(event: PointerEvent): void {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    /*
     * Il corpo torna al moto delle molle **solo quando il puntatore viene lasciato andare**
     * e non durante: mentre si trascina, `held` tiene fermo il richiamo all'ancora e il
     * movimento e' quello della mano.
     */
    if (held) {
      // Una nota mossa a mano va scritta subito e non al salvataggio periodico: e' il
      // momento in cui l'utente sta guardando e si aspetta che resti li'.
      if (dragged) publishPositions()
      held.motion.held = false
      held = null
      canvas.style.cursor = 'grab'
    }
    dragging = false
    canvas.style.cursor = 'grab'
    // Solo il sinistro **sceglie**. Un tasto della camera che passa dalla stessa parte
    // aprirebbe la nota mentre si sta solo spostando la vista, e il gesto di navigare
    // finirebbe per cambiare la selezione — che e' il modo peggiore perche' non si vede e
    // non si annulla: si scopre solo dopo che la nota giusta non e' piu' quella evidenziata.
    if (!dragged && event.button === 0) pick(event)
  }

  function onPointerCancel(event: PointerEvent): void {
    onPointerUp(event)
    dragging = false
    dragged = false
    if (held) {
      held.motion.held = false
      held = null
    }
  }

  /**
   * La rotella avvicina e allontana, come in Blender.
   *
   * La distanza e' limitata agli stessi due numeri con cui la camera si autocentra: senza
   * un limite ravvicinato si entra dentro una palla e lo schermo diventa un colore pieno,
   * e senza un limite lontano si paga un ridisegno di tutto l'archivio per un'immagine in cui
   * non si distingue niente.
   *
   * Il fattore e' proporzionale alla distanza corrente — e' quello che rende la rotella
   *Uguale a ogni livello: avvicinandosi il passo si accorcia da solo, come in Blender.
   */
  function onWheel(event: WheelEvent): void {
    event.preventDefault()
    const step = wanted.distance * 0.0016
    wanted.distance = clamp(
      wanted.distance + event.deltaY * step,
      MIN_CAMERA_DISTANCE,
      MAX_CAMERA_DISTANCE,
    )
    spinning = false
  }

  /**
   * Le viste sui tasti, come in Blender.
   *
   * `1` davanti, `3` da destra, `7` dall'alto, `9` dietro, `5` avanti e basta, `Home` tutto
   * dentro. Vengono letti sia i tasti del tastierino numerico sia i numeri della riga in alto,
   * perche' su un portatile senza tastierino — e su una tastiera dove `1` digita un
   * carattere — il tasto giusto ci sarebbe ma non si puo' premere, e una scorciatoia che
   * non si puo' premere non e' una scorciatoia.
   */
  function handleKey(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    const digit = /^Numpad([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : null)
    if (event.code === 'Home' || event.key === 'Home') {
      frameAll()
      spinning = true
      return true
    }
    if (digit === '1') return lookFrom(0, Math.PI / 2)
    if (digit === '3') return lookFrom(Math.PI / 2, Math.PI / 2)
    if (digit === '7') return lookFrom(0, 0.001)
    if (digit === '9') return lookFrom(Math.PI, Math.PI / 2)
    if (digit === '5') {
      // `5` in Blender alterna la vista frontale e quella in prospettiva. Qui si simula con
      // l'angolo alto di prima, che e' quello da cui la profondita' si legge: alternare
      // verso una vista perfettamente di fronte su una mappa 3D mostrerebbe che e' piatta,
      // il che e' vero solo guardandola di lato.
      const flat = Math.abs(wanted.phi - Math.PI / 2) < 0.01
      return lookFrom(flat ? 0.7 : 0, flat ? 1.05 : Math.PI / 2)
    }
    if (event.key === 'ArrowLeft') return panKey(40, 0)
    if (event.key === 'ArrowRight') return panKey(-40, 0)
    if (event.key === 'ArrowUp') return panKey(0, -40)
    if (event.key === 'ArrowDown') return panKey(0, 40)
    return false
  }

  /** A keyboard pan, reported as "used" so the caller swallows the key. */
  function panKey(dx: number, dy: number): boolean {
    panBy(dx, dy)
    return true
  }

  /** Points the camera at the scene from a given angle, keeping where it looks. */
  function lookFrom(theta: number, phi: number): boolean {
    wanted.theta = theta
    wanted.phi = clamp(phi, 0.15, Math.PI - 0.15)
    spinning = false
    return true
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  /*
   * Il menu del tasto destro e' spento **solo** mentre il puntatore e' sulla mappa.
   *
   * In Blender il tasto destro non apre niente, e qui non deve aprire niente perche' il
   * destro e' uno dei tasti con cui si gira la camera: lasciarlo aprire il menu del browser
   * significa che la meta' dei gesti serve a qualcos'altro, e l'utente deve ricordare quale.
   * Il menu si lascia invece su tutto il resto della pagina, perche' li' e' un menu e
   * levare quello sarebbe una sciocchezza.
   */
  canvas.addEventListener('contextmenu', onContextMenu)

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault()
  }

  function resize(): void {
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width === 0 || bounds.height === 0) return
    renderer.setSize(bounds.width, bounds.height, false)
    camera.aspect = bounds.width / bounds.height
    camera.updateProjectionMatrix()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  function placeCamera(): void {
    const sinPhi = Math.sin(wanted.phi)
    camera.position.set(
      wantedTarget.x + wanted.distance * sinPhi * Math.cos(wanted.theta),
      wantedTarget.y + wanted.distance * Math.cos(wanted.phi),
      wantedTarget.z + wanted.distance * sinPhi * Math.sin(wanted.theta),
    )
    camera.lookAt(wantedTarget)
  }

  function tick(): void {
    frame = requestAnimationFrame(tick)
    if (document.hidden) return

    /*
     * La rotazione lenta si ferma al primo gesto.
     *
     * Una mappa che gira da sola e' gradevole finche' non ci si lavora: quando l'utente
     * comincia a girarla, continuare a girare da soli significa che quello che sta
     * puntando non resta fermo. Il primo tocco la spegne e non si riaccende — riaccenderla
     * non è un aiuto, è un altro movimento che non era stato chiesto.
     */
    if (dragging) spinning = false

    const ease = 0.12
    orbit.theta += (wanted.theta - orbit.theta) * ease
    orbit.phi += (wanted.phi - orbit.phi) * ease
    orbit.distance += (wanted.distance - orbit.distance) * ease

    // Il giro lento continua finche' l'utente non tocca niente, e da quel momento resta
    // fermo per sempre: vedi il commento di sopra, sul perche' non si riaccende.
    if (spinning) orbit.theta += 0.0006

    /*
     * La camera guarda **la nota scelta**, e se non ce n'e' il **mezzo di tutte**.
     *
     * Il punto di interesse si ricalcola **dopo** `stepPhysics` e non prima, perche' le
     * note si muovono: inseguirlo con un fotogramma di ritardo lascerebbe la camera sempre
     * un passo indietro rispetto a quello che sta guardando, e su una mappa che si assesta
     * si vedrebbe come un leggero scivolamento che non finisce mai.
     *
     * Il «mezzo di tutte» e' la media delle posizioni, e cambia da solo mentre la mappa si
     * assesta: quindi anche quando non c'e' niente di scelto la camera si ri-centra da
     * sola, e l'utente non deve premere un pulsante per vedere quello che sta davvero al
     * centro dell'archivio.
     *
     * Non e' uno spostamento che l'utente fa e che si puo' annullare: e' derivato. Per
     * questo non c'e' niente da salvare e niente da ripristinare — sta dove sta la nota.
     */
    stepPhysics()
    placeThreads()
    followPointOfInterest()

    /*
     * Si scrive **solo** quando la mappa si sta ancora muovendo e solo ogni tanto.
     *
     * Scrivere a ogni fotogramma produrrebbe una scrittura per nota per sessanta
     * fotogrammi al secondo su un archivio che in quel momento e' fermo da tre settimane, e
     * finche' non si e' fermato non si sa nemmeno quale disposizione sia quella giusta da
     * salvare: quella di mezzo secondo fa o quella di adesso? Il tempo di attesa serve a
     * dare la risposta — e ad aspettare che ci sia.
     */
    sinceSave += 16
    if (!isAtRest(allBodies().map((body) => body.motion)) && sinceSave > SAVE_EVERY_MS) {
      sinceSave = 0
      publishPositions()
    }

    placeCamera()
    renderer.render(scene, camera)
  }

  /**
   * Where the camera should be looking right now.
   *
   * La scelta e' fra due cose e non e' una preferenza: **la nota scelta** se ce n'e' una,
   * altrimenti **il mezzo di tutte**. Il motivo per cui non si somigliano e' che le due
   * domande sono diverse — «questa nota» e «l'archivio» — e tenere la camera ferma sul primo
   * quando si passa al secondo farebbe restare la camera addosso a una nota che non e' piu'
   * quella che interessa, che e' il modo piu' economico di sembrare che la mappa non
   * funzioni.
   *
   * Il punto viene **smorzato** con lo stesso coefficiente del resto della camera. Seguire
   * di netto la nota darebbe uno scatto appena si sceglie, e su una mappa che si muove da
   * sola ogni piccolo spostamento diventerebbe uno scatto: la mappa sembrerebbe nervosa
   * invece che viva.
   */
  /**
 * How far back the camera has to sit to see **everything**.
   *
   * Il difetto che chiude: la camera stava a una distanza fissa, scelta quando non c'era
   * ancora niente. Poi l'archivio cresceva e la distanza restava quella, cosi' le note nuove
   * finivano fuori dal campo visivo — e la mappa sembrava vuota mentre l'archivio era pieno.
   * E' il caso peggiore di un difetto di visualizzazione, perche' non si distingue da
   * «non ho salvato niente» e l'utente prova a salvare cose che gia' ci sono.
   *
   * Qui la distanza si calcola ogni volta sul **raggio che contiene tutto**, con un
   * margine: la sfera che racchiude i corpi, la distanza necessaria a tenere quella sfera
   * nell'angolo della camera, e un po' d'aria intorno perche' un corpo con l'alone non
   * debba toccare il bordo.
   */
function frameDistance(): number {
    const bodies = allBodies()
    if (bodies.length === 0) return START_DISTANCE
    const centre = new THREE.Vector3()
    for (const body of bodies) centre.add(body.group.position)
    centre.multiplyScalar(1 / bodies.length)
    let radius = 0
    for (const body of bodies) {
      // Il raggio del corpo c'e' perche' la palla deve entrare **intera**: centrare la sfera
      // sui centri e dimenticare i corpi lascia i bordi tagliati, che e' la parte che si
      // vede di piu' perche' e quella con l'etichetta.
      radius = Math.max(radius, body.group.position.distanceTo(centre) + BODY_RADIUS)
    }
    const halfFov = (camera.fov * Math.PI) / 360
    return clamp(radius / Math.sin(halfFov) * 1.25, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE)
  }

  function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value))
  }

  /** Puts everything in view: the middle of the map, at the distance that fits it. */
function frameAll(): void {
    const bodies = allBodies()
    const centre = new THREE.Vector3()
    for (const body of bodies) centre.add(body.group.position)
    if (bodies.length > 0) centre.multiplyScalar(1 / bodies.length)
    wantedTarget.copy(centre)
    wanted.distance = frameDistance()
  }

  function followPointOfInterest(): void {
    const chosen = selected ? bodyOf(selected) : null
    if (chosen) {
      wantedTarget.set(chosen.group.position.x, chosen.group.position.y, chosen.group.position.z)
    } else {
      const bodies = allBodies()
      if (bodies.length === 0) return
      let x = 0
      let y = 0
      let z = 0
      for (const body of bodies) {
        x += body.group.position.x
        y += body.group.position.y
        z += body.group.position.z
      }
      wantedTarget.set(x / bodies.length, y / bodies.length, z / bodies.length)
    }
    cameraTarget.lerp(wantedTarget, 0.12)
  }

  tick()

  return {
    setEntries(entries, hubList) {
      const wasEmpty = allBodies().length === 0
      setEntries(entries, hubList)
      /*
       * Alla prima nota che arriva la camera si mette a una distanza che la contiene.
       *
       * Solo alla prima, e non a ogni cambio: dopo, la camera e' quella che l'utente ha
       * scelto, e spostargliela mentre sta guardando qualcosa significa che quello che sta
       * guardando non e' piu' dove lo aveva lasciato. Il motivo per cui si fa qui e non
       * solo su «Reset view» e' che la prima apertura e' l'unica in cui l'utente non ha
       * ancora una sua distanza — e senza questa la mappa si aprirebbe gia' tagliata.
       */
      if (wasEmpty && allBodies().length > 0) frameAll()
    },
    setSelected(selection) {
      selected = selection
      syncSelectionVisuals()
    },
    setLinking(on) {
      linking = on
      // Il primo tocco della nuova coppia ricomincia da capo. Tenere il collegamento
      // aperto precedente significherebbe che il prossimo clic collega a qualcosa che
      // l'utente aveva scelto prima di cambiare strumento, e quel collegamento non
      // l'ha mai chiesto.
      if (!on) linkFrom = null
    },
    beginLink(selection) {
      linking = true
      linkFrom = selection
    },
    frameAll() {
      frameAll()
      spinning = true
    },
    handleKey,
    focus(id) {
      const body = notes.get(id) ?? hubs.get(id)
      if (!body) return
      // Si avvicina alla nota e la centra, ma non la mette sotto il naso: una camera a due
      // unita' di distanza fa sembrare tutto enorme e perde il contesto, che in una mappa
      // e' la parte che dice a cosa e' vicina.
      wanted.distance = clamp(Math.min(wanted.distance, 13), MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE)
      wantedTarget.copy(body.group.position)
      spinning = false
    },
    resetView() {
      wanted.theta = 0.7
      wanted.phi = 1.05
      // La distanza non e' un numero scritto qui: e' quella che serve a far entrare **tutto**
      // nel campo visivo, ricalcolata sul contenuto. Con una distanza fissa la mappa
      // mostrava le prime tre note e nascondeva il resto dell'archivio.
      frameAll()
      spinning = true
    },
    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('contextmenu', onContextMenu)
      // Prima di chiudere, la mappa **dice dove sono finite le note**. Senza, chiudere la
      // pagina mentre si sta ancora spostando qualcosa lascerebbe l'ultima disposizione
      // solo nella memoria del renderer: il riavvio successivo mostrerebbe la mappa come
      // era prima del gesto, che e' il modo peggiore in cui una mappa possa perdere un
      // lavoro che sembra fatto.
      publishPositions()
      glowTexture.dispose()
      for (const body of allBodies()) disposeBody(body)
      for (const thread of threads.values()) {
        root.remove(thread.mesh)
        thread.material.dispose()
      }
      threads.clear()
      notes.clear()
      hubs.clear()
      sphereGeometry.dispose()
      hubGeometry.dispose()
      threadGeometry.dispose()
      renderer.dispose()
    },
  }
}