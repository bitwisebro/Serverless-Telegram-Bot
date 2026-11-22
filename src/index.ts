import {
  Env,
  TelegramUpdate,
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramApiResponse,
  TelegramInlineKeyboardButton,
} from './types';
import {
  getTelegramApiUrl,
  sendPlainText,
  sendMessageWithMarkup,
  editMessageText,
  answerCallbackQuery,
  getFile,
  getFileDownloadUrl,
  getProxyFileDownloadUrl,
  setWebhook,
  deleteWebhook,
} from './telegram';
import {
  CHAPTER_VERSE_COUNTS,
  gitaslokid,
  getRandomChapterAndVerse,
  fetchSlok,
  prepareSlokToSend,
  isValidChapterAndVerse,
  parseChapterAndVerse,
  parseVerseOnly,
} from './slok';

// Default configuration constants (fallback if not provided in env/.env)
const DEFAULT_TOKEN = '';
const DEFAULT_SECRET = '';
const WEBHOOK = '/';

/**
 * Resolves the bot token, checking Worker environment variables first.
 */
export function getBotToken(env?: Env): string {
  return env?.TOKEN || DEFAULT_TOKEN;
}

/**
 * Resolves the webhook secret, checking Worker environment variables first.
 */
export function getWebhookSecret(env?: Env): string {
  return env?.SECRET || DEFAULT_SECRET;
}

/**
 * Resolves the public base URL of the Worker from incoming request or env.
 */
export function getWorkerBaseUrl(url: URL, env?: Env): string {
  if (env?.WORKER_URL) {
    return env.WORKER_URL.replace(/\/+$/, '');
  }
  const protocol =
    url.host.includes('localhost') || url.host.includes('127.0.0.1')
      ? url.protocol
      : 'https:';
  return `${protocol}//${url.host}`;
}

/**
 * Handles secure file downloads by proxying the request to Telegram servers.
 * This ensures the bot token is never exposed to the client in the download URL,
 * and preserves the original file name in the downloaded file and headers.
 */
export async function handleFileDownload(
  url: URL,
  token: string
): Promise<Response> {
  let filePath = '';
  let customFileName =
    url.searchParams.get('name')?.trim() ||
    url.searchParams.get('filename')?.trim() ||
    '';

  if (url.searchParams.has('path')) {
    filePath = url.searchParams.get('path') || '';
  } else if (url.pathname.startsWith('/file/')) {
    const rawPath = url.pathname.slice('/file/'.length);
    const parts = rawPath.split('/').filter(Boolean);

    // If there are 3 or more segments (e.g. documents/file_0.pdf/original_name.pdf)
    // Telegram file paths have format `<category>/<file_identifier>` (2 parts)
    if (parts.length >= 3) {
      filePath = `${parts[0]}/${parts[1]}`;
      if (!customFileName) {
        customFileName = decodeURIComponent(parts.slice(2).join('/'));
      }
    } else {
      filePath = rawPath;
    }
  }

  filePath = decodeURIComponent(filePath).trim();

  // Basic path validation: reject empty path or path traversal attempts
  if (!filePath || filePath.includes('..') || filePath.startsWith('/')) {
    return new Response('Invalid file path', { status: 400 });
  }

  if (!token) {
    return new Response('Bot token not configured', { status: 500 });
  }

  try {
    const telegramUrl = getFileDownloadUrl(token, filePath);
    const response = await fetch(telegramUrl);

    if (!response.ok) {
      return new Response('Failed to retrieve file from Telegram', {
        status: response.status,
      });
    }

    const headers = new Headers();
    const contentType = response.headers.get('Content-Type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    const contentLength = response.headers.get('Content-Length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    // Determine the filename for Content-Disposition
    const fallbackFileName = filePath.split('/').pop() || 'file';
    const targetFileName = customFileName
      ? customFileName.split(/[/\\]/).pop() || fallbackFileName
      : fallbackFileName;

    const asciiFileName = targetFileName
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\r\n]/g, '_');
    const utf8FileName = encodeURIComponent(targetFileName);

    headers.set(
      'Content-Disposition',
      `attachment; filename="${asciiFileName}"; filename*=UTF-8''${utf8FileName}`
    );

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error('Error proxying file download:', err);
    return new Response('Internal error retrieving file', { status: 500 });
  }
}

