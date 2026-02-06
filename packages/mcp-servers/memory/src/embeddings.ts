/**
 * Embeddings Module for Semantic Search
 *
 * Uses OpenAI embeddings for vector similarity search.
 */

import OpenAI from 'openai';

export interface EmbeddingsConfig {
  apiKey?: string;
  model?: string;
}

export class EmbeddingsService {
  private client: OpenAI | null = null;
  private model: string;

  constructor(config: EmbeddingsConfig = {}) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    this.model = config.model ?? 'text-embedding-3-small';

    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    }
  }

  /**
   * Check if embeddings are available
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<number[]> {
    if (!this.client) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });

    return response.data[0].embedding;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });

    return response.data.map(d => d.embedding);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Find most similar vectors from a set
   */
  findSimilar(
    queryVector: number[],
    candidates: Array<{ id: string; vector: number[] }>,
    limit: number = 10,
    minScore: number = 0.5
  ): Array<{ id: string; score: number }> {
    const scored = candidates.map(candidate => ({
      id: candidate.id,
      score: this.cosineSimilarity(queryVector, candidate.vector),
    }));

    return scored
      .filter(s => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Get the model being used
   */
  getModel(): string {
    return this.model;
  }
}

/**
 * Fallback keyword-based similarity for when embeddings are unavailable
 */
export function keywordSimilarity(query: string, content: string): number {
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const contentWords = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  if (queryWords.size === 0) return 0;

  let matches = 0;
  for (const word of queryWords) {
    if (contentWords.has(word)) matches++;
  }

  return matches / queryWords.size;
}
