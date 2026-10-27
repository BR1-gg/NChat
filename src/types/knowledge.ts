import type { AppNode, GroupColor, NodeId } from './document'

/**
 * La conoscenza: un archivio che esiste **fuori** da qualunque workspace.
 *
 * Un vault come quello di Obsidian, con una differenza che conta: qui dentro ci finisce
 * solo quello che l'utente ha deciso di salvare, e ci finisce **per mano sua**. Niente
 * entra e niente esce senza un gesto. Il motivo e' che questo archivio finisce dentro le
 * richieste al modello, e una riga che arriva senza che nessuno l'abbia scelta cambia
 * silenziosamente quello che il modello risponde.
 */

/**
 * The colour of a note.
 *
 * E' **la stessa palette** dei gruppi, non una uguale. Due elenchi di colori che si
 * somigliano finiscono per divergere — uno ne aggiunge un tono e l'altro no — e da li' la
 * scelta dei colori significa una cosa diversa a seconda di dove si clicca, che e' il
 * contrario di quello che serve a chi li sta scegliendo per distinguere una cosa dall'altra.
 *
 * Nominare lo stesso tipo in due modi non serve a nulla: qui si riusa il nome dei gruppi
 * e basta.
 */
export type KnowledgeColor = GroupColor

/** A point in the space the notes live in. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

export type KnowledgeId = string

/**
 * Il **punto di contesto**: un centro che l'utente crea per mettere ordine.
 *
 * Non e' una nota, e la distinzione non e' una pignoleria di tipo. Una nota e' un
 * passaggio che viene **citato al modello**; un punto di contesto e' solo un'etichetta
 * che dice «queste note stanno insieme perche' parlano di questo». Mescolarli
 * significherebbe che un nome di comodo finisce fra le citazioni del modello e conta
 * come se fosse stato un testo dell'utente — e il nome di comodo non e' mai stato scritto
 * dall'utente, e' stato indovinato da chi ha scritto il programma.
 *
 * E' l'unica cosa nell'archivio che nasce **per mano dell'utente e solo per quello**: il
 * resto — dove cade una nota, a chi e' vicina — lo decide il confronto fra le parole. Un
 * punto di contesto non lo puo' dedurre nessun algoritmo, perche' «di cosa parla questo
 * insieme» e' una domanda sul **come** l'utente vuole raggruppare, non sul testo.
 */
export interface KnowledgeHub {
  id: KnowledgeId
  /** What the group is about, written by the user. Shown on the hub itself. */
  title: string
  position: Vec3
  createdAt: number
  updatedAt: number
}

/**
 * Where a saved passage came from.
 *
 * Sono **testi**, non collegamenti: il workspace e il nodo da cui arriva possono essere
 * cancellati, e un riferimento vivo diventerebbe un id che non porta piu' da nessuna
 * parte. Qui si lascia la parola con cui riconoscerlo — «Trimestre 2, risposta su
 * Listini» — che resta vera anche quando la risposta non c'e' piu'.
 */
export interface KnowledgeSource {
  workspaceId: string | null
  workspaceName: string | null
  /** The node's title at the moment of saving, for the same reason. */
  nodeTitle: string | null
  nodeId: NodeId | null
}

export interface KnowledgeEntry {
  id: KnowledgeId
  /** Shown on the note. Derived from the text when not set by hand. */
  title: string
  /** The saved passage itself. This is what the model gets to read. */
  text: string
  /**
   * The colour the user chose, or `default` for the theme's own accent.
   *
   * `default` non e' un colore: e' «il colore del tema», e quindi la pallina segue
   * l'aspetto attivo invece di restare legata a un tema solo. Lo stesso accordo dei gruppi.
   */
  color: KnowledgeColor
  source: KnowledgeSource
  /**
   * The main point this note hangs from, or `null` when it floats on its own.
   *
   * `null` e' uno stato **previsto** e non una terra di nessuno: senza un punto di
   * contesto la nota sta bene lo stesso, e la mappa la mostra lo stesso. Quello che
   * cambia e' la linea: una nota senza centro e' un punto libero, e una nota con un
   * centro ha un filo che la dichiara sua. La finestra che chiede dove mettere la nota
   * offre anche questa terza possibilita', perche' costringere a scegliere un gruppo
   * anche quando la nota non sta con nessuno sarebbe un obbligo, non una scelta.
   */
  hubId: KnowledgeId | null
  /**
   * Notes this one is tied to, by id.
   *
   * Si tiene **una sola direzione** e il rapporto e' letto come se fosse simmetrico:
   * collegare A a B scrive `B` nella lista di `A`, e `neighboursOf` cammina tutte le
   * note per trovare chi punta a chi. Con un doppio scrittura — A che sa di B e B che
   * sa di A — un collegamento puo' essere cancellato da un lato solo e lasciare un
   * filo che porta a una nota che non sa di essere collegata: una mappa che mostra un
   * legame che non esiste nell'altra meta' e' peggio di una che non mostra niente.
   *
   * Un id che non porta a nessuna nota viene ignorato in lettura, perche' una nota
   * cancellata non deve poter lasciare fili appesi.
   */
  links: KnowledgeId[]
  /**
   * Where it sits in the space.
   *
   * La posizione e' **durata**, non ricalcolata a ogni apertura: e' il modo in cui la
   * mappa resta quella che l'utente ha imparato a riconoscere. Ricalcolarla da zero
   * ogni volta sposterebbe tutto a ogni avvio, e una mappa che si riordina da sola non e'
   * una mappa: e' rumore da cui non si ricava niente.
   *
   * Vedi `layoutKnowledge` in `logic/knowledge.ts`, che decide la posizione al momento
   * in cui l'elemento viene salvato — quando il testo e' noto — e da li' in poi non la
   * tocca piu'.
   */
  position: Vec3
  createdAt: number
  updatedAt: number
  /** The words that placed it here, kept so the move can be explained. */
  placedBecause: string
}

