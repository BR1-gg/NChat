import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from './Button'

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'default',
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'small' | 'default' | 'large'
}) {
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <section className={`dialog ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-header">
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-footer">{footer}</footer> : null}
      </section>
    </div>
  )
}