/**
 * Handle incoming requests to the Worker.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const token = getBotToken(env);
  const secret = getWebhookSecret(env);
  const workerBaseUrl = getWorkerBaseUrl(url, env);

  if (url.pathname === WEBHOOK) {
    return handleWebhook(request, token, secret, ctx, workerBaseUrl);
  } else if (url.pathname === '/registerWebhook') {
    return registerWebhook(url, token, secret, WEBHOOK);
  } else if (url.pathname === '/unRegisterWebhook') {
    return unRegisterWebhook(token);
  } else if (url.pathname.startsWith('/file/') || url.pathname === '/file') {
    return handleFileDownload(url, token);
  }

  return new Response('No handler for this request', { status: 404 });
}

/**
 * Handle requests to WEBHOOK endpoint.
 * https://core.telegram.org/bots/api#update
 */
export async function handleWebhook(
  request: Request,
  token: string,
  secret: string,
  ctx: ExecutionContext,
  workerBaseUrl?: string
): Promise<Response> {
  // Validate secret token if configured
  if (secret) {
    const receivedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
    if (receivedSecret !== secret) {
      return new Response('Unauthorized', { status: 403 });
    }
  }

  try {
    const update = (await request.json()) as TelegramUpdate;
    ctx.waitUntil(onUpdate(update, token, workerBaseUrl));
    return new Response('Ok', { status: 200 });
  } catch (err) {
    console.error('Error parsing update:', err);
    return new Response('Bad Request', { status: 400 });
  }
}

/**
 * In-memory user session to track the currently selected chapter per chat.
 * Cloudflare Workers isolates retain in-memory state between requests.
 */
export interface UserSession {
  chapter: number;
  updatedAt: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const userSessions = new Map<number, UserSession>();

export function setUserChapter(chatId: number, chapter: number): void {
  userSessions.set(chatId, { chapter, updatedAt: Date.now() });
}

export function getUserChapter(chatId: number): number | undefined {
  const session = userSessions.get(chatId);
  if (!session) return undefined;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    userSessions.delete(chatId);
    return undefined;
  }
  return session.chapter;
}

export function clearUserSession(chatId: number): void {
  userSessions.delete(chatId);
}

/**
 * Creates inline keyboard buttons for the help message.
 */
export function getHelpKeyboard(): TelegramInlineKeyboardButton[][] {
  return [
    [
      {
        text: '📖 Browse Chapters',
        callback_data: 'back_to_chapters',
      },
      {
        text: '🎲 Random Slok',
        callback_data: 'random_slok',
      },
    ],
  ];
}

/**
 * Returns the comprehensive, user-friendly help and usage guide.
 */
export function getHelpMessage(): string {
  return [
    '🙏 Welcome to the Bhagavad Gita & Utility Bot! 🌸',
    '',
    'Explore the timeless wisdom of the Bhagavad Gita with Sanskrit sloks, Hindi and English translations, interactive chapter/verse navigation, and file tools.',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '📖 INTERACTIVE BROWSING',
    '━━━━━━━━━━━━━━━━━━━━',
    '• /getSlok — Open the interactive Chapter picker (Chapters 1–18)',
    '• /getSlok <chapter> — Browse all verses of a chapter (e.g. /getSlok 2)',
    '• Tap any verse button to instantly view the slok with translations',
    '• Slok Navigation: Use ◀ Previous Slok / Next Slok ▶ to read sequentially, or jump back to chapter/all chapters anytime',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '🔍 DIRECT SLOK LOOKUP',
    '━━━━━━━━━━━━━━━━━━━━',
    '• /getSlok <chapter> <verse> — Direct lookup (e.g. /getSlok 2 47)',
    '• Natural text formats (no command needed!):',
    '  - "2 47"',
    '  - "2:47" or "2.47" or "2-47"',
    '  - "chapter 2 verse 47" or "ch 2 v 47"',
    '  - "ch 2, slok 47"',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '🧠 ACTIVE CHAPTER MEMORY',
    '━━━━━━━━━━━━━━━━━━━━',
    '• The bot remembers your selected chapter for 30 minutes!',
    '• Once you select or read a chapter, simply type the verse number:',
    '  - "47", "verse 47", "slok 47", or "#47"',
    '• You can also reply directly to any slok message with a verse number',
    '• Send "chapter 2" or "ch 2" to switch chapters and view its verses',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '🎲 RANDOM INSPIRATION',
    '━━━━━━━━━━━━━━━━━━━━',
    '• /randomSlok — Receive an inspiring random slok with full translations',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '📁 FILE UTILITY',
    '━━━━━━━━━━━━━━━━━━━━',
    '• Send any document or file attachment to get a secure download link',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
    '❓ COMMANDS',
    '━━━━━━━━━━━━━━━━━━━━',
    '• /help or /start — Show this guide',
    '• /getSlok — Chapter selector',
    '• /randomSlok — Random slok',
    '',
    'Hare Krishna! 🕉️✨',
  ].join('\n');
}