/** The whole archive. One per app, shared by every workspace. */
export interface KnowledgeBase {
  entries: KnowledgeEntry[]
  hubs: KnowledgeHub[]
}

/**
 * The saved passage, before it becomes an entry.
 *
 * `hubId` arriva gia' scelto. La scelta la fa l'utente nella finestra che si apre
 * quando preme «salva», e la finestra offre anche «nessun punto di contesto»: senza
 * quel campo, il posto sarebbe deciso da solo e la domanda che quella finestra pone
 * non avrebbe una risposta.
 */
export interface KnowledgeDraft {
  text: string
  title?: string
  source: KnowledgeSource
  hubId?: KnowledgeId | null
  /**
   * The colour to give it, if the user already picked one.
   *
   * Facoltativo anche questo, e per la ragione che vale per `hubId`: non e' che questa nota
   * non abbia un colore, e' che l'utente non ne ha ancora scelto uno — quindi segue quello
   * del tema, che e' una scelta legittima e non un'assenza.
   */
  color?: KnowledgeColor
}

export const MAX_ENTRY_CHARS = 4000

/**
 * What the model is given, and what it is told about it.
 *
 * Il confine e' scritto qui dentro perche' e' una **promessa**, non una descrizione:
 * l'archivio e' di sola lettura per il modello. Il modello non ha strumenti per
 * cancellare — non perche' gli e' stato vietato, ma perche' **non esiste un modo** di
 * formularlo: nessun canale che porti una richiesta di cancellazione fino ai dati. Una
 * rifiuto che si puo' aggirare non e' un rifiuto, e l'unica rifiuto che non si aggira e'
 * quello che non ha proprio il canale.
 *
 * Quindi: il modello **legge** e non **scrive**. Aggiungere e' un gesto dell'utente, e
 * cancellarepure. Se un giorno si volesse dare al modello la scrittura, la cosa da
 * scrivere prima non e' una riga di prompt: e' la conferma — che esiste gia'
 * (`requestConfirm`) e che va chiamata **prima** di toccare i dati, non dopo.
 *
 * ---
 *
 * Perche' l'avviso dice anche «rispondi da qui», e non solo «non puoi scrivere».
 *
 * La prima versione diceva soltanto che le note sono in sola lettura: «puoi citarle e
 * ragionarci sopra». E' una **permesso**, non un'istruzione, e un modello che legge un
 * permesso lo tratta come opzionale: risponde dal proprio peso e usa le note solo se gli
 * capitano convenienti. Il sintomo non e' un errore — e' una risposta perfettamente
 * grammaticale, costruita senza le note, accanto a un nodo che dice «2 notes · ~132 tokens».
 * Chi lo vede conclude che il nodo non funziona, e il nodo funziona: funziona e viene ignorato.
 *
 * Un modello piccolo in locale, in particolare, ha meno materiale da cui prendere e piu'
 * tendenza a rispondere in modo fluency; un contesto che non gli si chiede esplicitamente di
 * usare viene pesato come sfondo. Percio' qui si chiede, in tre punti concreti:
 *
 * - **di rispondere dalle note**, e di preferire quelle a cio' che crede di ricordare;
 * - **di dire quando non bastano**, perche' il silenzio e' indistinguibile dall'ignoranza e
 *   quindi e' la cosa piu' inutile che possa fare;
 * - **di nominare la nota usata**, che e' il punto per cui l'utente capisce se il canale
 *   funziona senza dover fidarsi: la citazione si legge nella risposta.
 *
 * Il «preferisci le note a quello che ricordi» e' pericoloso solo se le note fossero sbagliate,
 * e per quello c'e' gia' la frase sotto: se una nota sembra sbagliata, il modello lo dice e
 * decide la persona. Il pericolo vero dell'altra versione non era la fiducia cieca, era la
 * risposta che non usa niente.
 *
 * ---
 *
 * Perche' questa versione e' **piu' corta** di quella che l'aveva preceduta, che era 763
 * caratteri.
 *
 * Perche' il blocco non porta con se' la prova di aver funzionato: porta con se' le note. E
 * questa frase sta in **ogni** blocco di ogni richiesta, quindi ogni parola qui e' una parola
 * pagata a ogni domanda, anche quando la risposta non usa niente. La versione lunga costava
 * 212 token a blocco, e con due blocchi erano 424 — piu' del quadruplo delle note vere e
 * proprie, che sono troncate a 320 caratteri e quindi costano circa 100 token ciascuna. Si
 * stava pagando per le istruzioni piu' che per il contenuto, che e' il contrario di quello che
 * serve.
 *
 * Quindi le quattro richieste restano tutte e ognuna ha perso le parole di sostegno:
 *
 * - **rispondi dalle note**, preferendole a cio' che ricordi;
 * - **nomina la nota usata**, che e' l'unica cosa che rende visibile l'uso;
 * - **dillo se non bastano**, perche' il silenzio e' indistinguibile dall'ignoranza;
 * - **non puoi scrivere**, e se una nota sembra sbagliata lo dici e decide la persona.
 *
 * Quello che e' sparito e' la spiegazione di *perche'* — «le note sono state scelte per questa
 * domanda», «possono essere piu' vecchie o semplicemente sbagliate», «senza fingere che ti
 * abbiano aiutato». Erano tre righe di cortesia verso il lettore del prompt, non istruzioni al
 * modello, e il modello non le ha mai usate. Una riga che spiega il perche' a chi non legge
 * il codice puo' stare nel commento qui sopra, che non costa nulla.
 */
