# Telegram Bot Worker (TypeScript)

This repository contains a Telegram bot built to run on Cloudflare Workers in TypeScript. The bot serves as a lightweight, serverless application that can be easily deployed and scaled globally without managing servers.

## Features

- **Bhagavad Gita Sloks**:
  - `/getSlok` — Interactive chapter selection with inline buttons for all 18 chapters.
  - `/getSlok <chapter>` — Interactive verse selector for a specific chapter (e.g. `/getSlok 2`).
  - `/getSlok <chapter> <verse>` — Instant lookup of any verse (e.g. `/getSlok 2 47`).
  - **Inline Slok Navigation**: Read sequentially with ◀ Previous Slok / Next Slok ▶ buttons, and easily jump back to chapter verses or all chapters.
  - **Smart Session Memory**: Remembers your active chapter for 30 minutes. Once selected, type just the verse number (e.g. `47`, `verse 47`, `#47`), or reply to any slok message with a verse number.
  - **Natural Text Shortcuts**: Type `2 47`, `2:47`, `2.47`, `2-47`, `chapter 2 verse 47`, or `ch 2 v 47` directly without commands.
  - `/randomSlok` — Get an inspiring random slok with Sanskrit, Hindi, and English translations.
  - `/help` / `/start` — Comprehensive, interactive help menu with quick action buttons.
- **Secure Telegram Document Proxy**: Send any document or file attachment to receive a secure download link. Files are streamed safely through the Cloudflare Worker proxy (`/file/<file_path>`) so your secret bot token is never exposed to users in download URLs.
- **Serverless & Fast**: Built for Cloudflare Workers with fast cold starts and zero server maintenance.
- **Fully Typed in TypeScript**: Strong type safety with Telegram Bot API and Vedic Scriptures API models.
- **Modern Cloudflare Workers Modules**: Uses the modern ES module syntax (`export default { fetch }`) with support for environment secrets (`wrangler secret put`).
- **Tested**: Comprehensive test suite with Vitest and `@cloudflare/vitest-pool-workers`.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A [Cloudflare account](https://www.cloudflare.com/) with Workers enabled
- A Telegram bot token from [@BotFather](https://core.telegram.org/bots#botfather)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/bitwisebro/telegram-bot-worker-demo.git
   cd telegram-bot-worker-demo
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

## Configuration

You can configure your bot token and webhook secret using an `.env` file (loaded natively by Wrangler), Cloudflare Worker secrets, or directly in code:

### Option A: Using `.env` (Recommended for Local Dev & Deploy)

Copy the `.env.example` file to `.env`:

```bash
cp .env.example .env
```

And set your variables:

```env
TOKEN=your_telegram_bot_token_from_botfather
SECRET=your_secret_token_here
```

Wrangler automatically loads `.env` during `wrangler dev` and `wrangler deploy`.

### Option B: Using Wrangler Secrets (Production)

```bash
npx wrangler secret put TOKEN
# Enter your Telegram Bot token when prompted

npx wrangler secret put SECRET
# Enter a secret string (A-Z, a-z, 0-9, _, -) used to verify Telegram webhook requests
```

### Option C: In Code

Edit `src/index.ts`:

```typescript
export const TOKEN = 'YOUR_BOT_TOKEN_HERE';
export const SECRET = 'YOUR_SECRET_TOKEN_HERE';
```

## Available Scripts

- **Typecheck**:
  ```bash
  npm run typecheck
  ```
- **Run Tests**:
  ```bash
  npm test
  ```
- **Local Development**:
  ```bash
  npm run dev
  ```
- **Deploy to Cloudflare Workers**:
  ```bash
  npm run deploy
  ```

## Webhook Registration

Once deployed to Cloudflare Workers:

1. **Register the Webhook**:
   Visit the `/registerWebhook` endpoint on your deployed worker:
   ```text
   https://<your-worker>.<your-subdomain>.workers.dev/registerWebhook
   ```
2. **Unregister the Webhook**:
   To deactivate the webhook:
   ```text
   https://<your-worker>.<your-subdomain>.workers.dev/unRegisterWebhook
   ```

## Project Structure

```text
├── src/
│   ├── index.ts        # Main Worker fetch handler & routing
│   ├── telegram.ts     # Telegram Bot API client & helpers
│   ├── slok.ts         # Bhagavad Gita API integration & formatting
│   └── types.ts        # TypeScript interfaces (Telegram, Slok, Env)
├── test/
│   └── index.spec.ts   # Vitest unit and integration test suite
├── tsconfig.json       # TypeScript configuration
├── wrangler.toml       # Cloudflare Workers configuration
└── vitest.config.js    # Vitest configuration for Cloudflare Workers
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
