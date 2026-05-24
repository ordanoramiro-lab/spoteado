import { type ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
}

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  const base = 'rounded-sm px-4 py-2 text-sm transition-colors disabled:opacity-50'
  const variants = {
    primary: 'bg-accent text-canvas hover:opacity-90',
    ghost: 'border border-ink/15 text-ink hover:bg-ink/5',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}
