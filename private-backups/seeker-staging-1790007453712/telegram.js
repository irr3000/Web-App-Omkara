import {timingSafeEqual} from 'node:crypto';
import {transaction} from './db.js';
import {seekerDialog} from './Telegramm_bot/seeker-dialog.js';
import {seekerWorker} from './Telegramm_bot/seeker-worker.js';

export function telegramSecretMatches(actual,expected){
 if(!expected||typeof actual!=='string')return false;
 const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
export function installTelegramWebhook(app,{db,secret}){
 app.post('/telegram/webhook',async(req,res)=>{
  if(!telegramSecretMatches(req.get('X-Telegram-Bot-Api-Secret-Token'),secret))return res.sendStatus(403);
  if(!Number.isSafeInteger(req.body?.update_id))return res.sendStatus(400);
  await db.query('INSERT INTO telegram_updates(update_id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING',[req.body.update_id,JSON.stringify(req.body)]);
  res.json({ok:true});
 });
}
export async function telegramReply(db,update,origin){return transaction(db,c=>seekerDialog(c,update,{origin}));}
export function startTelegramWorker(options){return seekerWorker(options).start();}
