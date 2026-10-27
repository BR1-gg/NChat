import { useEffect } from 'react'
import { useUiStore } from '../../store/uiStore'

/**
 * Mostra **dove** e' la parola cercata, dentro il nodo che la ricerca ha trovato.
 *
 * Il difetto che chiude e' che scegliendo un risultato il nodo veniva centrato e
 * basta. Su un prompt o su una nota va bene — il testo sta li' e si vede. Ma su una
 * risposta lunga, o su un file, il nodo riempie lo schermo con parole che non sono
 * quelle cercate, e l'utente si ritrova a rileggere per ritrovare quello che gli
 * avevano appena detto. La ricerca aveva finito il lavoro e lo rifaceva da capo.
 *
 * **La parola viene selezionata, non colorata.** Il motivo e' che due terzi dei nodi
 * scrivono in una `textarea`, e dentro una `textarea` non si puo' mettere un `<mark>`:
 * il testo e' un valore, non markup. Selezionando, la parola si vede subito e lo fa
 * il browser stesso — quindi non c'e' niente da sincronizzare con il testo, e niente
 * che possa restare scollegato se il contenuto cambia.
 *
 * Il click fuori la toglie, e non perche' qualcosa la cancella: perche' e' una
 * selezione del browser, e il browser la toglie da solo. Si interviene solo per
 * dimenticare il bersaglio, cosi' un risultato successivo riparte pulito.
 */
export function SearchHighlight(): null {
  const target = useUiStore((state) => state.searchTarget)

  useEffect(() => {
    if (!target) return
    const terms = target.terms.filter((term) => term.length > 0)
    if (terms.length === 0) return

    /*
     * Il nodo appena centrato non e' ancora fermo: `setCenter` ci mette 300ms, e una
     * selezione fatta durante il movimento andrebbe ricalcolata su una posizione che
     * non e' piu' quella. Si aspetta che la telecamera si fermi, e solo allora si
     * cerca il testo. Il ritardo e' uguale alla durata della transazione perche' e'
     * quello che ci vuole: prima sarebbe una posizione sbagliata, dopo sarebbe la
     * stessa selezione.
     */
    const timer = window.setTimeout(() => {
      const shell = document.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(target.nodeId)}"]`,
      )
      if (!shell) return
      /*
       * Il nodo viene marcato **prima** di selezionare, e non solo quando la selezione
       * e' riuscita. L'attributo rende la selezione forte e con un bordo, e serve a
       * distinguere «questa parola e' il risultato della ricerca» da «l'utente sta
       * selezionando un pezzo di testo» — che durante una ricerca succede spesso, e
       * senza il bordo le due cose si confondono.
       */
      shell.dataset.searchHit = 'true'
      /*
       * Se il testo non c'e', il nodo resta comunque selezionato e centrato — quindi
       * l'utente non resta fermo senza risultato — e la marcatura viene tolta, perche'
       * un nodo con la parola «evidenziata» e senza parola evidenziata e' solo rumore.
       * Non si avvisa perche' il caso normale in cui la parola non c'e' come testo e'
       * proprio quello che la ricerca accetta: il **nome** di un'immagine o di un
       * file. Li' la ricerca ha risposto bene e non c'e' niente da evidenziare dentro.
       */
      if (!applySelection(shell, terms)) delete shell.dataset.searchHit
    }, 320)

    /*
     * La marcatura sparisce con l'evidenziatura. Senza questo il nodo resterebbe con
     * «sta succedendo qualcosa qui» anche molto dopo che l'utente ha fatto altro, e la
     * parola forte sarebbe un ricordo di qualcosa che non sta piu' accadendo.
     */
    const previous = document.querySelector<HTMLElement>('[data-search-hit]')
    if (previous && previous.dataset.nodeId !== target.nodeId) delete previous.dataset.searchHit

    return () => window.clearTimeout(timer)
  }, [target])

  /*
   * Il click fuori cancella la selezione.
   *
   * Si ascolta in fase di acquisizione perche' la selezione del browser la cancella
   * **dopo** che il click e' stato gestito: intercettarla in bubbling significa
   * arrives after the browser has already cleared it, e il lavoro di rifare sarebbe
   * inutile — peggio, si annullerebbe subito.
   *
   * Si cancella anche il bersaglio nello store, altrimenti il prossimo risultante
   * della ricerca partirebbe da una selezione gia' fatta su un altro nodo.
   */
  useEffect(() => {
    if (!target) return
    const onPointerDown = (event: PointerEvent): void => {
      const shell = document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(target.nodeId)}"]`)
      const inside = shell?.contains(event.target as Node) ?? false
      if (inside) return
      clearNativeSelection()
      // Anche la marcatura: un nodo con l'aspetto di «parola trovata» mentre la
      // selezione e' sparita direbbe che l'evidenziatura e' ancora attiva, e
      // l'utente cercherebbe perche' non si veda niente.
      if (shell) delete shell.dataset.searchHit
      useUiStore.getState().setSearchTarget(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [target])

  return null
}

/** Removes whatever is selected, whether it is in a field or in the page. */
function clearNativeSelection(): void {
  const selection = window.getSelection()
  if (selection) selection.removeAllRanges()
  const active = document.activeElement
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    // Collassa la selezione invece di azzerare il testo: `setSelectionRange(0, 0)`
    // lascia il cursore dov'era, che e' cio' che fa una selezione che l'utente
    // chiude. Svuotare il campo sarebbe una cancellazione, non una deselezione.
    const end = active.selectionEnd ?? 0
    active.setSelectionRange(end, end)
  }
}

