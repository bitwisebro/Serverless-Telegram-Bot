import {
  Env,
  TelegramUpdate,
  TelegramMessage,
  TelegramApiResponse,
} from './types';
import {
  getTelegramApiUrl,
  sendPlainText,
  getFile,
  getFileDownloadUrl,
  setWebhook,
  deleteWebhook,
} from './telegram';
import {
  gitaslokid,
  getRandomChapterAndVerse,
  fetchSlok,
  prepareSlokToSend,
  isValidChapterAndVerse,
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
 * Handle incoming Update.
 * https://core.telegram.org/bots/api#update
 */
export async function onUpdate(update: TelegramUpdate, token: string): Promise<void> {
  if (update.message) {
    await onMessage(update.message, token);
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

      if (lower === '/start' || lower === '/help') {
        replyText = [
          'Welcome to the Bhagavad Gita & Utility Bot! 🙏',
          '',
          'Available commands:',
          '• /randomSlok - Get a random Bhagavad Gita slok with translations',
          '• /getSlok <chapter> <verse> - Get a specific slok (e.g. /getSlok 2 47)',
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
        const chapter = parseInt(parts[1] || '1', 10);
        const verse = parseInt(parts[2] || '1', 10);

        if (!isValidChapterAndVerse(chapter, verse)) {
          replyText = `Invalid chapter or verse. Please enter a valid chapter (1-18) and verse number (e.g. /getSlok 2 47).`;
        } else {
          const slokData = await fetchSlok(chapter, verse);
          replyText = prepareSlokToSend(slokData);
        }
      } else {
        replyText = 'Unsupported one. Send /help to see available commands.';
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

  const webhookUrl = `${requestUrl.protocol}//${requestUrl.host}${suffix}`;
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
