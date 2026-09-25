import {timingSafeEqual} from 'node:crypto';
import {transaction} from './db.js';
import {digest} from './security.js';

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
export async function telegramReply(db,update,origin){
 const message=update.message||(update.callback_query?.message?{...update.callback_query.message,from:update.callback_query.from,text:"/menu"}:null);
 if(!message?.from||message.chat?.type!=='private')return null;
 const chatId=String(message.chat.id),telegramId=String(message.from.id),text=String(message.text||'');
 const link=text.match(/^\/start(?:@\w+)? ([a-f0-9]{64})$/);
 if(link){
  const linked=await transaction(db,async c=>{
   const tokenRow=(await c.query('SELECT * FROM telegram_links WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[digest(link[1])])).rows[0];
   if(!tokenRow)return false;
   const owner=(await c.query('SELECT id,telegram_id FROM people WHERE id=$1 FOR UPDATE',[tokenRow.person_id])).rows[0];
   const existing=await c.query('SELECT id FROM people WHERE telegram_id=$1',[telegramId]);
   if((existing.rowCount&&existing.rows[0].id!==owner.id)||(owner.telegram_id&&owner.telegram_id!==telegramId))return false;
   // Retain the short-lived token for an idempotent retry if Telegram delivery fails.
   await c.query('UPDATE people SET telegram_id=$1 WHERE id=$2',[telegramId,owner.id]);return true;
  });
  return {chat_id:chatId,text:linked?'Telegram связан с вашим личным кабинетом. Записи на сайте и в боте используют одну базу.':'Ссылка истекла или кабинет уже связан. Создайте новую ссылку в своей анкете.',reply_markup:{inline_keyboard:[[{text:'Открыть личный кабинет',url:origin+'/#registrations'}]]}};
 }
 const person=(await db.query('SELECT id FROM people WHERE telegram_id=$1',[telegramId])).rows[0];
 const menu={inline_keyboard:[[{text:'Ретриты',url:origin+'/#retreats/open-retreats'},{text:'Встречи',url:origin+'/#meetings'}],[{text:'Мои записи и чеки',url:origin+'/#registrations'}],[{text:'О мастере',url:origin+'/#retreats/about-master'}]]};
 if(/^\/(?:start|menu|retreats|meetings)(?:@\w+)?$/.test(text))return {chat_id:chatId,text:person?'Выберите раздел. Ваши записи и чеки хранятся в общей базе сайта и бота.':'Добро пожаловать. Выберите раздел. Подключить Telegram к кабинету можно в своей анкете на сайте.',reply_markup:menu};
 if(/^\/requests(?:@\w+)?$/.test(text)&&person){
  const result=await db.query('SELECT e.title,r.status FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.person_id=$1 ORDER BY r.created_at DESC LIMIT 10',[person.id]);
  const labels={awaiting_payment:'ожидает оплаты',review:'чек на проверке',confirmed:'участие подтверждено',completed:'завершено',cancelled:'отменено'};
  return {chat_id:chatId,text:result.rows.length?result.rows.map(r=>`${r.title}: ${labels[r.status]}`).join('\n'):'Записей пока нет.',reply_markup:{inline_keyboard:[[{text:'Мои записи',url:origin+'/#registrations'}]]}};
 }
 return {chat_id:chatId,text:person?'Ретриты, встречи и отправка чеков доступны в личном кабинете. Команда /requests показывает ваши записи.':'Добро пожаловать. Откройте сайт для записи на ретриты и встречи. Чтобы связать Telegram с кабинетом, нажмите «Подключить Telegram» в своей анкете.',reply_markup:menu};
}
export function startTelegramWorker({db,botToken,origin}){
 let busy=false;
 async function tick(){if(busy)return;busy=true;let item;
  try{
   item=await transaction(db,async c=>{const row=(await c.query("SELECT * FROM telegram_updates WHERE processed=false AND available_at<=now() ORDER BY update_id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!row)return null;await c.query("UPDATE telegram_updates SET available_at=now()+interval '60 seconds',attempts=attempts+1 WHERE update_id=$1",[row.update_id]);return row;});
   if(!item)return;
   if(item.payload.callback_query?.id){try{const {telegramAPI}=await import("./Telegramm_bot/telegram-api.js");await telegramAPI(botToken)("answerCallbackQuery",{callback_query_id:item.payload.callback_query.id});}catch{}}
   const reply=await telegramReply(db,item.payload,origin);
   if(reply){const response=await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(reply),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!result.ok)throw Error('TELEGRAM_SEND_FAILED');}
   await db.query("UPDATE telegram_updates SET processed=true,payload='{}' WHERE update_id=$1",[item.update_id]);
  }catch{if(item)await db.query("UPDATE telegram_updates SET available_at=now()+interval '5 minutes' WHERE update_id=$1",[item.update_id]).catch(()=>{});console.error('Telegram delivery deferred.');}
  finally{busy=false;}
 }
 const timer=setInterval(tick,2000);timer.unref();return ()=>clearInterval(timer);
}
