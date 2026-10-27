import type { AggregateItem } from './registry'
import type { SetFormatStrategy } from '../../types/document'

export interface FormatStrategy {
  id: SetFormatStrategy
  label: string
  format(items: AggregateItem[], includePromptText?: boolean): string
}

export const sectionsStrategy: FormatStrategy = {
  id: 'sections',
  label: 'Sections',
  format(items, includePromptText = true) {
    return items
      .map((item) => {
        // When the label already is the question, quoting it again is noise.
        const quote =
          includePromptText && item.question && item.question !== item.label
            ? `> ${item.question}\n\n`
            : ''
        return `### ${item.label}\n${quote}${item.text}`
      })
      .join('\n\n')
  },
}

export const numberedStrategy: FormatStrategy = {
  id: 'numbered',
  label: 'Numbered',
  format(items) {
    return items.map((item, index) => `${index + 1}. ${item.label}\n${item.text}`).join('\n\n')
  },
}

export const jsonStrategy: FormatStrategy = {
  id: 'json',
  label: 'JSON',
  format(items, includePromptText = true) {
    return JSON.stringify(
      items.map((item) => ({
        label: item.label,
        ...(includePromptText && item.question ? { question: item.question } : {}),
        text: item.text,
      })),
      null,
      2,
    )
  },
}

export const plainStrategy: FormatStrategy = {
  id: 'plain',
  label: 'Plain, no titles',
  format(items) {
    // Solo i testi, uno dopo l'altro. Un gruppo di risposte alla stessa domanda
    // ripeteva lo stesso titolo `###` davanti a ogni blocco, tre volte la stessa
    // riga: rumore che il modello paga in token e non usa.
    return items
      .map((item) => item.text.trim())
      .filter((text) => text.length > 0)
      .join('\n\n')
  },
}

export const strategies: Record<Exclude<SetFormatStrategy, 'llm-synthesis'>, FormatStrategy> = {
  plain: plainStrategy,
  sections: sectionsStrategy,
  numbered: numberedStrategy,
  json: jsonStrategy,
}

export function formatAggregate(
  strategy: SetFormatStrategy,
  items: AggregateItem[],
  includePromptText = true,
): string {
  if (strategy === 'llm-synthesis') return sectionsStrategy.format(items, includePromptText)
  return strategies[strategy].format(items, includePromptText)
}
