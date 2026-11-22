export interface Env {
  TOKEN?: string;
  SECRET?: string;
  WORKER_URL?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  document?: TelegramDocument;
  caption?: string;
  reply_to_message?: TelegramMessage;
  [key: string]: unknown;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance?: string;
  data?: string;
  game_short_name?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramForceReply {
  force_reply: true;
  input_field_placeholder?: string;
  selective?: boolean;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  [key: string]: unknown;
}

export interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramFileResult {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface VedicSlokAuthor {
  et?: string;
  ht?: string;
  sc?: string;
  hc?: string;
}

export interface VedicSlokResponse {
  _id?: string;
  chapter: number | string;
  verse: number | string;
  slok: string;
  transliteration?: string;
  tej?: VedicSlokAuthor;
  siva?: VedicSlokAuthor;
  purohit?: VedicSlokAuthor;
  chinmay?: VedicSlokAuthor;
  san?: VedicSlokAuthor;
  adi?: VedicSlokAuthor;
  gambir?: VedicSlokAuthor;
  madhav?: VedicSlokAuthor;
  anand?: VedicSlokAuthor;
  rams?: VedicSlokAuthor;
  raman?: VedicSlokAuthor;
  abhinav?: VedicSlokAuthor;
  sankar?: VedicSlokAuthor;
  [key: string]: unknown;
}
