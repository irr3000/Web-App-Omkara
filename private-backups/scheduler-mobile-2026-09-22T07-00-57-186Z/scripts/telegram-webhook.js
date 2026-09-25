import {telegramAPI} from '../Telegramm_bot/telegram-api.js';
const {TELEGRAM_BOT_TOKEN,TELEGRAM_WEBHOOK_SECRET,APP_ORIGIN}=process.env;
if(!TELEGRAM_BOT_TOKEN||!/^[-\w]{1,256}$/.test(TELEGRAM_WEBHOOK_SECRET||'')||!APP_ORIGIN?.startsWith('https://'))throw Error('Configure Telegram token, valid webhook secret and HTTPS APP_ORIGIN.');
const call=telegramAPI(TELEGRAM_BOT_TOKEN);
await call('setWebhook',{url:new URL('/telegram/webhook',APP_ORIGIN).href,secret_token:TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message','callback_query'],drop_pending_updates:false});
const info=await call('getWebhookInfo',{});
console.log(JSON.stringify({url:info.url,pending_updates:info.pending_update_count,has_error:!!info.last_error_message}));
