export const TOKEN = "" // Get it from @BotFather https://core.telegram.org/bots#6-botfather
const WEBHOOK = '/'
const SECRET = "" // A-Z, a-z, 0-9, _ and -

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
	console.log(event)
	const url = new URL(event.request.url)
	if (url.pathname === WEBHOOK) {
		event.respondWith(handleWebhook(event))
	} else if (url.pathname === '/registerWebhook') {
		event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
	} else if (url.pathname === '/unRegisterWebhook') {
		event.respondWith(unRegisterWebhook(event))
	} else {
		event.respondWith(new Response('No handler for this request'))
	}
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook(event) {
	// Check secret
	if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
		return new Response('Unauthorized', { status: 403 })
	}
	const update = await event.request.json()
	event.waitUntil(onUpdate(update))
	return new Response('Ok');
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate(update) {
	if ('message' in update) {
		await onMessage(update.message)
	}
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage(message) {
	console.log(message)
	let msg = ""
	const bgBaseUrl = "https://vedicscriptures.github.io";
	if (message.document) {
		const telegramApiUrl = `https://api.telegram.org/bot${TOKEN}`
		const fileId = message.document.file_id
		// Get file path from Telegram
		const fileResponse = await fetch(`${telegramApiUrl}/getFile?file_id=${fileId}`)
		const fileData = await fileResponse.json()
		console.log(fileData)
		const filePath = fileData.result.file_path
		const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`
		msg = `Here is your file: ${fileUrl}`
	} else if (message.text.startsWith("/randomSlok") || message.text.startsWith("/randomslok")) {
		const res = await fetch(`${bgBaseUrl}/slok/${gitaslokid()}`, { redirect: 'follow' })
		let msgObj = await res.json().then(js => JSON.parse(JSON.stringify(js)))
		msg = prepareSlokToSend(msgObj)
	} else if (message.text.startsWith("/getSlok") || message.text.startsWith("/getslok")) {
		let reqChap = message.text.split(' ')[1] || 1
		let reqSlok = message.text.split(' ')[2] || 1
		const res = await fetch(`${bgBaseUrl}/slok/${reqChap}/${reqSlok}`, { redirect: 'follow' })
		let msgObj = await res.json().then(js => JSON.parse(JSON.stringify(js)))
		msg = prepareSlokToSend(msgObj)
	} else {
		msg = "Unsupported one"
	}
	return sendPlainText(message.chat.id, msg)
}

function gitaslokid() {
	const slokcount = [47, 72, 43, 42, 29, 47, 30, 28, 34, 42, 55, 20, 35, 27, 20, 24, 28, 78]
	const chapter = Math.floor(Math.random() * 17) + 1
	const slok = Math.floor(Math.random() * slokcount[chapter - 1]) + 1
	return `${chapter}/${slok}/`
}

function prepareSlokToSend(res) {
	return `Here is Bhagwat Geeta Slok you Requested:  \nChapter: ${res.chapter} \nVerse: ${res.verse} 
Slok: ${res.slok}

Hindi Translation: ${res.tej.ht}

English Translation: ${res.gambir.et}
             
          Hare Krishna!!`
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
export async function sendPlainText(chatId, text) {
	return (await fetch(apiUrl('sendMessage', {
		chat_id: chatId,
		text
	}))).json()
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
	// https://core.telegram.org/bots/api#setwebhook
	const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
	const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
	return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook(event) {
	const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
	return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl(methodName, params = null) {
	let query = ''
	if (params) {
		query = '?' + new URLSearchParams(params).toString()
	}
	return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}