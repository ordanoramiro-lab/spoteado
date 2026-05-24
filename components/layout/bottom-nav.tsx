'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Buscar' },
  { href: '/ranking', label: 'Ranking' },
  { href: '/cart', label: 'Carrito' },
  { href: '/me/photos', label: 'Mis fotos' },
]

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed inset-x-0 bottom-0 flex border-t border-ink/10 bg-canvas md:hidden">
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 py-3 text-center text-xs ${active ? 'text-accent' : 'text-ink/60'}`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
