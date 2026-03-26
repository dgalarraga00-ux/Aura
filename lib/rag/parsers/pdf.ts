import { createServiceClient } from '@/lib/supabase/service';

/**
 * Fetch and parse a PDF from Supabase Storage.
 * Returns raw extracted text.
 */
export async function parsePdf(storagePath: string, tenantId: string): Promise<string> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.storage
    .from('knowledge')
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download PDF from storage: ${error?.message ?? 'no data'}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());

  // pdf-parse v2 uses a class-based API with named ESM exports
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}
