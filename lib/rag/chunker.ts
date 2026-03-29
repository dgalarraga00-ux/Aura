export interface ChunkPair {
  parent: string;
  children: string[];
}

export interface ChunkerOptions {
  parentSize?: number;
  childSize?: number;
  minSize?: number;
}

const DEFAULTS = { parentSize: 1000, childSize: 250, minSize: 50 } as const;

// Split text into sentences using common punctuation boundaries.
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Group sentences into chunks of approximately targetSize chars.
function groupIntoChunks(sentences: string[], targetSize: number, minSize: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const wouldExceed = current.length + sentence.length > targetSize;
    if (wouldExceed && current.length >= minSize) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current.trim().length >= minSize) chunks.push(current.trim());
  return chunks;
}

/**
 * Split text into parent-child chunk pairs for two-pass ingestion.
 *
 * Parents (~1000 chars) provide context for the LLM response.
 * Children (~250 chars) are embedded for precise vector retrieval.
 *
 * Boundary-aware: splits on sentence endings rather than raw character count,
 * so chunks never cut mid-sentence.
 */
export function chunkTextSemantic(text: string, options: ChunkerOptions = {}): ChunkPair[] {
  const { parentSize, childSize, minSize } = { ...DEFAULTS, ...options };
  const sentences = splitSentences(text);
  const parents = groupIntoChunks(sentences, parentSize, minSize);

  return parents.map((parent) => {
    const parentSentences = splitSentences(parent);
    const children = groupIntoChunks(parentSentences, childSize, minSize);
    return { parent, children: children.length > 0 ? children : [parent] };
  });
}
