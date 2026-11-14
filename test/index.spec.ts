import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import worker from '../src';
import {
  prepareSlokToSend,
  getRandomChapterAndVerse,
  isValidChapterAndVerse,
  CHAPTER_VERSE_COUNTS,
  parseChapterAndVerse,
  parseVerseOnly,
} from '../src/slok';
import {
  getChapterKeyboard,
  getVerseKeyboard,
  setUserChapter,
  getUserChapter,
  clearUserSession,
  onCallbackQuery,
  onMessage,
} from '../src/index';
import { getTelegramApiUrl, getFileDownloadUrl } from '../src/telegram';
import { VedicSlokResponse } from '../src/types';

describe('Telegram Bot Worker', () => {
  it('returns 404 for unhandled paths', async () => {
    const request = new Request('http://example.com/unknown-route');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('No handler for this request');
  });

  it('rejects webhook requests with 403 if secret is invalid', async () => {
    const request = new Request('http://example.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
      },
      body: JSON.stringify({ update_id: 123 }),
    });

    const ctx = createExecutionContext();
    const testEnv = { ...env, SECRET: 'my-expected-secret' };
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Unauthorized');
  });

  it('accepts webhook requests with 200 if secret matches', async () => {
    const request = new Request('http://example.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'my-secret',
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: 12345, type: 'private' },
          date: 1600000000,
          text: '/help',
        },
      }),
    });

    const ctx = createExecutionContext();
    const testEnv = { ...env, SECRET: 'my-secret', TOKEN: 'mock-token' };

    // Mock fetch for telegram API call
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('api.telegram.org')) {
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
      return originalFetch(url);
    });

    try {
      const response = await worker.fetch(request, testEnv, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('Ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles bad JSON payload with 400', async () => {
    const testSecret = 'test-secret';
    const testEnv = { ...env, SECRET: testSecret };
    const request = new Request('http://example.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': testSecret,
      },
      body: 'invalid-json',
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Bad Request');
  });
});

