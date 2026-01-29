/**
 * Alias Generator
 * Generates semantic aliases for Kodex topics
 */

import {
  SYNONYMS,
  ABBREVIATIONS,
  MIN_ALIAS_LENGTH,
  MAX_ALIASES,
  CONTENT_KEYWORD_LIMIT,
  STOP_WORDS,
  TopicContent,
  AliasGeneratorOptions,
} from './alias-constants';

// Re-export types and constants for consumers
export type { TopicContent, AliasGeneratorOptions };
export { SYNONYMS, ABBREVIATIONS, MIN_ALIAS_LENGTH, MAX_ALIASES, CONTENT_KEYWORD_LIMIT, STOP_WORDS };

/**
 * Extract keywords from title
 * Split on word boundaries, filter stop words and short words
 */
export function extractTitleKeywords(title: string, minLength: number = MIN_ALIAS_LENGTH): string[] {
  // Step 1 - Lowercase and normalize
  const normalized = title.toLowerCase();

  // Step 2 - Split on whitespace and punctuation
  // Split on any non-word character (excluding numbers which we keep)
  const words = normalized.split(/[\s\-_@#!$%^&*()+=\[\]{};:'",.<>/?\\|`~]+/).filter(w => w.length > 0);

  // Step 3 & 4 - Filter by length and remove stop words
  const keywords = new Set<string>();
  for (const word of words) {
    // Skip if too short
    if (word.length < minLength) continue;
    // Skip if it's a stop word
    if (STOP_WORDS.has(word)) continue;
    // Add to unique set
    keywords.add(word);
  }

  // Step 5 - Return unique words as sorted array
  return Array.from(keywords).sort();
}

/**
 * Extract keywords from content (conceptual + technical sections)
 * Returns top N most frequent keywords
 */
export function extractContentKeywords(
  content: TopicContent,
  limit: number = CONTENT_KEYWORD_LIMIT
): string[] {
  // Step 1 - Combine conceptual and technical sections
  const combinedText = (content.conceptual || '') + ' ' + (content.technical || '');

  // Handle empty content
  if (!combinedText.trim()) {
    return [];
  }

  // Step 2 - Extract and lowercase words
  const normalized = combinedText.toLowerCase();
  const words = normalized.split(/[\s\-_@#!$%^&*()+=\[\]{};:'",.<>/?\\|`~]+/).filter(w => w.length > 0);

  // Step 3 - Count frequency of each word (min length 3)
  const frequencyMap = new Map<string, number>();
  for (const word of words) {
    // Skip short words (less than 3 characters)
    if (word.length < 3) continue;

    // Step 4 - Skip stop words
    if (STOP_WORDS.has(word)) continue;

    // Count frequency
    frequencyMap.set(word, (frequencyMap.get(word) || 0) + 1);
  }

  // Step 5 - Sort by frequency descending
  const sorted = Array.from(frequencyMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  // Step 6 - Return top N words (limited by 'limit' parameter)
  return sorted.slice(0, Math.max(0, limit));
}

/**
 * Expand keyword set with synonyms
 * Modifies the input array in-place (returns array for convenience)
 */
export function expandWithSynonyms(keywords: string[]): string[] {
  const result = new Set(keywords);

  // For each key in SYNONYMS, if it's in keywords, add all its synonyms
  for (const [key, synonyms] of Object.entries(SYNONYMS)) {
    if (result.has(key)) {
      synonyms.forEach(s => result.add(s));
    }
  }

  // For each keyword, check if it matches any synonym value and add the key
  for (const keyword of keywords) {
    for (const [key, synonyms] of Object.entries(SYNONYMS)) {
      if (synonyms.includes(keyword)) {
        result.add(key);
      }
    }
  }

  return Array.from(result).sort();
}

/**
 * Expand keyword set with abbreviations
 * Modifies the input array in-place (returns array for convenience)
 */
export function expandWithAbbreviations(keywords: string[]): string[] {
  const result = new Set(keywords);

  // For each keyword
  for (const keyword of keywords) {
    // If it's a long form, add the abbreviation
    if (ABBREVIATIONS[keyword]) {
      result.add(ABBREVIATIONS[keyword]);
    }
    // If it's an abbreviation, find and add the long form
    for (const [long, short] of Object.entries(ABBREVIATIONS)) {
      if (short === keyword) {
        result.add(long);
      }
    }
  }

  return Array.from(result).sort();
}

/**
 * Main alias generation function
 */
export function generateAliases(
  name: string,
  title: string,
  content?: TopicContent,
  options?: AliasGeneratorOptions
): string[] {
  const opts = {
    maxAliases: options?.maxAliases ?? MAX_ALIASES,
    minAliasLength: options?.minAliasLength ?? MIN_ALIAS_LENGTH,
    includeSynonyms: options?.includeSynonyms ?? true,
    includeAbbreviations: options?.includeAbbreviations ?? true,
    includeContentKeywords: options?.includeContentKeywords ?? false,
  };

  // TODO: Step 1 - Initialize Set for aliases
  // TODO: Step 2 - Extract keywords from title
  // TODO: Step 3 - Expand with synonyms if enabled
  // TODO: Step 4 - Expand with abbreviations if enabled
  // TODO: Step 5 - Extract keywords from content if enabled
  // TODO: Step 6 - Remove canonical name
  // TODO: Step 7 - Slice to max limit
  // TODO: Step 8 - Return sorted array

  throw new Error('Not implemented');
}
