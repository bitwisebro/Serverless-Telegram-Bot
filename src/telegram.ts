import {
  TelegramApiResponse,
  TelegramFileResult,
  TelegramInlineKeyboardMarkup,
  TelegramForceReply,
} from './types';

/**
 * Builds a URL to call the Telegram Bot API.
 */
export function getTelegramApiUrl(
  token: string,
  methodName: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  const url = new URL(`https://api.telegram.org/bot${token}/${methodName}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * Sends a plain text message to a specific Telegram chat.
 * https://core.telegram.org/bots/api#sendmessage
 */
export async function sendPlainText(
  token: string,
  chatId: number,
  text: string
): Promise<TelegramApiResponse> {
  const url = getTelegramApiUrl(token, 'sendMessage', {
    chat_id: chatId,
    text,
  });
  const res = await fetch(url);
  return (await res.json()) as TelegramApiResponse;
}

/**
 * Sends a message with custom reply markup (e.g. InlineKeyboardMarkup or ForceReply).
 */
export async function sendMessageWithMarkup(
  token: string,
  chatId: number,
  text: string,
  replyMarkup: TelegramInlineKeyboardMarkup | TelegramForceReply
): Promise<TelegramApiResponse> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
    }),
  });
  return (await res.json()) as TelegramApiResponse;
}

/**
 * Answers a callback query to dismiss the button loading spinner.
 * https://core.telegram.org/bots/api#answercallbackquery
 */
export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string
): Promise<TelegramApiResponse> {
  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
  return (await res.json()) as TelegramApiResponse;
}

/**
 * Retrieves file information from Telegram by file_id.
 * https://core.telegram.org/bots/api#getfile
 */
export async function getFile(
  token: string,
  fileId: string
): Promise<TelegramApiResponse<TelegramFileResult>> {
  const url = getTelegramApiUrl(token, 'getFile', { file_id: fileId });
  const res = await fetch(url);
  return (await res.json()) as TelegramApiResponse<TelegramFileResult>;
}

/**
 * Returns the download URL for a file stored on Telegram servers.
 */
export function getFileDownloadUrl(token: string, filePath: string): string {
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

/**
 * Sets the webhook for Telegram to deliver updates to this worker.
 * https://core.telegram.org/bots/api#setwebhook
 */
export async function setWebhook(
  token: string,
  webhookUrl: string,
  secretToken?: string
): Promise<TelegramApiResponse> {
  const params: Record<string, string | undefined> = { url: webhookUrl };
  if (secretToken) {
    params.secret_token = secretToken;
  }
  const url = getTelegramApiUrl(token, 'setWebhook', params);
  const res = await fetch(url);
  return (await res.json()) as TelegramApiResponse;
}

/**
 * Removes the currently registered webhook.
 * https://core.telegram.org/bots/api#deletewebhook
 */
export async function deleteWebhook(token: string): Promise<TelegramApiResponse> {
  const url = getTelegramApiUrl(token, 'setWebhook', { url: '' });
  const res = await fetch(url);
  return (await res.json()) as TelegramApiResponse;
}
