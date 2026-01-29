/**
 * Alias Generator
 * Expands keywords using synonym and abbreviation mappings
 */

import { SYNONYMS, ABBREVIATIONS } from './alias-constants';

/**
 * Expands keywords with their synonyms
 * For each keyword, looks up in SYNONYMS map and adds all synonyms to results
 * Returns unique expanded keywords
 *
 * @param keywords - Array of keywords to expand
 * @returns Array of unique expanded keywords (original + synonyms)
 *
 * @example
 * expandWithSynonyms(['auth', 'user'])
 * // Returns: ['auth', 'authentication', 'login', 'signin', 'user']
 */
export function expandWithSynonyms(keywords: string[]): string[] {
  const expanded = new Set<string>();

  for (const keyword of keywords) {
    // Add the original keyword
    expanded.add(keyword);

    // Look up synonyms for this keyword
    const synonyms = SYNONYMS[keyword];
    if (synonyms) {
      for (const synonym of synonyms) {
        expanded.add(synonym);
      }
    }
  }

  return Array.from(expanded);
}

/**
 * Expands keywords with their abbreviations
 * For each keyword, looks up in ABBREVIATIONS map and adds all abbreviations to results
 * Handles both long forms (expand to short) and short forms (expand to long)
 * Returns unique expanded keywords
 *
 * @param keywords - Array of keywords to expand
 * @returns Array of unique expanded keywords (original + abbreviations)
 *
 * @example
 * expandWithAbbreviations(['authentication'])
 * // Returns: ['authentication', 'auth']
 * expandWithAbbreviations(['auth'])
 * // Returns: ['auth', 'authentication']
 */
export function expandWithAbbreviations(keywords: string[]): string[] {
  const expanded = new Set<string>();

  for (const keyword of keywords) {
    // Add the original keyword
    expanded.add(keyword);

    // Check if this keyword is a long form with an abbreviation
    const abbreviation = ABBREVIATIONS[keyword];
    if (abbreviation) {
      expanded.add(abbreviation);
    }

    // Check if this keyword is an abbreviation for a long form
    for (const [longForm, shortForm] of Object.entries(ABBREVIATIONS)) {
      if (shortForm === keyword) {
        expanded.add(longForm);
        break;
      }
    }
  }

  return Array.from(expanded);
}
