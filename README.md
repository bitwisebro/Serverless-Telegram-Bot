# Telegram Bot Worker Demo

This repository contains a sample Telegram bot built to run on Cloudflare Workers. The bot serves as a lightweight, serverless application that can be easily deployed and scaled without needing a dedicated server.

## Features

- **Serverless Deployment**: The bot is hosted on Cloudflare Workers, making it highly scalable and cost-efficient.
- **Easy Configuration**: Minimal setup required using `wrangler.toml` for environment variables and worker settings.
- **Lightweight**: Built with minimal dependencies to ensure quick response times and low overhead.

## Prerequisites

- A [Cloudflare account](https://www.cloudflare.com/) with Workers enabled.
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/get-started/) installed for managing and deploying your worker.
- A Telegram bot token from [BotFather](https://core.telegram.org/bots#botfather).

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

3. Deploy to Cloudflare Workers:

   ```bash
   wrangler publish
   ```

## Usage

Once deployed, your bot will be live and can respond to messages sent to your Telegram bot. You can expand its functionality by editing the `src/index.js` file and redeploying.

## Project Structure

- **src/index.js**: Main bot logic and handler functions.
- **wrangler.toml**: Configuration file for Cloudflare Workers deployment.

## Setup

- in index.js file: add TOKEN of your bot received from BotFather
- SECRET: any random string
- after deployment, register webhook in Telegram by hitting this URL: https://your.someworker.workers.dev/registerWebhook
- To remove the webhook and stop bot: https://your.someworker.workers.dev/unRegisterWebhook

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
