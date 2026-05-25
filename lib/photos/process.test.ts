import { describe, it, expect, vi } from 'vitest'
import { processPhoto } from '@/lib/photos/process'
import type { ProcessDeps, PhotoRow } from '@/lib/photos/types'

function makeDeps(over: Partial<ProcessDeps> = {}): ProcessDeps {
  return {
    downloadOriginal: vi.fn(async () => Buffer.from('orig')),
    uploadPublic: vi.fn(async () => {}),
    embedImage: vi.fn(async () => [0.1, 0.2]),
    indexVector: vi.fn(async () => {}),
    makePreview: vi.fn(async () => Buffer.from('prev')),
    makeThumb: vi.fn(async () => Buffer.from('thumb')),
    updatePhoto: vi.fn(async () => {}),
    ...over,
  }
}
const photo: PhotoRow = { id: 'p1', original_path: 'u1/p1.jpg' }

describe('processPhoto', () => {
  it('procesa, indexa y marca ready', async () => {
    const deps = makeDeps()
    await processPhoto(deps, photo)
    expect(deps.makePreview).toHaveBeenCalled()
    expect(deps.indexVector).toHaveBeenCalledWith([0.1, 0.2])
    const lastPatch = (deps.updatePhoto as any).mock.calls.at(-1)[0]
    expect(lastPatch).toMatchObject({ embedding_status: 'done' })
  })

  it('si falla el embedding, queda ready pero embedding_status=failed', async () => {
    const deps = makeDeps({ embedImage: vi.fn(async () => { throw new Error('down') }) })
    await processPhoto(deps, photo)
    const patches = (deps.updatePhoto as any).mock.calls.map((c: any[]) => c[0])
    const merged = Object.assign({}, ...patches)
    expect(merged.status).toBe('ready')
    expect(merged.embedding_status).toBe('failed')
    expect(deps.indexVector).not.toHaveBeenCalled()
  })

  it('si falla el procesamiento de imagen, marca failed', async () => {
    const deps = makeDeps({ makePreview: vi.fn(async () => { throw new Error('corrupt') }) })
    await expect(processPhoto(deps, photo)).resolves.toBeUndefined()
    const patches = (deps.updatePhoto as any).mock.calls.map((c: any[]) => c[0])
    expect(patches.at(-1)).toMatchObject({ status: 'failed' })
  })
})