export const KNOWLEDGE_READ_ONLY_NOTICE =
  'Answer from these notes: they are the person\'s saved knowledge, chosen for this question. ' +
  'Prefer them over what you remember, name the one you use, and say so if they do not cover ' +
  'the question. You cannot edit or delete them: if one seems wrong, say so and the person ' +
  'decides. Never claim to have changed anything.'


/**
 * La prova che delle note sono **state mandate** in una certa risposta.
 *
 * Esiste perche' la domanda «l'AI sta usando i miei appunti?» non si puo' rispondere
 * guardando la risposta: due risposte diverse possono essere compatibili sia con «ha usato
 * le note» sia con «le ha ignorate e ha risposto a memoria». Il nodo che le manda dice
 * quanti saranno, il che dice **quanti saranno**, e nessuno dei due dice **quanti sono
 * arrivati**.
 *
 * Questa struttura e' la risposta a quel buco, ed e' volutamente modesta: registra cio' che e'
 * successo, non cio' che il modello ha capito. Non si puo' mai dimostrare che un modello ha
 * usato un testo — quello che si puo' dimostrare e' che il testo era li'. Il resto si legge
 * nella risposta, e per questo l'avviso nel blocco **chiede al modello di nominare la nota**:
 * e' l'unico modo che ha di rendere visibile il proprio uso, e senza quella richiesta questa
 * struttura direbbe solo «il canale funziona», che e' metà della verita'.
 *
 * Nota per ogni voce: `hub` e' il punto di contesto in cui la nota sta appesa, quando ce n'e'
 * uno. Serve perche' «2 note» non dice niente, e «2 note, sotto Prezzi e listini» dice quello
 * che l'utente si aspetta di vedere.
 */
export interface KnowledgeTrail {
  entries: Array<{
    id: KnowledgeId
    title: string
    /** The main point this note hangs under, or `null` for a loose one. */
    hub: string | null
    /** Whether a Knowledge node chose it, or the automatic retrieval did. */
    via: 'retrieved' | 'node'
  }>
}
/** Short heading for the injected block. */
export const KNOWLEDGE_BLOCK_HEADING = 'Saved knowledge'

/** How the injected block is delimited, so it is obvious it is not the user's words. */
export interface KnowledgeInjection {
  heading: string
  /** One entry per line, already formatted. */
  body: string
  /** The ids quoted, so the run can be shown to the user. */
  entryIds: KnowledgeId[]
  estimatedTokens: number
}

/** Builds the source record from a node, at save time. */
export function sourceFromNode(
  node: AppNode | undefined,
  origin: { workspaceId: string; workspaceName: string } | null,
): KnowledgeSource {
  if (!node) {
    return { workspaceId: null, workspaceName: null, nodeTitle: null, nodeId: null }
  }
  const data = node.data as { title?: unknown; name?: unknown }
  const title =
    typeof data.title === 'string' && data.title.trim()
      ? data.title.trim()
      : typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : null
  return {
    // L'id serve a ritrovare il workspace, il nome a riconoscerlo anche se il workspace
    // non c'e' piu'. Sono due cose diverse e non si sostituiscono: scrivendo il nome
    // nell'id si perderebbe il collegamento, e viceversa si perderebbe la leggibilita'.
    workspaceId: origin?.workspaceId ?? null,
    workspaceName: origin?.workspaceName ?? null,
    nodeTitle: title,
    nodeId: node.id,
  }
}