describe('Slok Utilities', () => {
  it('generates random chapter between 1 and 18 within valid verse bounds', () => {
    for (let i = 0; i < 50; i++) {
      const { chapter, verse } = getRandomChapterAndVerse();
      expect(chapter).toBeGreaterThanOrEqual(1);
      expect(chapter).toBeLessThanOrEqual(18);

      const maxVerse = CHAPTER_VERSE_COUNTS[chapter - 1];
      expect(verse).toBeGreaterThanOrEqual(1);
      expect(verse).toBeLessThanOrEqual(maxVerse);
    }
  });

  it('validates chapter and verse numbers properly', () => {
    expect(isValidChapterAndVerse(1, 1)).toBe(true);
    expect(isValidChapterAndVerse(2, 47)).toBe(true);
    expect(isValidChapterAndVerse(18, 78)).toBe(true);

    // Invalid chapters
    expect(isValidChapterAndVerse(0, 1)).toBe(false);
    expect(isValidChapterAndVerse(19, 1)).toBe(false);

    // Invalid verses
    expect(isValidChapterAndVerse(1, 0)).toBe(false);
    expect(isValidChapterAndVerse(1, 48)).toBe(false); // Chapter 1 has 47 verses
    expect(isValidChapterAndVerse(2, 73)).toBe(false); // Chapter 2 has 72 verses
  });

  it('formats slok message with Hindi and English translations', () => {
    const mockSlok: VedicSlokResponse = {
      chapter: 2,
      verse: 47,
      slok: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।',
      tej: { ht: 'कर्म करने में ही तुम्हारा अधिकार है, फल में कभी नहीं।' },
      gambir: { et: 'You have a right to perform your prescribed duty, but you are not entitled to the fruits of action.' },
    };

    const formatted = prepareSlokToSend(mockSlok);
    expect(formatted).toContain('Chapter: 2');
    expect(formatted).toContain('Verse: 47');
    expect(formatted).toContain('कर्मण्येवाधिकारस्ते');
    expect(formatted).toContain('Hindi Translation:');
    expect(formatted).toContain('English Translation:');
    expect(formatted).toContain('Hare Krishna!!');
  });

  it('generates an inline keyboard for 18 chapters', () => {
    const keyboard = getChapterKeyboard();
    expect(keyboard.length).toBe(5); // 4 + 4 + 4 + 4 + 2 rows = 18 total
    const totalButtons = keyboard.reduce((sum, row) => sum + row.length, 0);
    expect(totalButtons).toBe(18);
    expect(keyboard[0][0]).toEqual({ text: 'Ch 1', callback_data: 'ch_1' });
    expect(keyboard[4][1]).toEqual({ text: 'Ch 18', callback_data: 'ch_18' });
  });

  it('generates verse keyboard for a given chapter with a back button', () => {
    // Chapter 1 has 47 verses
    const kb1 = getVerseKeyboard(1);
    const totalButtons1 = kb1.reduce((sum, row) => sum + row.length, 0);
    expect(totalButtons1).toBe(48); // 47 verses + 1 back button
    expect(kb1[0][0]).toEqual({ text: '1', callback_data: 'v_1_1' });
    expect(kb1[kb1.length - 1][0]).toEqual({
      text: '« Back to Chapters',
      callback_data: 'back_to_chapters',
    });

    // Chapter 2 has 72 verses
    const kb2 = getVerseKeyboard(2);
    const totalButtons2 = kb2.reduce((sum, row) => sum + row.length, 0);
    expect(totalButtons2).toBe(73); // 72 verses + 1 back button
    expect(kb2[0][0]).toEqual({ text: '1', callback_data: 'v_2_1' });
  });

  it('correctly parses chapter and verse from various input formats', () => {
    expect(parseChapterAndVerse('2 47')).toEqual({ chapter: 2, verse: 47 });
    expect(parseChapterAndVerse('2:47')).toEqual({ chapter: 2, verse: 47 });
    expect(parseChapterAndVerse('2, 47')).toEqual({ chapter: 2, verse: 47 });
    expect(parseChapterAndVerse('2.47')).toEqual({ chapter: 2, verse: 47 });
    expect(parseChapterAndVerse('2-47')).toEqual({ chapter: 2, verse: 47 });
    expect(parseChapterAndVerse('chapter 2 verse 47')).toEqual({ chapter: 2, verse: 47 });
    expect(parseChapterAndVerse('ch 2 v 47')).toEqual({ chapter: 2, verse: 47 });
    expect(parseChapterAndVerse('ch. 2, slok 47')).toEqual({ chapter: 2, verse: 47 });

    // Invalid formats
    expect(parseChapterAndVerse('hello')).toBeNull();
    expect(parseChapterAndVerse('47')).toBeNull();
  });

  it('correctly parses single verse input from various formats', () => {
    expect(parseVerseOnly('47')).toBe(47);
    expect(parseVerseOnly('verse 47')).toBe(47);
    expect(parseVerseOnly('slok 47')).toBe(47);
    expect(parseVerseOnly('sloka 47')).toBe(47);
    expect(parseVerseOnly('v 47')).toBe(47);
    expect(parseVerseOnly('#47')).toBe(47);
    expect(parseVerseOnly('s 47')).toBe(47);

    // Invalid single verse
    expect(parseVerseOnly('hello')).toBeNull();
    expect(parseVerseOnly('2 47')).toBeNull();
  });

  it('tracks user chapter sessions per chat', () => {
    const testChatId = 98765;
    clearUserSession(testChatId);
    expect(getUserChapter(testChatId)).toBeUndefined();

    setUserChapter(testChatId, 2);
    expect(getUserChapter(testChatId)).toBe(2);

    setUserChapter(testChatId, 18);
    expect(getUserChapter(testChatId)).toBe(18);

    clearUserSession(testChatId);
    expect(getUserChapter(testChatId)).toBeUndefined();
  });
});

