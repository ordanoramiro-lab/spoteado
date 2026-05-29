import type { QueryUnderstander, QueryUnderstanding } from './types'

export class FakeUnderstander implements QueryUnderstander {
  calls: string[] = []
  constructor(private result: QueryUnderstanding = { filters: {}, visualQuery: '' }) {}
  async understand(raw: string): Promise<QueryUnderstanding> {
    this.calls.push(raw)
    return this.result
  }
}
