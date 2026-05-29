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
    readDimensions: vi.fn(async () => ({ width: 800, height: 600 })),
    updatePhoto: vi.fn(async () => {}),
    classifyFacets: vi.fn(async () => ({ board_type: 'longboard' })),
    indexFacets: vi.fn(async () => {}),
    ...over,
  }
}

function baseDeps() {
  return {
    downloadOriginal: vi.fn(async () => Buffer.from('orig')),
    makePreview: vi.fn(async () => Buffer.from('prev')),
    makeThumb: vi.fn(async () => Buffer.from('thumb')),
    readDimensions: vi.fn(async () => ({ width: 100, height: 80 })),
    uploadPublic: vi.fn(async () => {}),
    embedImage: vi.fn(async () => new Array(4).fill(0.1)),
    indexVector: vi.fn(async () => {}),
    classifyFacets: vi.fn(async () => ({ board_type: 'longboard' })),
    indexFacets: vi.fn(async () => {}),
    updatePhoto: vi.fn(async () => {}),
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

describe('processPhoto + facetas', () => {
  it('clasifica e indexa facetas tras un embedding exitoso', async () => {
    const deps = baseDeps()
    await processPhoto(deps, { id: 'p1', original_path: 'p1/orig.jpg' })
    expect(deps.classifyFacets).toHaveBeenCalledOnce()
    expect(deps.indexFacets).toHaveBeenCalledWith({ board_type: 'longboard' })
  })
  it('si la clasificación falla, la foto igual queda ready (best-effort)', async () => {
    const deps = baseDeps()
    deps.classifyFacets = vi.fn(async () => { throw new Error('openai down') })
    await processPhoto(deps, { id: 'p1', original_path: 'p1/orig.jpg' })
    // ready ya se seteó antes; no se relanza el error
    expect(deps.updatePhoto).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
    expect(deps.indexFacets).not.toHaveBeenCalled()
  })
})
