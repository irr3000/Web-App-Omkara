import {transaction} from '../db.js';
import {telegramAPI} from './telegram-api.js';
import {preserveDeletions} from './scheduler-cleanup.js';

export function scheduler({db,botToken,send=telegramAPI(botToken)}){
 let busy=false;
 async function tick(){
  if(busy)return;busy=true;
  try{
   // A crashed or timed-out send cannot safely be retried automatically: Telegram
   // has no idempotency key. Preserve an explicit uncertain state for review.
   await db.query("UPDATE post_deliveries SET state='uncertain',error='Проверьте канал после прерванной отправки.' WHERE state='sending' AND available_at<now()");
   await db.query("DELETE FROM post_photos f USING scheduled_posts p WHERE f.post_id=p.id AND p.expires_at<now() AND NOT EXISTS(SELECT 1 FROM post_deliveries d WHERE d.post_id=p.id AND d.state='sending')");
   await transaction(db,async c=>{
    const posts=(await c.query("SELECT * FROM scheduled_posts WHERE enabled AND status='pending' AND publish_at<=now() ORDER BY publish_at FOR UPDATE SKIP LOCKED LIMIT 10")).rows;
    for(const p of posts){
     if(p.expires_at&&new Date(p.expires_at)<=new Date()){await c.query("UPDATE scheduled_posts SET enabled=false,status='expired' WHERE id=$1",[p.id]);await c.query('DELETE FROM post_photos WHERE post_id=$1',[p.id]);continue;}
     for(const chat of p.channels)await c.query('INSERT INTO post_deliveries(post_id,occurrence,chat_id,delete_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[p.id,p.publish_at,chat,p.expires_at]);
     await c.query("UPDATE scheduled_posts SET status='sending' WHERE id=$1",[p.id]);
    }
   });
   const item=await transaction(db,async c=>{
    const d=(await c.query("SELECT d.* FROM post_deliveries d WHERE state='pending' AND available_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
    if(d)await c.query("UPDATE post_deliveries SET state='sending',attempts=attempts+1,available_at=now()+interval '60 seconds' WHERE id=$1",[d.id]);return d;
   });
   if(item){
    if(item.delete_at&&new Date(item.delete_at)<=new Date())await db.query("UPDATE post_deliveries SET state='failed',error='Срок публикации истёк.' WHERE id=$1",[item.id]);
    else {
     let result;
     try{
      const p=(await db.query('SELECT * FROM scheduled_posts WHERE id=$1',[item.post_id])).rows[0];
      const photo=(await db.query('SELECT mime,content FROM post_photos WHERE post_id=$1',[item.post_id])).rows[0];
      const payload={chat_id:item.chat_id,[photo?'caption':'text']:p.text};if(p.buttons.length)payload.reply_markup={inline_keyboard:p.buttons.map(b=>[b])};
      result=await send(photo?'sendPhoto':'sendMessage',payload,photo);
     }catch(error){await db.query("UPDATE post_deliveries SET state=$2,error=$3,available_at=now()+($4*interval '1 second') WHERE id=$1",[item.id,error.uncertain?'uncertain':error.permanent||item.attempts>=7?'failed':'pending',error.uncertain?'Результат неизвестен: проверьте канал.':error.telegramDescription||'Ошибка Telegram; проверьте права бота и канал.',Math.min(86400,Math.max(30,Number(error.retryAfter)||300))]);}
     if(result)await db.query("UPDATE post_deliveries SET state='sent',message_id=$2,error=NULL WHERE id=$1",[item.id,result.message_id]);
    }
   }
   await transaction(db,async c=>{
    const posts=(await c.query("SELECT * FROM scheduled_posts WHERE status='sending' FOR UPDATE SKIP LOCKED LIMIT 50")).rows;
    for(const p of posts){
     const ds=(await c.query('SELECT chat_id,state,error FROM post_deliveries WHERE post_id=$1 AND occurrence=$2 ORDER BY id',[p.id,p.publish_at])).rows;
     if(!ds.length||ds.some(d=>d.state!=='sent'))continue;
     const step=p.repeat==='daily'?86400000:p.repeat==='weekly'?604800000:0;
     const base=new Date(p.publish_at).getTime();const next=step?new Date(base+(Math.floor(Math.max(0,Date.now()-base)/step)+1)*step):null;
     const again=!!next&&(!p.expires_at||next<new Date(p.expires_at));
     await preserveDeletions(c,p.id);
     await c.query('UPDATE scheduled_posts SET publish_at=COALESCE($2,publish_at),enabled=$3,status=$4,last_result=$5,last_sent_at=now() WHERE id=$1',[p.id,again?next:null,again,again?'pending':'sent',JSON.stringify(ds)]);
     await c.query('DELETE FROM post_deliveries WHERE post_id=$1',[p.id]);
     if(!again)await c.query('DELETE FROM post_photos WHERE post_id=$1',[p.id]);
    }
   });
   // Move old successful deliveries into the independent minimal deletion queue.
   await transaction(db,async c=>{
    await preserveDeletions(c);
    await c.query("DELETE FROM post_deliveries d USING scheduled_posts p WHERE d.post_id=p.id AND d.state='sent' AND (d.occurrence<p.publish_at OR p.status IN ('sent','expired'))");
   });
   // Deletions are idempotent; row lock serializes competing worker processes.
   await transaction(db,async c=>{
    const d=(await c.query("SELECT * FROM scheduler_deletions WHERE delete_at<=now() AND available_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!d)return;
    let removed=false;
    try{await send('deleteMessage',{chat_id:d.chat_id,message_id:d.message_id});removed=true;}
    catch(error){if(/message to delete not found/i.test(error.telegramDescription||''))removed=true;else await c.query("UPDATE scheduler_deletions SET error=$2,available_at=now()+interval '1 hour' WHERE id=$1",[d.id,error.telegramDescription||'Не удалось удалить сообщение: проверьте права и ограничения Telegram.']);}
    if(removed){await c.query('UPDATE post_deliveries SET deleted=true WHERE id=$1',[d.source_delivery_id]);await c.query('DELETE FROM scheduler_deletions WHERE id=$1',[d.id]);}
   });
  }catch{console.error('Telegram scheduler tick failed; retrying later.');}
  finally{busy=false;}
 }
 return {tick,start(){const timer=setInterval(tick,2000);timer.unref();return ()=>clearInterval(timer);}};
}
