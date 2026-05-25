import { env } from '@/lib/env'

export const EMBEDDING_DIM = 1024 // jina-clip-v2

export interface Embedder {
  embedImage(image: Buffer): Promise<number[]>
  embedText(text: string): Promise<number[]>
}

class JinaEmbedder implements Embedder {
  private async call(input: object[]): Promise<number[]> {
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.JINA_API_KEY}`,
      },
      body: JSON.stringify({ model: 'jina-clip-v2', input }),
    })
    if (!res.ok) throw new Error(`Embedding API ${res.status}: ${await res.text()}`)
    const json = (await res.json()) as { data: { embedding: number[] }[] }
    return json.data[0].embedding
  }
  embedImage(image: Buffer) {
    return this.call([{ image: image.toString('base64') }])
  }
  embedText(text: string) {
    return this.call([{ text }])
  }
}

let singleton: Embedder | null = null
export function getEmbedder(): Embedder {
  if (!singleton) singleton = new JinaEmbedder()
  return singleton
}
