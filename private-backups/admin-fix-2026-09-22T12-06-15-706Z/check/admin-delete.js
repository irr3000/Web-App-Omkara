import {transaction} from './db.js';
import {check} from './security.js';

async function removeRegistrations(c,ids){
 if(!ids.length)return;
 await c.query('DELETE FROM telegram_notifications WHERE registration_id=ANY($1::uuid[])',[ids]);
 await c.query('DELETE FROM receipts WHERE registration_id=ANY($1::uuid[])',[ids]);
 await c.query('DELETE FROM audit WHERE target_id=ANY($1::uuid[])',[ids]);
 await c.query("DELETE FROM telegram_dialogs WHERE state->>'id'=ANY($1::text[])",[ids]);
 // Drop pending callbacks/replies referring to records that no longer exist.
 await c.query(`DELETE FROM telegram_updates u WHERE EXISTS(SELECT 1 FROM unnest($1::text[]) x(id)
  WHERE strpos(u.payload::text,x.id)>0 OR strpos(COALESCE(u.reply::text,''),x.id)>0)`,[ids]);
 await c.query('DELETE FROM registrations WHERE id=ANY($1::uuid[])',[ids]);
}
export function installAdminDeletion(app,{db,admin,uuid}){
 app.delete('/api/admin/people/:id',admin,async(req,res)=>{
  const id=uuid(req.params.id);
  await transaction(db,async c=>{
   const people=(await c.query(`WITH RECURSIVE family AS (
    SELECT id FROM people WHERE id=$1 UNION SELECT p.id FROM people p JOIN family f ON p.merged_into=f.id
   ) SELECT p.* FROM people p JOIN family f USING(id) FOR UPDATE OF p`,[id])).rows;
   check(people.length,'Анкета не найдена.',404);
   check(people.every(p=>p.role!=='admin'),'Учётную запись администратора удалить нельзя.',409);
   const ids=people.map(p=>p.id),chats=people.map(p=>p.telegram_id).filter(Boolean),emails=people.flatMap(p=>[p.email,p.contact_email]).filter(Boolean);
   await c.query(`DELETE FROM telegram_updates WHERE payload#>>'{message,from,id}'=ANY($1::text[])
    OR payload#>>'{callback_query,from,id}'=ANY($1::text[])
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(reply,'[]'::jsonb)) r WHERE r->>'chat_id'=ANY($1::text[]))`,[chats]);
   await c.query('DELETE FROM telegram_dialogs WHERE telegram_id=ANY($1::text[])',[chats]);
   await c.query('DELETE FROM telegram_notifications WHERE chat_id=ANY($1::text[])',[chats]);
   const registrations=(await c.query('SELECT id FROM registrations WHERE person_id=ANY($1::uuid[]) FOR UPDATE',[ids])).rows.map(r=>r.id);
   await removeRegistrations(c,registrations);
   await c.query('DELETE FROM telegram_links WHERE person_id=ANY($1::uuid[])',[ids]);
   await c.query('DELETE FROM email_tokens WHERE email=ANY($1::text[])',[emails]);
   await c.query('DELETE FROM audit WHERE actor_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])',[ids]);
   await c.query('UPDATE registrations SET reviewed_by=NULL WHERE reviewed_by=ANY($1::uuid[])',[ids]);
   await c.query('UPDATE scheduled_posts SET created_by=NULL WHERE created_by=ANY($1::uuid[])',[ids]);
   await c.query('DELETE FROM rate_limits WHERE key=ANY($1::text[])',[chats.map(x=>'telegram:'+x)]);
   await c.query('DELETE FROM people WHERE id=ANY($1::uuid[])',[ids]);
  });res.json({ok:true});
 });
 app.delete('/api/admin/events/:id',admin,async(req,res)=>{
  const id=uuid(req.params.id);
  await transaction(db,async c=>{
   check((await c.query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[id])).rowCount,'Ретрит не найден.',404);
   await c.query("DELETE FROM telegram_dialogs WHERE state->>'event'=$1",[id]);
   await c.query("DELETE FROM telegram_updates WHERE strpos(payload::text,$1)>0 OR strpos(COALESCE(reply::text,''),$1)>0",[id]);
   await removeRegistrations(c,(await c.query('SELECT id FROM registrations WHERE event_id=$1 FOR UPDATE',[id])).rows.map(r=>r.id));
   await c.query('DELETE FROM audit WHERE target_id=$1',[id]);
   await c.query('DELETE FROM events WHERE id=$1',[id]);
  });res.json({ok:true});
 });
}
