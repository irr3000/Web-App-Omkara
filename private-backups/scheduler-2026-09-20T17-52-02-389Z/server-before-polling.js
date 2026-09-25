import {database} from './db.js';
import {mailer} from './mail.js';
import {createApp} from './app.js';
import {startTelegramWorker} from './telegram.js';
import {scheduler} from './Telegramm_bot/telegram-scheduler.js';
import {destinations} from './Telegramm_bot/admin-scheduler.js';
const origin=process.env.APP_ORIGIN;
if(!origin)throw new Error('APP_ORIGIN is required.');
const secure=process.env.NODE_ENV==='production';
if(secure&&!origin.startsWith('https://'))throw new Error('Production requires HTTPS.');
const db=database();await db.query('SELECT id FROM people LIMIT 0');
const botToken=process.env.TELEGRAM_BOT_TOKEN,telegramSecret=process.env.TELEGRAM_WEBHOOK_SECRET;
if(Boolean(botToken)!==Boolean(telegramSecret))throw new Error('Configure both Telegram token and webhook secret, or neither.');
let telegramChannels=[];try{telegramChannels=destinations();}catch{console.error('Invalid TELEGRAM_DESTINATIONS: scheduler destinations disabled.');}
const app=createApp({db,mail:mailer(),origin,secure,botUsername:botToken?process.env.TELEGRAM_BOT_USERNAME:'',telegramSecret,ownerEmail:process.env.OWNER_EMAIL||'',telegramChannels,telegramReady:!!botToken});
const stopTelegram=botToken?startTelegramWorker({db,botToken,origin}):()=>{};
const stopScheduler=botToken?scheduler({db,botToken}).start():()=>{};
const server=app.listen(Number(process.env.APP_PORT||3000),process.env.APP_IP||'127.0.0.1',()=>console.log('Omkara application started.'));
const cleanup=setInterval(async()=>{try{await db.query('DELETE FROM sessions WHERE expires_at<now()');await db.query('DELETE FROM email_tokens WHERE expires_at<now()');await db.query('DELETE FROM rate_limits WHERE expires_at<now()');await db.query('DELETE FROM telegram_links WHERE expires_at<now()');}catch{console.error('Scheduled cleanup failed.');}},3600000);cleanup.unref();
async function stop(){clearInterval(cleanup);stopTelegram();stopScheduler();server.close(async()=>{await db.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