/**
 * Selects the first occurrence of the first term that exists, inside this node.
 *
 * Si prova una parola alla volta e si passa alla successiva solo se la precedente non
 * c'e'. L'ordine e' quello in cui l'utente le ha scritte, e la prima che esiste e'
 * quella che sta cercando di ricordare. Tornare `false` solo se **nessuna** c'e', cosi'
 * che un termine mancante non impedisce di evidenziare l'altro.
 * Per ogni parola si prova prima il **campo** e poi il testo del nodo, e i due non si
 * escludono a vicenda. Il campo viene per primo perche' e' il posto preciso: se la
 * parola c'e' in una `textarea`, segnalare quella e' esattamente cio' che si vuole, e
 * non un'occorrenza qualsiasi nel titolo.
 *
 * Ma il campo non puo' **pretendere** di essere l'unico posto: un nodo file ne ha uno
 * nascosto (`<input type="file">`, il cui valore e' un percorso e non il testo del
 * file), e li' la parola non ci sara' mai. Se il campo non la contiene e li' ci si
 * fermasse, il testo del file — che e' esattamente cio' che l'utente sta cercando —
 * non sarebbe mai guardato, e il nodo si aprirebbe senza nessuna parola evidenziata.
 */
function applySelection(shell: HTMLElement, terms: string[]): boolean {
  const field = shell.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input')
  for (const term of terms) {
    if (field) {
      const at = field.value.toLowerCase().indexOf(term.toLowerCase())
      if (at >= 0) {
        // `preventScroll`: il nodo e' gia' stato centrato dalla ricerca, e farlo
        // scorrere la pagina annullerebbe la centratura — l'utente perderebbe il nodo
        // proprio mentre gli si mostrava la parola.
        field.focus({ preventScroll: true })
        field.setSelectionRange(at, at + term.length)
        revealField(field)
        return true
      }
    }
    const range = findInText(shell, term)
    if (!range) continue
    const selection = window.getSelection()
    if (!selection) return false
    selection.removeAllRanges()
    selection.addRange(range)
    revealRange(range)
    return true
  }
  return false
}

/** The nearest ancestor that actually scrolls, stopping at the node's own shell. */
function closestScrollable(element: Element): HTMLElement | null {
  const shell = element.closest<HTMLElement>('[data-node-id]')
  let current: HTMLElement | null = element.parentElement
  while (current && current !== shell) {
    const overflowY = getComputedStyle(current).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }
  return null
}

/**
 * The first occurrence of a term among the text nodes inside an element.
 *
 * Si cammina per nodi di testo e non per l'`innerText` dell'elemento, perche' il testo
 * visualizzato e' spezzato in molti nodi: il markdown di una risposta mette dentro
 * `<strong>` e `<code>`, e una parola puo' finire a cavallo fra due elementi. Un
 * `indexOf` sul testo unito troverebbe l'indice giusto e lo applicherebbe al nodo
 * sbagliato, illuminando metà di una parola.
 *
 * Il limite che resta e' dichiarato: una parola spezzata **dentro** un nodo di testo
 * non viene trovata. E' il caso raro — e la alternativa sarebbe riscrivere il DOM
 * solo per mettere un colore, toccando il testo che l'utente sta leggendo.
 */
function findInText(root: HTMLElement, term: string): Range | null {
  const needle = term.toLowerCase()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node.textContent ?? '').toLowerCase().indexOf(needle)
    if (at < 0) continue
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + term.length)
    return range
  }
  return null
}

