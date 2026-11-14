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

  if (url.pathname === WEBHOOK) {
    return handleWebhook(request, token, secret, ctx);
  } else if (url.pathname === '/registerWebhook') {
    return registerWebhook(url, token, secret, WEBHOOK);
  } else if (url.pathname === '/unRegisterWebhook') {
    return unRegisterWebhook(token);
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
  ctx: ExecutionContext
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
    ctx.waitUntil(onUpdate(update, token));
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
export async function onUpdate(update: TelegramUpdate, token: string): Promise<void> {
  if (update.message) {
    await onMessage(update.message, token);
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
  token: string
): Promise<TelegramApiResponse | undefined> {
  console.log('Received message:', message);
  let replyText = '';

  try {
    if (message.document) {
      const fileId = message.document.file_id;
      const fileData = await getFile(token, fileId);

      if (fileData.ok && fileData.result?.file_path) {
        const fileUrl = getFileDownloadUrl(token, fileData.result.file_path);
        replyText = `Here is your file: ${fileUrl}`;
      } else {
        replyText = 'Sorry, could not retrieve the file details from Telegram.';
      }
    } else if (message.text) {
      const trimmed = message.text.trim();
      const lower = trimmed.toLowerCase();
      const chatId = message.chat?.id;

      if (lower === '/start' || lower === '/help') {
        replyText = [
          'Welcome to the Bhagavad Gita & Utility Bot! 🙏',
          '',
          'Available commands & features:',
          '• /getSlok - Select a chapter and verse interactively',
          '• /getSlok <chapter> <verse> - Direct lookup (e.g. /getSlok 2 47)',
          '• /randomSlok - Get a random Bhagavad Gita slok with translations',
          '• Send "2 47" or "chapter 2 verse 47" anytime to read a slok',
          '• Send any document/file to get its direct Telegram download link',
          '',
          'Hare Krishna! 🌸',
        ].join('\n');
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
