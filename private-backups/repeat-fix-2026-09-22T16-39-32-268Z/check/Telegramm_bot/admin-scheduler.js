import {randomUUID} from 'node:crypto';
import {check} from '../security.js';
import {transaction} from '../db.js';
import {installPhotoUploader} from './photo-uploader.js';
import {schedulerChannels} from './scheduler-chats.js';
import {preserveDeletions} from './scheduler-cleanup.js';

export function destinations(raw=process.env.TELEGRAM_DESTINATIONS||'[]'){
 const entries=JSON.parse(raw);check(Array.isArray(entries)&&entries.length<=30,'Некорректные каналы.');
 for(const c of entries)check(typeof c.id==='string'&&/^-?\d+$|^@[A-Za-z0-9_]{5,32}$/.test(c.id)&&typeof c.label==='string'&&c.label.length<=100,'Некорректный канал.');
 return entries;
}
export function postValues(body,channels){
 check(body&&typeof body.text==='string'&&body.text.trim().length>0&&body.text.length<=4096,'Текст — от 1 до 4096 символов.');
 check(['once','daily','weekly'].includes(body.repeat),'Проверьте повтор.');
 check(typeof body.publish_at==='string'&&Number.isFinite(Date.parse(body.publish_at)),'Проверьте дату.');
 check(!body.expires_at||(Number.isFinite(Date.parse(body.expires_at))&&Date.parse(body.expires_at)>Date.parse(body.publish_at)),'Срок публикации должен быть позже даты отправки.');
 check(Array.isArray(body.channels)&&body.channels.length>0&&body.channels.length<=30&&body.channels.every(id=>channels.some(c=>c.id===id)),'Выберите настроенные каналы.');
 check(Array.isArray(body.buttons)&&body.buttons.length<=20,'Не более 20 кнопок.');
 for(const b of body.buttons){check(typeof b.text==='string'&&b.text.trim().length>0&&b.text.length<=64&&typeof b.url==='string'&&b.url.length<=2048,'Проверьте кнопки.');let u;try{u=new URL(b.url);}catch{}check(u&&['http:','https:'].includes(u.protocol)&&!u.username&&!u.password,'Для кнопок разрешены только HTTP(S)-ссылки.');}
 return [body.text,body.publish_at,body.repeat,JSON.stringify([...new Set(body.channels)]),JSON.stringify(body.buttons),body.expires_at||null,body.enabled!==false];
}
export function installSchedulerRoutes(app,options){
 const {db,admin,uuid,channels=[],telegramReady=false}=options;
 app.get('/api/admin/scheduled-posts',admin,async(_req,res)=>res.json({channels:await schedulerChannels(db,channels),telegram_ready:telegramReady,posts:(await db.query('SELECT p.*,EXISTS(SELECT 1 FROM post_photos f WHERE f.post_id=p.id) has_photo FROM scheduled_posts p ORDER BY created_at DESC LIMIT 200')).rows,deliveries:(await db.query('SELECT d.id,d.post_id,d.chat_id,d.state,d.error FROM post_deliveries d JOIN scheduled_posts p ON p.id=d.post_id AND p.publish_at=d.occurrence ORDER BY d.id')).rows,deletion_errors:(await db.query('SELECT chat_id,error FROM scheduler_deletions WHERE error IS NOT NULL ORDER BY id LIMIT 30')).rows}));
 app.post('/api/admin/scheduled-posts',admin,async(req,res)=>{const values=postValues(req.body,await schedulerChannels(db,channels));const result=await db.query('INSERT INTO scheduled_posts(id,text,publish_at,repeat,channels,buttons,expires_at,enabled,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),...values,req.user.id]);res.status(201).json(result.rows[0]);});
 app.patch('/api/admin/scheduled-posts/:id',admin,async(req,res)=>{
  const id=uuid(req.params.id);const updated=await transaction(db,async c=>{
   const p=(await c.query('SELECT * FROM scheduled_posts WHERE id=$1 FOR UPDATE',[id])).rows[0];check(p,'Публикация не найдена.',404);
   check(['pending','sent','expired'].includes(p.status),'Дождитесь завершения текущей отправки или разрешите ошибки доставки.',409);
   if(req.body.expected_updated_at)check(new Date(req.body.expected_updated_at).getTime()===new Date(p.updated_at).getTime(),'Расписание изменилось после открытия строки. Обновите статусы и проверьте новую дату; ваши правки не сохранены.',409);
   if(p.status!=='pending')check(req.body.publish_at&&Date.parse(req.body.publish_at)>Date.now(),'Укажите будущую дату для повторного планирования.',400);
   check(!(await c.query('SELECT 1 FROM post_deliveries WHERE post_id=$1 AND occurrence=$2',[id,p.publish_at])).rowCount,'Отправка уже началась.',409);
   const values=postValues({...p,publish_at:new Date(p.publish_at).toISOString(),...req.body},await schedulerChannels(c,channels));
   if((await c.query('SELECT 1 FROM post_photos WHERE post_id=$1',[id])).rowCount)check(values[0].length<=1024,'Подпись к фото — до 1024 символов.');
   return (await c.query("UPDATE scheduled_posts SET text=$2,publish_at=$3,repeat=$4,channels=$5,buttons=$6,expires_at=$7,enabled=$8,status='pending',updated_at=now() WHERE id=$1 RETURNING *",[id,...values])).rows[0];
  });res.json(updated);
 });
 app.post('/api/admin/scheduled-posts/:id/pause',admin,async(req,res)=>{
  const result=await db.query("UPDATE scheduled_posts SET enabled=false,updated_at=now() WHERE id=$1 AND status='pending' RETURNING id",[uuid(req.params.id)]);
  check(result.rowCount,'Текущая отправка уже началась или завершена.',409);res.json({ok:true});
 });
 app.delete('/api/admin/scheduled-posts/:id',admin,async(req,res)=>{
  await transaction(db,async c=>{
   const id=uuid(req.params.id);check((await c.query('SELECT id FROM scheduled_posts WHERE id=$1 FOR UPDATE',[id])).rowCount,'Публикация не найдена.',404);
   const rows=(await c.query('SELECT state FROM post_deliveries WHERE post_id=$1 FOR UPDATE',[id])).rows;
   check(!rows.some(d=>['sending','uncertain'].includes(d.state)),'Дождитесь окончания отправки; при неизвестном результате сначала проверьте канал и подтвердите доставку.',409);
   await preserveDeletions(c,id);
   await c.query('DELETE FROM post_deliveries WHERE post_id=$1',[id]);
   await c.query('DELETE FROM post_photos WHERE post_id=$1',[id]);
   await c.query("DELETE FROM audit WHERE target_id=$1 AND action='telegram_delivery_resolved'",[id]);
   await c.query('DELETE FROM scheduled_posts WHERE id=$1',[id]);
  });res.json({ok:true});
 });
 app.post('/api/admin/scheduled-posts/:id/send',admin,async(req,res)=>{
  check(telegramReady,'Telegram не настроен.',503);
  const result=await db.query("UPDATE scheduled_posts SET publish_at=now(),enabled=true,updated_at=now() WHERE id=$1 AND status='pending' AND (expires_at IS NULL OR expires_at>now()) AND NOT EXISTS(SELECT 1 FROM post_deliveries d WHERE d.post_id=scheduled_posts.id AND d.occurrence=scheduled_posts.publish_at) RETURNING id",[uuid(req.params.id)]);
  check(result.rowCount,'Публикация уже в очереди или завершена. Обновите список.',409);res.status(202).json({ok:true});
 });
 app.post('/api/admin/post-deliveries/:id/resolve',admin,async(req,res)=>{
  check(/^\d+$/.test(req.params.id),'Неверный идентификатор.');
  const retry=req.body.action==='retry';check(retry||req.body.action==='delivered','Выберите действие.');
  check(retry?req.body.checked_channel===true:Number.isSafeInteger(req.body.message_id)&&req.body.message_id>0,'Проверьте канал и укажите ID доставленного сообщения либо подтвердите повтор.');
  await transaction(db,async c=>{
   const result=await c.query("UPDATE post_deliveries SET state=$2,message_id=$3,error=NULL,available_at=now(),attempts=0 WHERE id=$1 AND state IN ('uncertain','failed') RETURNING post_id",[req.params.id,retry?'pending':'sent',retry?null:req.body.message_id]);
   check(result.rowCount,'Статус уже изменился.',409);
   await c.query('INSERT INTO audit(actor_id,action,target_id,details) VALUES($1,$2,$3,$4)',[req.user.id,'telegram_delivery_resolved',result.rows[0].post_id,JSON.stringify({delivery:req.params.id,action:req.body.action})]);
  });res.json({ok:true});
 });
 installPhotoUploader(app,options);
}