/**
 * Scrolls the match into view **inside** the node, and nowhere else.
 *
 * `scrollIntoView` non si puo' usare: scorrerebbe anche la tela, e cioe' annullerebbe
 * la centratura che la ricerca ha appena fatto — l'utente preme un risultato e il
 * nodo gli scivola via mentre guarda. Qui si tocca solo il contenitore piu' vicino
 * che scorre da solo.
 *
 * Il motivo per cui serve: su una risposta lunga la parola cercata e' magari a
 * meta' del testo e il nodo ne mostra solo la cima. Senza questo, «evidenziata» vuol
 * dire «evidenziata da qualche parte, e non si vede» — che e' peggio che non
 * evidenziarla, perche' l'utente smette di fidarsi.
 */
function revealRange(range: Range): void {
  /*
   * Il rettangolo **del Range**, non quello dell'elemento che lo contiene.
   *
   * Il markdown di una risposta mette l'intero paragrafo in un `<p>`: se si prendesse
   * la scatola del `<p>`, si misurerebbe un rettangolo alto trenta righe che comincia
   * sopra la vista, e lo scorrimento risulterebbe negativo — cioe' nessuno
   * scorrimento, e la parola resterebbe sotto. Il Range sa invece esattamente dove
   * sono le parole selezionate, che e' l'unica informazione che serve.
   */
  const element = range.startContainer.parentElement
  const scroller = element ? closestScrollable(element) : null
  if (!scroller) return
  const markBox = range.getBoundingClientRect()
  const scrollerBox = scroller.getBoundingClientRect()
  if (markBox.height === 0) return

  /*
   * I due assi si controllano **separatamente**, e non con un unico ritorno anticipato.
   *
   * Era una cosa sola ed era sbagliata: se la parola era gia' nella vista verticale si
   * tornava subito, senza guardare l'orizzontale. Ma il testo di un file e' dentro un
   * `<pre>` che non va a capo — una riga lunga esce dal nodo — e la parola in fondo a
   * quella riga e' a destra, fuori dallo schermo. Il risultato era una striscia
   * evidenziata attraverso il pannello con la parola che non si vedeva: il peggior
   * esito possibile, perche' sembrava sistemato e non lo era.
   */
  const outOfViewVertically = markBox.top < scrollerBox.top || markBox.bottom > scrollerBox.bottom
  if (outOfViewVertically) {
    // Un terzo di altezza sopra: la parola finisce sopra la meta' del pannello, dove
    // l'occhio guarda prima, e sotto restano le righe che la seguono per il contesto.
    scroller.scrollTop += markBox.top - scrollerBox.top - scrollerBox.height / 3
  }

  /*
   * In orizzontale si lascia un margine di 24px a sinistra della parola, perche' una
   * parola allineata al bordo sinistro arriva tagliata dal bordo del nodo e non si
   * capisce quale sia. La correzione si applica solo se il contenitore scorre
   * davvero sul lato: toccare `scrollLeft` su un contenitore che non trabocca
   * sposterebbe un testo che si vedeva gia' bene.
   */
  if (scroller.scrollWidth > scroller.clientWidth) {
    const outOfViewHorizontally = markBox.left < scrollerBox.left || markBox.right > scrollerBox.right
    if (outOfViewHorizontally) scroller.scrollLeft += markBox.left - scrollerBox.left - 24
  }
}

/**
 * The same, for a text field.
 *
 * Una `textarea` non ha un Range utilizzabile — la sua selezione e' un indice nel
 * valore, non nel documento — quindi la posizione si stima dal posto della parola nel
 * testo. E' un'approssimazione, e va detto: con righe di lunghezza diversa la stima
 * sbaglia di qualche riga. Per un prompt o una nota non conta, perche' il corpo cresce
 * col testo e la parola e' gia' visibile; conta solo quando l'utente ha ridimensionato
 * il nodo a mano e il testo scorre.
 */
function revealField(field: HTMLTextAreaElement | HTMLInputElement): void {
  const scroller = closestScrollable(field)
  if (!scroller) return
  const at = field.selectionStart ?? 0
  const ratio = field.value.length > 0 ? at / field.value.length : 0
  const target = scroller.scrollHeight * ratio
  // Solo se la selezione e' davvero fuori dalla vista: altrimenti si disturberebbe
  // una casella che l'utente puo' gia' leggere per intero.
  const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight) || 16
  const line = field.value.slice(0, at).split('\n').length
  const withinView = line * lineHeight >= scroller.scrollTop &&
    line * lineHeight <= scroller.scrollTop + scroller.clientHeight
  if (withinView) return
  scroller.scrollTop = Math.max(0, target - scroller.clientHeight / 3)
}
