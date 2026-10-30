/**
 * Voice Search Query Normalizer & Text Cleaning Utilities (Strictly English)
 * Clean speech-to-text outputs (e.g. English fillers, acoustic noise).
 */

const ENGLISH_FILLER_PHRASES = [
  /\b(please\s+)?search\s+for\b/gi,
  /\b(please\s+)?show\s+me\b/gi,
  /\b(i\s+want\s+to\s+)?buy\b/gi,
  /\bfind\s+me\b/gi,
  /\bcan\s+you\s+find\b/gi,
  /\blooking\s+for\b/gi,
  /\bsearch\b/gi,
  /\bshow\b/gi,
];

/**
 * Normalizes raw English speech text into a clean search query
 * @param {string} rawSpeech 
 * @returns {string} Cleaned search query
 */
export const cleanVoiceQuery = (rawSpeech = '') => {
  if (!rawSpeech || typeof rawSpeech !== 'string') return '';

  let cleaned = rawSpeech.toLowerCase().trim();

  // Strip English filler phrases
  for (const pattern of ENGLISH_FILLER_PHRASES) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  // Remove trailing/leading punctuation
  cleaned = cleaned.replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, ' ');

  // Collapse extra spaces
  return cleaned.replace(/\s+/g, ' ').trim();
};
