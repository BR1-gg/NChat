import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  size?: 'default' | 'small'
  icon?: ReactNode
}

export function Button({
  variant = 'default',
  size = 'default',
  icon,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`btn ${variant} ${size} ${className}`.trim()}
    >
      {icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
  danger?: boolean
}

export function IconButton({
  label,
  active = false,
  danger = false,
  className = '',
  children,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`icon-btn ${active ? 'active' : ''} ${danger ? 'danger' : ''} ${className}`.trim()}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}
