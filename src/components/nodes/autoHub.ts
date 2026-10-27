/**
 * Il valore della tendina che significa «quello che c'entra con la domanda».
 *
 * Vive in un file suo perche' finisce in tre posti — la tendina che lo mostra, il test che
 * verifica che il salvataggio lo distingue da un centro vero, e `assemble.ts` che decide se
 * fare il recupero — e una stringa magica replicata in tre punti e' una stringa che prima o
 * poi un refactoring lascia in uno solo. Poi la tendina mostra «quello che c'entra» e il
 * programma cerca un punto di contesto chiamato `__auto__`, che non esiste: il nodo manda
 * niente e non dice perche'.
 *
 * Il perche' di una stringa e non di un valore in `hubId` e' gia' nella documentazione di
 * `KnowledgeNodeData`: i due sono due modi di scegliere le note, non uno stato con due nomi.
 */
export const AUTO_HUB = '__auto__'