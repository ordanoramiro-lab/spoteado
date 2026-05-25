import { type Embedder, EMBEDDING_DIM } from './index'

export class FakeEmbedder implements Embedder {
  calls: { kind: 'image' | 'text'; value: unknown }[] = []
  async embedImage(image: Buffer) {
    this.calls.push({ kind: 'image', value: image.length })
    return new Array(EMBEDDING_DIM).fill(0.1)
  }
  async embedText(text: string) {
    this.calls.push({ kind: 'text', value: text })
    return new Array(EMBEDDING_DIM).fill(0.2)
  }
}
