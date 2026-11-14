import { VedicSlokResponse } from './types';

export const BG_BASE_URL = 'https://vedicscriptures.github.io';

// Number of sloks per chapter in Bhagavad Gita (18 chapters)
export const CHAPTER_VERSE_COUNTS = [
  47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78,
] as const;

/**
 * Returns a random chapter and verse from the Bhagavad Gita.
 */
export function getRandomChapterAndVerse(): { chapter: number; verse: number } {
  // 1 to 18
  const chapter = Math.floor(Math.random() * CHAPTER_VERSE_COUNTS.length) + 1;
  const maxVerse = CHAPTER_VERSE_COUNTS[chapter - 1] ?? 47;
  const verse = Math.floor(Math.random() * maxVerse) + 1;
  return { chapter, verse };
}

/**
 * Formats a random slok path string, e.g. "1/1/"
 */
export function gitaslokid(): string {
  const { chapter, verse } = getRandomChapterAndVerse();
  return `${chapter}/${verse}/`;
}

/**
 * Validates chapter and verse numbers.
 */
export function isValidChapterAndVerse(chapter: number, verse: number): boolean {
  if (isNaN(chapter) || chapter < 1 || chapter > CHAPTER_VERSE_COUNTS.length) {
    return false;
  }
  const maxVerse = CHAPTER_VERSE_COUNTS[chapter - 1];
  if (isNaN(verse) || verse < 1 || verse > maxVerse) {
    return false;
  }
  return true;
}

/**
 * Parses chapter and verse from text formats like "2 47", "2:47", "chapter 2 verse 47", "ch 2 v 47", "2.47".
 */
export function parseChapterAndVerse(text: string): { chapter: number; verse: number } | null {
  const trimmed = text.trim();
  const regex =
    /^(?:(?:chapter|ch)\.?\s*)?(\d+)(?:\s*,\s*)?(?:\s*(?:[:\-\/\.]|(?:verse|slok|sloka|v|s)\.?)\s*|\s+)(\d+)$/i;
  const match = trimmed.match(regex);
  if (match) {
    const chapter = parseInt(match[1], 10);
    const verse = parseInt(match[2], 10);
    if (!isNaN(chapter) && !isNaN(verse)) {
      return { chapter, verse };
    }
  }
  return null;
}

/**
 * Parses a single verse number from text formats like "47", "verse 47", "slok 47", "v 47", "#47".
 */
export function parseVerseOnly(text: string): number | null {
  const trimmed = text.trim();
  const regex = /^(?:(?:verse|slok|sloka|v|s|#)\.?\s*)?(\d+)$/i;
  const match = trimmed.match(regex);
  if (match) {
    const verse = parseInt(match[1], 10);
    if (!isNaN(verse)) {
      return verse;
    }
  }
  return null;
}

/**
 * Fetches slok details from the Vedic Scriptures API.
 */
export async function fetchSlok(chapter: number | string, verse?: number | string): Promise<VedicSlokResponse> {
  const path = verse !== undefined ? `slok/${chapter}/${verse}` : `slok/${chapter}`;
  const response = await fetch(`${BG_BASE_URL}/${path}`, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch slok: HTTP ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as VedicSlokResponse;
}

/**
 * Formats the slok response into a readable message with Hindi and English translations.
 */
export function prepareSlokToSend(res: VedicSlokResponse): string {
  const hindi = res.tej?.ht || 'अनुवाद उपलब्ध नहीं है।';
  const english =
    res.gambir?.et ||
    res.siva?.et ||
    res.purohit?.et ||
    res.san?.et ||
    'Translation not available.';

  return [
    'Here is Bhagwat Geeta Slok you Requested:',
    `Chapter: ${res.chapter}`,
    `Verse: ${res.verse}`,
    `Slok: ${res.slok}`,
    '',
    `Hindi Translation: ${hindi}`,
    '',
    `English Translation: ${english}`,
    '',
    'Hare Krishna!!',
  ].join('\n');
}
