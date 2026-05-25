import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Lightbox } from './lightbox'
import type { PhotoResult } from '@/lib/search/types'

const photo: PhotoResult = {
  id: 'p1', thumbUrl: 't', previewUrl: 'p', price: 1500,
  photographerSlug: 'juan', voteCount: 3, width: 800, height: 600,
}

describe('Lightbox', () => {
  it('muestra precio y botón de carrito', () => {
    render(<Lightbox photo={photo} onClose={() => {}} />)
    expect(screen.getByText(/1500/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agregar/i })).toBeInTheDocument()
  })
  it('llama onClose al cerrar', () => {
    const onClose = vi.fn()
    render(<Lightbox photo={photo} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