/**
 * Creates inline keyboard buttons for chapters 1 through 18.
 */
export function getChapterKeyboard(): TelegramInlineKeyboardButton[][] {
  const keyboard: TelegramInlineKeyboardButton[][] = [];
  let row: TelegramInlineKeyboardButton[] = [];

  for (let ch = 1; ch <= 18; ch++) {
    row.push({
      text: `Ch ${ch}`,
      callback_data: `ch_${ch}`,
    });

    // 4 buttons per row (last row has 2)
    if (row.length === 4 || ch === 18) {
      keyboard.push(row);
      row = [];
    }
  }

  return keyboard;
}

/**
 * Creates inline keyboard buttons for all verses in a given chapter.
 */
export function getVerseKeyboard(chapter: number): TelegramInlineKeyboardButton[][] {
  const maxVerse = CHAPTER_VERSE_COUNTS[chapter - 1] ?? 47;
  const keyboard: TelegramInlineKeyboardButton[][] = [];
  let row: TelegramInlineKeyboardButton[] = [];

  for (let v = 1; v <= maxVerse; v++) {
    row.push({
      text: `${v}`,
      callback_data: `v_${chapter}_${v}`,
    });

    // 6 buttons per row
    if (row.length === 6 || v === maxVerse) {
      keyboard.push(row);
      row = [];
    }
  }

  // Back to Chapters button
  keyboard.push([
    {
      text: '« Back to Chapters',
      callback_data: 'back_to_chapters',
    },
  ]);

  return keyboard;
}

/**
 * Creates inline keyboard buttons for navigating a displayed slok.
 */
export function getSlokKeyboard(
  chapter: number,
  verse: number
): TelegramInlineKeyboardButton[][] {
  const maxVerse = CHAPTER_VERSE_COUNTS[chapter - 1] ?? 47;
  const keyboard: TelegramInlineKeyboardButton[][] = [];

  const navRow: TelegramInlineKeyboardButton[] = [];
  if (verse > 1) {
    navRow.push({
      text: `◀ Slok ${verse - 1}`,
      callback_data: `v_${chapter}_${verse - 1}`,
    });
  }
  if (verse < maxVerse) {
    navRow.push({
      text: `Slok ${verse + 1} ▶`,
      callback_data: `v_${chapter}_${verse + 1}`,
    });
  }
  if (navRow.length > 0) {
    keyboard.push(navRow);
  }

  keyboard.push([
    {
      text: `« Back to Chapter ${chapter} Verses`,
      callback_data: `ch_${chapter}`,
    },
  ]);

  keyboard.push([
    {
      text: '« Back to All Chapters',
      callback_data: 'back_to_chapters',
    },
  ]);

  return keyboard;
}

/**
 * Handle incoming Update.
 * https://core.telegram.org/bots/api#update
 */
export async function onUpdate(
  update: TelegramUpdate,
  token: string,
  workerBaseUrl?: string
): Promise<void> {
  if (update.message) {
    await onMessage(update.message, token, workerBaseUrl);
  } else if (update.callback_query) {
    await onCallbackQuery(update.callback_query, token);
  }
}

/**
 * Handle incoming CallbackQuery (when user clicks an inline button).
 * https://core.telegram.org/bots/api#callbackquery
 */
