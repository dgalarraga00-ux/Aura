import { createServiceClient } from '@/lib/supabase/service';

/**
 * Fetch and parse a CSV from Supabase Storage.
 * Converts each row to a plain-text sentence: "field1: value1, field2: value2"
 */
export async function parseCsv(storagePath: string): Promise<string> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.storage
    .from('knowledge')
    .download(storagePath);

  if (error || !data) {
    throw new Error(`Failed to download CSV from storage: ${error?.message ?? 'no data'}`);
  }

  const csvText = await data.text();

  const Papa = (await import('papaparse')).default;
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  // Convert each row to a sentence: "key1: val1, key2: val2"
  const lines = result.data.map((row) =>
    Object.entries(row)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
  );

  return lines.join('\n');
}
