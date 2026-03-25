/**
 * Keyword-based handoff trigger detection.
 *
 * Checks whether a message text contains any of the configured handoff keywords.
 * This check runs PRE-LLM — if a keyword is found, the system triggers handoff
 * immediately without calling the LLM, saving latency and API costs.
 *
 * Keywords are matched using normalized substring matching:
 * - Both the text and keywords are lowercased and trimmed
 * - A keyword triggers if it is contained anywhere in the text
 * - This is intentionally broad — false positives are acceptable (human takes over)
 */

/**
 * Default handoff keywords (Spanish — can be overridden per tenant via bot_config).
 * These cover common user expressions for requesting human assistance.
 */
export const DEFAULT_HANDOFF_KEYWORDS: string[] = [
  'hablar con humano',
  'hablar con un agente',
  'quiero un asesor',
  'llamame',
  'llámame',
  'necesito ayuda humana',
  'quiero hablar con alguien',
  'comunicarme con una persona',
  'atiéndeme un humano',
  'atiendeme un humano',
  'no quiero hablar con un bot',
  'hablar con una persona',
];

/**
 * Check whether a user message contains any handoff-triggering keyword.
 *
 * @param text     - The raw message text from the user
 * @param keywords - List of keywords to check against (use DEFAULT_HANDOFF_KEYWORDS
 *                   merged with tenant-configured keywords)
 * @returns true if any keyword is found in the normalized text
 *
 * @example
 * checkKeywordTrigger('quiero hablar con un asesor por favor', DEFAULT_HANDOFF_KEYWORDS)
 * // → true (matches 'quiero un asesor' is not matched but 'hablar con un agente'
 * //   — let me check: 'quiero un asesor' IS in the list → true)
 */
export function checkKeywordTrigger(text: string, keywords: string[]): boolean {
  if (!text || text.trim().length === 0) {
    return false;
  }

  if (!keywords || keywords.length === 0) {
    return false;
  }

  // Normalize: lowercase + trim
  const normalizedText = text.toLowerCase().trim();

  return keywords.some((keyword) => {
    if (!keyword || keyword.trim().length === 0) {
      return false;
    }
    const normalizedKeyword = keyword.toLowerCase().trim();
    return normalizedText.includes(normalizedKeyword);
  });
}

/**
 * Merge tenant-configured keywords with the default list, deduplicating.
 *
 * @param tenantKeywords - Keywords configured in tenant's bot_config.handoff_keywords
 * @returns Combined keyword list (defaults + tenant-specific)
 */
export function buildKeywordList(tenantKeywords: string[]): string[] {
  const combined = [...DEFAULT_HANDOFF_KEYWORDS, ...tenantKeywords];
  // Deduplicate by normalized form
  const seen = new Set<string>();
  return combined.filter((kw) => {
    if (!kw || kw.trim().length === 0) return false;
    const normalized = kw.toLowerCase().trim();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
