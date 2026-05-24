import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BottomNav } from './bottom-nav'

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

describe('BottomNav', () => {
  it('muestra las 4 pestañas del surfista', () => {
    render(<BottomNav />)
    expect(screen.getByText('Buscar')).toBeInTheDocument()
    expect(screen.getByText('Ranking')).toBeInTheDocument()
    expect(screen.getByText('Carrito')).toBeInTheDocument()
    expect(screen.getByText('Mis fotos')).toBeInTheDocument()
  })
})
