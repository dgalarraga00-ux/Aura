/**
 * Fetch a URL, download its HTML content, and strip tags to get plain text.
 */
export async function parseUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'IAWhatsApp-Ingestion/1.0' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const { load } = await import('cheerio');
  const $ = load(html);

  // Remove noise elements
  $('script, style, nav, footer, header, aside, noscript, iframe').remove();

  // Extract text from body, normalize whitespace
  const rawText = $('body').text();
  return rawText.replace(/\s+/g, ' ').trim();
}
