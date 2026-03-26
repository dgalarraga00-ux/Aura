import { parsePdf } from './pdf';
import { parseCsv } from './csv';
import { parseUrl } from './url';

export interface KnowledgeSource {
  id: string;
  source_type: string;
  storage_path: string | null;
  source_url: string | null;
  raw_text: string | null;
}

/**
 * Dispatch to the correct parser based on source_type.
 * Returns raw extracted text ready for chunking.
 */
export async function parseSource(source: KnowledgeSource): Promise<string> {
  switch (source.source_type) {
    case 'pdf': {
      if (!source.storage_path) {
        throw new Error('PDF source is missing storage_path');
      }
      return parsePdf(source.storage_path, '');
    }
    case 'csv': {
      if (!source.storage_path) {
        throw new Error('CSV source is missing storage_path');
      }
      return parseCsv(source.storage_path);
    }
    case 'url': {
      if (!source.source_url) {
        throw new Error('URL source is missing source_url');
      }
      return parseUrl(source.source_url);
    }
    case 'text': {
      if (!source.raw_text) {
        throw new Error('Text source is missing raw_text content');
      }
      return source.raw_text;
    }
    default: {
      throw new Error(`Unsupported source_type: ${source.source_type}`);
    }
  }
}