export async function onCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  token: string
): Promise<void> {
  await answerCallbackQuery(token, callbackQuery.id);

  const data = callbackQuery.data;
  const chatId = callbackQuery.message?.chat.id;
  const messageId = callbackQuery.message?.message_id;
  if (!chatId || !data) return;

  if (data === 'back_to_chapters') {
    const text = 'Please select a Bhagavad Gita Chapter:';
    const markup = { inline_keyboard: getChapterKeyboard() };
    if (messageId) {
      await editMessageText(token, chatId, messageId, text, markup);
    } else {
      await sendMessageWithMarkup(token, chatId, text, markup);
    }
    return;
  }

  if (data === 'random_slok') {
    const { chapter, verse } = getRandomChapterAndVerse();
    try {
      const slokData = await fetchSlok(chapter, verse);
      const replyText = prepareSlokToSend(slokData);
      const markup = { inline_keyboard: getSlokKeyboard(chapter, verse) };
      if (messageId) {
        await editMessageText(token, chatId, messageId, replyText, markup);
      } else {
        await sendMessageWithMarkup(token, chatId, replyText, markup);
      }
    } catch (err) {
      console.error('Error fetching random slok:', err);
      const errorText = 'Sorry, could not fetch random slok. Please try again.';
      if (messageId) {
        await editMessageText(token, chatId, messageId, errorText);
      } else {
        await sendPlainText(token, chatId, errorText);
      }
    }
    return;
  }

  if (data === 'help') {
    const helpText = getHelpMessage();
    const markup = { inline_keyboard: getHelpKeyboard() };
    if (messageId) {
      await editMessageText(token, chatId, messageId, helpText, markup);
    } else {
      await sendMessageWithMarkup(token, chatId, helpText, markup);
    }
    return;
  }

  if (data.startsWith('ch_')) {
    const chapterNum = parseInt(data.replace('ch_', ''), 10);
    const maxVerse = CHAPTER_VERSE_COUNTS[chapterNum - 1] ?? 47;

    // Save selected chapter in session
    setUserChapter(chatId, chapterNum);

    const text = `Selected Chapter ${chapterNum} (${maxVerse} verses).\nTap a verse below or type the verse number (1-${maxVerse}):`;
    const markup = { inline_keyboard: getVerseKeyboard(chapterNum) };
    if (messageId) {
      await editMessageText(token, chatId, messageId, text, markup);
    } else {
      await sendMessageWithMarkup(token, chatId, text, markup);
    }
    return;
  }

  if (data.startsWith('v_')) {
    const parts = data.split('_');
    const chapter = parseInt(parts[1], 10);
    const verse = parseInt(parts[2], 10);

    if (isValidChapterAndVerse(chapter, verse)) {
      try {
        const slokData = await fetchSlok(chapter, verse);
        const replyText = prepareSlokToSend(slokData);
        const markup = { inline_keyboard: getSlokKeyboard(chapter, verse) };
        if (messageId) {
          await editMessageText(token, chatId, messageId, replyText, markup);
        } else {
          await sendMessageWithMarkup(token, chatId, replyText, markup);
        }
      } catch (err) {
        console.error('Error fetching slok:', err);
        const errorText = 'Sorry, could not fetch the requested slok. Please try again.';
        if (messageId) {
          await editMessageText(token, chatId, messageId, errorText);
        } else {
          await sendPlainText(token, chatId, errorText);
        }
      }
    }
    return;
  }
}

/**
 * Handle incoming Message.
 * https://core.telegram.org/bots/api#message
 */
