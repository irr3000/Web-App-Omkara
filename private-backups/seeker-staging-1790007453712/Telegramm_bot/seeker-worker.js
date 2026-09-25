import {transaction} from '../db.js';
import {check,problem} from '../security.js';
import {telegramAPI} from './telegram-api.js';
import {seekerDialog,privateMessage} from './seeker-dialog.js';

export async function downloadReceipt(file,{botToken,request,fetcher=fetch}){
 check(file?.file_id,'Отправьте фотографию или документ.');
 check(!file.file_size||file.file_size<=8388608,'Размер чека превышает 8 МБ.');
 let metadata;try{metadata=await request('getFile',{file_id:file.file_id});}catch(error){if(error.permanent)throw problem(400,'Не удалось получить файл. Отправьте чек повторно.');throw error;}
 check(metadata.file_path&&/^[a-zA-Z0-9_./-]+$/.test(metadata.file_path)&&!metadata.file_path.split('/').includes('..'),'Не удалось получить файл. Отправьте его повторно.');
 check(!metadata.file_size||metadata.file_size<=8388608,'Размер чека превышает 8 МБ.');
 let response;
 try{response=await fetcher(`https://api.telegram.org/file/bot${botToken}/${metadata.file_path}`,{redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw problem(503,'Не удалось загрузить чек. Повторите отправку.');}
 check(response.ok,'Не удалось загрузить чек. Повторите отправку.',503);
 if(Number(response.headers.get('content-length'))>8388608){await response.body.cancel();throw problem(400,'Размер чека превышает 8 МБ.');}
 const chunks=[];let size=0;
 for await(const chunk of response.body){size+=chunk.length;check(size<=8388608,'Размер чека превышает 8 МБ.');chunks.push(chunk);}
 return Buffer.concat(chunks);
}
function splitReply(reply){
 if(!reply)return [];
 const parts=[];let text=reply.text;
 while(text.length>3500){let end=text.lastIndexOf('\n',3500);if(end<1000)end=3500;if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;parts.push({chat_id:reply.chat_id,text:text.slice(0,end)});text=text.slice(end);}
 parts.push({...reply,text});return parts;
}
export function seekerWorker({db,botToken,origin,request=telegramAPI(botToken),fetcher=fetch}){
 let busy=false;
 async function tick(){
  if(busy)return;busy=true;let item;
  try{
   item=await transaction(db,async c=>{
    // Preserve each person's dialogue order, including while a preceding update is leased.
    const row=(await c.query(`SELECT u.* FROM telegram_updates u WHERE u.processed=false AND u.available_at<=now()
      AND NOT EXISTS(SELECT 1 FROM telegram_updates p WHERE p.processed=false AND p.update_id<u.update_id
       AND COALESCE(p.payload#>>'{message,from,id}',p.payload#>>'{callback_query,from,id}')=COALESCE(u.payload#>>'{message,from,id}',u.payload#>>'{callback_query,from,id}'))
      ORDER BY u.update_id FOR UPDATE OF u SKIP LOCKED LIMIT 1`)).rows[0];
    if(row)await c.query("UPDATE telegram_updates SET available_at=now()+interval '120 seconds',attempts=attempts+1 WHERE update_id=$1",[row.update_id]);return row;
   });
   if(item){
    const m=privateMessage(item.payload);let receipt,receiptError,limited=false;
    if(!item.handled&&m){
     const rate=(await db.query("INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING hits",['telegram:'+m.from.id])).rows[0];
     limited=rate.hits>40;
     const file=m.document||m.photo?.at(-1);
     const state=(await db.query('SELECT state FROM telegram_dialogs WHERE telegram_id=$1 AND expires_at>now()',[String(m.from.id)])).rows[0]?.state;
     if(file&&state?.step==='receipt'&&!limited){
      try{receipt=await downloadReceipt(file,{botToken,request,fetcher});}catch(error){if(!error.status)throw error;receiptError=error;}
     }
    }
    if(item.payload.callback_query?.id)try{await request('answerCallbackQuery',{callback_query_id:item.payload.callback_query.id});}catch{/* Expired callbacks still navigate. */}
    let replies=await transaction(db,async c=>{
     const locked=(await c.query('SELECT * FROM telegram_updates WHERE update_id=$1 FOR UPDATE',[item.update_id])).rows[0];
     if(locked.handled)return locked.reply||[];
     await c.query('SAVEPOINT dialogue');let reply;
     try{reply=limited?{chat_id:String(m.from.id),text:'Слишком много запросов. Подождите минуту и повторите действие.'}:await seekerDialog(c,item.payload,{origin,receipt,receiptError});}
     catch(error){await c.query('ROLLBACK TO SAVEPOINT dialogue');if(!error.status||error.status>=500)throw error;reply=m?{chat_id:String(m.from.id),text:error.message}:null;}
     const parts=splitReply(reply);
     await c.query('UPDATE telegram_updates SET handled=true,reply=$2 WHERE update_id=$1',[item.update_id,JSON.stringify(parts)]);return parts;
    });
    while(replies.length){await request('sendMessage',replies[0]);replies=replies.slice(1);await db.query('UPDATE telegram_updates SET reply=$2 WHERE update_id=$1',[item.update_id,JSON.stringify(replies)]);}
    await db.query("UPDATE telegram_updates SET processed=true,payload='{}',reply=NULL WHERE update_id=$1",[item.update_id]);
   }
  }catch(error){
   if(item)await db.query(`UPDATE telegram_updates SET available_at=now()+($2*interval '1 second'),processed=$3,payload=CASE WHEN $3 THEN '{}'::jsonb ELSE payload END,reply=CASE WHEN $3 THEN NULL ELSE reply END WHERE update_id=$1`,[item.update_id,Math.max(5,Math.min(3600,Number(error.retryAfter)||30)),!!error.permanent]).catch(()=>{});
   console.error('Telegram seeker update deferred.');
  }finally{busy=false;}
 }
 let notifying=false;
 async function notify(){
  if(notifying)return;notifying=true;let item;
  try{
   item=await transaction(db,async c=>{const row=(await c.query("SELECT * FROM telegram_notifications WHERE state='pending' AND available_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(row)await c.query("UPDATE telegram_notifications SET available_at=now()+interval '60 seconds',attempts=attempts+1 WHERE id=$1",[row.id]);return row;});
   if(!item)return;
   const payload={chat_id:item.chat_id,text:item.text,reply_markup:{inline_keyboard:[[{text:'Открыть заявку',callback_data:'request:'+item.registration_id}]]}};
   await request('sendMessage',payload);await db.query("UPDATE telegram_notifications SET state='sent',text='' WHERE id=$1",[item.id]);
  }catch(error){if(item)await db.query("UPDATE telegram_notifications SET available_at=now()+($2*interval '1 second'),state=$3 WHERE id=$1",[item.id,Math.max(30,Math.min(3600,Number(error.retryAfter)||300)),error.permanent?'failed':'pending']).catch(()=>{});console.error('Telegram notification deferred.');}
  finally{notifying=false;}
 }
 return {tick,notify,start(){const timer=setInterval(()=>{void tick();void notify();},2000);timer.unref();return ()=>clearInterval(timer);}};
}
