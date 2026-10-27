import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { forwardRef, useId } from 'react'

export function Field({
  label,
  help,
  error,
  children,
}: {
  label: string
  help?: string
  error?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {help && !error ? <small>{help}</small> : null}
      {error ? <small style={{ color: 'var(--err)' }}>{error}</small> : null}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput(props, ref) {
    return <input {...props} ref={ref} className={`input ${props.className ?? ''}`.trim()} />
  },
)

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ''}`.trim()} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ''}`.trim()} />
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}) {
  return (
    <div className="toggle-row">
      <span className="toggle-copy">
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </span>
      <button
        type="button"
        className={`toggle ${checked ? 'on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}

export function SliderField({
  label,
  value,
  minimum,
  maximum,
  step,
  onChange,
  format,
}: {
  label: string
  value: number
  minimum: number
  maximum: number
  step: number
  onChange: (value: number) => void
  /**
   * Come mostrare il valore accanto al cursore.
   *
   * Il default arrotonda a due decimali quando il passo e' piccolo, e va bene per
   * temperature e top-p. Per la dimensione della UI darebbe "1.00", che e' vero e non
   * dice niente: un fattore si legge in percentuale, quindi chi chiama questo slider
   * passa la sua formattazione e non viene ricostruita qui dentro.
   */
  format?: (value: number) => string
}) {
  const id = useId()
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className="slider-row">
        <input
          id={id}
          type="range"
          min={minimum}
          max={maximum}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <span className="slider-value">{format ? format(value) : value.toFixed(step < 0.1 ? 2 : 0)}</span>
      </div>
    </div>
  )
}