export async function onMessage(
  message: TelegramMessage,
  token: string,
  workerBaseUrl?: string
): Promise<TelegramApiResponse | undefined> {
  console.log('Received message:', message);
  let replyText = '';

  try {
    if (message.document) {
      const fileId = message.document.file_id;
      const originalFileName = message.document.file_name;
      const fileData = await getFile(token, fileId);

      if (fileData.ok && fileData.result?.file_path) {
        const filePath = fileData.result.file_path;
        const fileUrl = getProxyFileDownloadUrl(
          workerBaseUrl || '',
          filePath,
          originalFileName
        );
        replyText = `Here is your file: ${fileUrl}`;
      } else {
        replyText = 'Sorry, could not retrieve the file details from Telegram.';
      }
    } else if (message.text) {
      const trimmed = message.text.trim();
      const lower = trimmed.toLowerCase();
      const chatId = message.chat?.id;

      if (lower === '/start' || lower === '/help') {
        const helpText = getHelpMessage();
        if (chatId) {
          return sendMessageWithMarkup(token, chatId, helpText, {
            inline_keyboard: getHelpKeyboard(),
          });
        }
        replyText = helpText;
      } else if (lower.startsWith('/randomslok')) {
        const { chapter, verse } = getRandomChapterAndVerse();
        const slokData = await fetchSlok(chapter, verse);
        replyText = prepareSlokToSend(slokData);
      } else if (lower.startsWith('/getslok')) {
        const parts = trimmed.split(/\s+/);
        // If user just sent "/getSlok" with no arguments, prompt with chapter buttons
        if (parts.length === 1) {
          if (chatId) {
            return sendMessageWithMarkup(token, chatId, 'Please select a Bhagavad Gita Chapter:', {
              inline_keyboard: getChapterKeyboard(),
            });
          }
          return;
        }

        if (parts.length === 2) {
          const num = parseInt(parts[1], 10);
          // If valid chapter (1-18), show verses for that chapter
          if (!isNaN(num) && num >= 1 && num <= 18) {
            if (chatId) {
              setUserChapter(chatId, num);
              const maxVerse = CHAPTER_VERSE_COUNTS[num - 1] ?? 47;
              return sendMessageWithMarkup(
                token,
                chatId,
                `Selected Chapter ${num} (${maxVerse} verses).\nTap a verse below or type the verse number (1-${maxVerse}):`,
                {
                  inline_keyboard: getVerseKeyboard(num),
                }
              );
            }
            return;
          }

          // If num > 18, check if user already had a chapter selected
          const activeChapter = chatId ? getUserChapter(chatId) : undefined;
          if (activeChapter && isValidChapterAndVerse(activeChapter, num)) {
            const slokData = await fetchSlok(activeChapter, num);
            replyText = prepareSlokToSend(slokData);
          } else {
            replyText = `Invalid chapter number "${parts[1]}". Bhagavad Gita has 18 chapters. Please provide a chapter between 1 and 18 (e.g. /getSlok 2 47).`;
          }
        } else {
          // 2 or more arguments: chapter and verse
          const chapter = parseInt(parts[1] || '1', 10);
          const verse = parseInt(parts[2] || '1', 10);

          if (!isValidChapterAndVerse(chapter, verse)) {
            replyText = `Invalid chapter or verse. Please enter a valid chapter (1-18) and verse number (e.g. /getSlok 2 47).`;
          } else {
            if (chatId) setUserChapter(chatId, chapter);
            const slokData = await fetchSlok(chapter, verse);
            replyText = prepareSlokToSend(slokData);
          }
        }
      } else {
        // Check if message is chapter + verse (e.g. "2 47", "chapter 2 verse 47", "2:47", "2.47")
        const chAndVerse = parseChapterAndVerse(trimmed);
        if (chAndVerse) {
          if (isValidChapterAndVerse(chAndVerse.chapter, chAndVerse.verse)) {
            if (chatId) setUserChapter(chatId, chAndVerse.chapter);
            const slokData = await fetchSlok(chAndVerse.chapter, chAndVerse.verse);
            replyText = prepareSlokToSend(slokData);
          } else {
            const maxVerse = CHAPTER_VERSE_COUNTS[chAndVerse.chapter - 1];
            if (!maxVerse) {
              replyText = `Invalid chapter ${chAndVerse.chapter}. Please enter a chapter between 1 and 18.`;
            } else {
              replyText = `Invalid verse ${chAndVerse.verse} for Chapter ${chAndVerse.chapter}. Please enter a verse between 1 and ${maxVerse}.`;
            }
          }
        } else {
          // Check if message is a verse number or verse expression (e.g. "47", "verse 47", "slok 47")
          const verseOnly = parseVerseOnly(trimmed);
          if (verseOnly !== null) {
            // Determine chapter from:
            // 1. reply_to_message if present
            // 2. stored session for this chat
            let chapter: number | undefined;

            if (message.reply_to_message?.text) {
              const match = message.reply_to_message.text.match(/Chapter (\d+)/i);
              if (match) {
                chapter = parseInt(match[1], 10);
              }
            }

            if (!chapter && chatId) {
              chapter = getUserChapter(chatId);
            }

            if (chapter) {
              if (isValidChapterAndVerse(chapter, verseOnly)) {
                const slokData = await fetchSlok(chapter, verseOnly);
                replyText = prepareSlokToSend(slokData);
              } else {
                const maxVerse = CHAPTER_VERSE_COUNTS[chapter - 1] ?? 47;
                replyText = `Invalid verse number "${verseOnly}" for Chapter ${chapter}. Please provide a number between 1 and ${maxVerse}.`;
              }
            } else {
              // Verse entered but no chapter is known! Guide user and show chapter buttons
              if (chatId) {
                return sendMessageWithMarkup(
                  token,
                  chatId,
                  `You entered verse ${verseOnly}, but no chapter is selected.\nPlease select a chapter below, or type both chapter and verse (e.g. 2 ${verseOnly}):`,
                  {
                    inline_keyboard: getChapterKeyboard(),
                  }
                );
              }
              replyText = `You entered verse ${verseOnly}, but no chapter is selected. Please select a chapter first using /getSlok, or send "chapter verse" (e.g. 2 ${verseOnly}).`;
            }
          } else {
            // Check if user entered just a chapter, e.g. "chapter 2" or "ch 2"
            const chOnlyMatch = trimmed.match(/^(?:chapter|ch)\.?\s*(\d+)$/i);
            if (chOnlyMatch) {
              const chNum = parseInt(chOnlyMatch[1], 10);
              if (chNum >= 1 && chNum <= 18) {
                if (chatId) {
                  setUserChapter(chatId, chNum);
                  const maxVerse = CHAPTER_VERSE_COUNTS[chNum - 1] ?? 47;
                  return sendMessageWithMarkup(
                    token,
                    chatId,
                    `Selected Chapter ${chNum} (${maxVerse} verses).\nTap a verse below or type the verse number (1-${maxVerse}):`,
                    {
                      inline_keyboard: getVerseKeyboard(chNum),
                    }
                  );
                }
              } else {
                replyText = `Invalid chapter "${chNum}". Please choose a chapter between 1 and 18.`;
              }
            } else {
              replyText = 'Unsupported one. Send /help to see available commands.';
            }
          }
        }
      }
    } else {
      replyText = 'Unsupported message type. Send /help to see available commands.';
    }
  } catch (error) {
    console.error('Error handling message:', error);
    replyText = 'Sorry, something went wrong while processing your request.';
  }

  if (message.chat?.id) {
    return sendPlainText(token, message.chat.id, replyText);
  }
}

