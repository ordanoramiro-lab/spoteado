export type ProcessDeps = {
  downloadOriginal: (path: string) => Promise<Buffer>
  uploadPublic: (path: string, data: Buffer) => Promise<void>
  embedImage: (image: Buffer) => Promise<number[]>
  indexVector: (vector: number[]) => Promise<void>
  makePreview: (original: Buffer) => Promise<Buffer>
  makeThumb: (original: Buffer) => Promise<Buffer>
  updatePhoto: (patch: Record<string, unknown>) => Promise<void>
}
export type PhotoRow = { id: string; original_path: string }
