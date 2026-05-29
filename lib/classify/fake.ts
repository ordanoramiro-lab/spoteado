import type { Classifier, FacetPrediction } from './index'

export class FakeClassifier implements Classifier {
  calls: number[] = []
  constructor(private preds: FacetPrediction[] = [
    { category: 'board_type', value: 'longboard', confidence: 0.95 },
  ]) {}
  async classify(image: Buffer): Promise<FacetPrediction[]> {
    this.calls.push(image.length)
    return this.preds
  }
}