/**
 * Set webhook to this worker's URL.
 * https://core.telegram.org/bots/api#setwebhook
 */
export async function registerWebhook(
  requestUrl: URL,
  token: string,
  secret: string,
  suffix = WEBHOOK
): Promise<Response> {
  if (!token) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error:
            'Bot TOKEN is missing in production. Please run "npx wrangler secret put TOKEN" to add your token to Cloudflare, or set TOKEN in wrangler.toml [vars].',
        },
        null,
        2
      ),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Always use https for Telegram webhooks (reverse proxies/tunnels may terminate TLS and forward as http)
  const protocol =
    requestUrl.host.includes('localhost') || requestUrl.host.includes('127.0.0.1')
      ? requestUrl.protocol
      : 'https:';
  const webhookUrl = `${protocol}//${requestUrl.host}${suffix}`;
  const res = await setWebhook(token, webhookUrl, secret || undefined);
  return new Response(res.ok ? 'Ok' : JSON.stringify(res, null, 2), {
    status: res.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Remove webhook.
 * https://core.telegram.org/bots/api#deletewebhook
 */
export async function unRegisterWebhook(token: string): Promise<Response> {
  if (!token) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          error:
            'Bot TOKEN is missing in production. Please run "npx wrangler secret put TOKEN" to add your token to Cloudflare, or set TOKEN in wrangler.toml [vars].',
        },
        null,
        2
      ),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const res = await deleteWebhook(token);
  return new Response(res.ok ? 'Ok' : JSON.stringify(res, null, 2), {
    status: res.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Export modern Cloudflare Workers module handler
export default {
  async fetch(
    request: Request,
    env: Env = {},
    ctx: ExecutionContext
  ): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