describe('Telegram API Helpers', () => {
  it('constructs correct API URL with query params', () => {
    const url = getTelegramApiUrl('mock-token', 'sendMessage', {
      chat_id: 12345,
      text: 'Hello World',
    });
    expect(url).toBe('https://api.telegram.org/botmock-token/sendMessage?chat_id=12345&text=Hello+World');
  });

  it('constructs correct file download URL', () => {
    const url = getFileDownloadUrl('mock-token', 'documents/file_1.pdf');
    expect(url).toBe('https://api.telegram.org/file/botmock-token/documents/file_1.pdf');
  });
});

describe('Chapter Selection and Slok Retrieval Flow', () => {
  it('handles selecting chapter via callback and then entering slok as plain text without reply_to_message', async () => {
    const testChatId = 55555;
    const testToken = 'mock-token';

    let capturedUrl = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('api.telegram.org')) {
        capturedUrl = urlStr;
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
      if (urlStr.includes('vedicscriptures.github.io/slok/2/47')) {
        return new Response(
          JSON.stringify({
            chapter: 2,
            verse: 47,
            slok: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।',
            tej: { ht: 'कर्म करने में ही तुम्हारा अधिकार है, फल में कभी नहीं।' },
            gambir: { et: 'You have a right to perform your prescribed duty, but you are not entitled to the fruits of action.' },
          })
        );
      }
      return originalFetch(url, init);
    });

    try {
      // Step 1: User clicks Chapter 2 button
      await onCallbackQuery(
        {
          id: 'cb_1',
          from: { id: 111, is_bot: false, first_name: 'Devotee' },
          message: {
            message_id: 10,
            chat: { id: testChatId, type: 'private' },
            date: 1600000000,
          },
          data: 'ch_2',
        },
        testToken
      );

      // Verify that chapter 2 is stored in session
      expect(getUserChapter(testChatId)).toBe(2);

      // Step 2: User enters slok number "47" as plain text (NO reply_to_message!)
      await onMessage(
        {
          message_id: 11,
          chat: { id: testChatId, type: 'private' },
          date: 1600000005,
          text: '47',
        },
        testToken
      );

      // Verify message sent to telegram contains the fetched slok!
      expect(capturedUrl).toContain('sendMessage');
      expect(decodeURIComponent(capturedUrl)).toContain('कर्मण्येवाधिकारस्ते');
    } finally {
      globalThis.fetch = originalFetch;
      clearUserSession(testChatId);
    }
  });

  it('handles clicking verse button directly from inline keyboard and edits existing message', async () => {
    const testChatId = 55556;
    const testToken = 'mock-token';

    let capturedUrl = '';
    let capturedBody = '';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('api.telegram.org')) {
        capturedUrl = urlStr;
        if (init?.body) capturedBody = String(init.body);
        return new Response(JSON.stringify({ ok: true, result: {} }));
      }
      if (urlStr.includes('vedicscriptures.github.io/slok/1/1')) {
        return new Response(
          JSON.stringify({
            chapter: 1,
            verse: 1,
            slok: 'धृतराष्ट्र उवाच',
            tej: { ht: 'धृतराष्ट्र ने कहा' },
            gambir: { et: 'Dhritarashtra said' },
          })
        );
      }
      return originalFetch(url, init);
    });

    try {
      await onCallbackQuery(
        {
          id: 'cb_2',
          from: { id: 112, is_bot: false, first_name: 'Devotee' },
          message: {
            message_id: 20,
            chat: { id: testChatId, type: 'private' },
            date: 1600000000,
          },
          data: 'v_1_1',
        },
        testToken
      );

      expect(capturedUrl).toContain('editMessageText');
      expect(capturedBody).toContain('धृतराष्ट्र उवाच');
      expect(capturedBody).toContain('back_to_chapters');
      expect(capturedBody).toContain('ch_1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
