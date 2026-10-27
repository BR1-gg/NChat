/**
 * How tall a node body may grow on its own, in pixels.
 *
 * Auto-fitting to the content is what keeps a graph readable: a two-line prompt
 * should not reserve the height of a paragraph. The cap is the other half of
 * that. Without it, one long answer becomes a column of text you have to scroll
 * inside a node, and the lines get too long to read comfortably. Past the cap
 * the body scrolls and the node keeps a sane size.
 */
export const AUTO_FIT = {
  /** A prompt or answer shorter than this still gets a usable click target. */
  minHeight: 74,
  /** A note is a label more than a paragraph, so it stops growing sooner. */
  minNoteHeight: 100,
  /** System instructions are read as a block, a little taller than a prompt. */
  minSystemHeight: 74,
  /**
   * The readable cap. Roughly 20 lines of body text: enough for a full answer,
   * short enough that the node still reads as a node on the canvas.
   */
  maxBodyHeight: 320,
  maxNoteHeight: 320,
  maxSystemHeight: 240,
  /**
   * The response body is Markdown rendered at 12px with a 1.58 line height, so
   * one line is about 19px. The cap is applied in CSS for responses because
   * their height comes from the content, not from an auto-sized textarea.
   *
   * Piu alto degli altri corpi, e per una scelta precisa: una risposta e lunga per
   * natura, e con un tetto basso finiva in tre schermate di scroll dentro una
   * schedina. Il nodo cresce in **verticale** finche c'e spazio, perche e l'unica
   * direzione in cui un paragrafo si legge bene; il testo scorre quando si arriva
   * in fondo, che e il comportamento giusto invece di continuare a crescere.
   */
  maxResponseHeight: 560,
  /**
   * La misura di una riga leggibile, in pixel.
   *
   * Vale solo per i nodi che l'utente non ha ridimensionato: chi allarga un nodo a
   * mano ha gia detto quanto lo vuole largo, e un tetto farebbe sparire proprio il
   * testo che ha chiesto di vedere. Con 12px, 560px sono circa 90 caratteri per
   * riga, che e il limite oltre il quale l'occhio perde il ritorno a inizio riga.
   */
  maxResponseWidth: 560,
} as const

/**
 * The height a textarea should take for its content: fit the text, but never
 * past the cap. Shared by every node with an auto-sized textarea so the numbers
 * live in one place instead of being repeated per component.
 */
export function autoFitHeight(
  scrollHeight: number,
  limits: { min: number; max: number },
): number {
  return Math.min(limits.max, Math.max(limits.min, scrollHeight))
}
