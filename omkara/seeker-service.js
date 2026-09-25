import {randomUUID} from 'node:crypto';
import {check,profile,receiptMime} from './security.js';
export async function audit(c,actor,action,id,details={}){await c.query('INSERT INTO audit(actor_id,action,target_id,details) VALUES($1,$2,$3,$4)',[actor,action,id,JSON.stringify(details)]);}
export async function register(c,personId,eventId){
   check((await c.query('SELECT id FROM people WHERE id=$1 FOR UPDATE',[personId])).rowCount,'Анкета не найдена.',404);
   const event=(await c.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[eventId])).rows[0];check(event&&event.published,'Мероприятие не найдено.',404);
   const prior=await c.query("SELECT * FROM registrations WHERE person_id=$1 AND event_id=$2 AND status NOT IN ('cancelled','completed')",[personId,eventId]);if(prior.rowCount)return prior.rows[0];
   check(event.registration_open&&(!event.ends_at||new Date(event.ends_at)>new Date()),'Запись на мероприятие закрыта.');
   if(event.kind==='retreat'){const old=await c.query("SELECT id FROM registrations WHERE person_id=$1 AND event_id=$2 AND status='completed'",[personId,eventId]);check(!old.rowCount,'Вы уже участвовали в этом ретрите.');}
   if(event.capacity){const count=await c.query("SELECT count(*)::integer AS total FROM registrations WHERE event_id=$1 AND status<>'cancelled'",[eventId]);check(count.rows[0].total<event.capacity,'Свободных мест больше нет.');}
   const record=await c.query("INSERT INTO registrations(id,person_id,event_id,price_kop,status) VALUES($1,$2,$3,$4,$5) RETURNING *",[randomUUID(),personId,eventId,event.price_kop,event.price_kop===0?'confirmed':'awaiting_payment']);
   await audit(c,personId,'registration_created',record.rows[0].id);return record.rows[0];
}
export async function submitReceipt(c,personId,id,content){
 check(Buffer.isBuffer(content)&&content.length>0&&content.length<=8388608,'Загрузите JPEG, PNG или PDF до 8 МБ.');const mime=receiptMime(content);
 const result=await c.query("SELECT id FROM registrations WHERE id=$1 AND person_id=$2 AND status='awaiting_payment' FOR UPDATE",[id,personId]);check(result.rowCount,'Чек уже на проверке или статус изменился.',409);
 await c.query('INSERT INTO receipts(id,registration_id,mime,content) VALUES($1,$2,$3,$4)',[randomUUID(),id,mime,content]);
 await c.query("UPDATE registrations SET status='review',updated_at=now() WHERE id=$1",[id]);await audit(c,personId,'receipt_uploaded',id);
}
export async function reviewRegistration(c,actorId,id,{decision,note,paid_kop:paidKop}){
 check((await c.query("SELECT id FROM people WHERE id=$1 AND role='admin'",[actorId])).rowCount,"Нет доступа.",403);
  check(['confirm','reject','complete'].includes(decision));note=String(note||'').trim();check(note.length<=1000);
const row=(await c.query('SELECT * FROM registrations WHERE id=$1 FOR UPDATE',[id])).rows[0];check(row,'Запись не найдена.',404);
   check(decision==='complete'?row.status==='confirmed':row.status==='review','Статус уже изменился. Обновите список.',409);
   const paid=decision==='confirm'?Number(paidKop):row.paid_kop;check(Number.isSafeInteger(paid)&&paid>=0&&paid<=100000000,'Проверьте сумму оплаты.');
   const status=decision==='confirm'?'confirmed':decision==='reject'?'awaiting_payment':'completed';
   await c.query('UPDATE registrations SET status=$1,paid_kop=$2,reviewed_by=$3,reviewed_at=now(),admin_note=$4,updated_at=now() WHERE id=$5',[status,paid,actorId,note,row.id]);
   await c.query('DELETE FROM receipts WHERE registration_id=$1',[row.id]);await audit(c,actorId,'payment_'+decision,row.id,{paid_kop:paid,note});

 const target=(await c.query('SELECT p.telegram_id,e.title FROM registrations r JOIN people p ON p.id=r.person_id JOIN events e ON e.id=r.event_id WHERE r.id=$1',[id])).rows[0];
 if(target.telegram_id)await c.query('INSERT INTO telegram_notifications(chat_id,registration_id,text) VALUES($1,$2,$3)',[target.telegram_id,id,target.title+'\n'+({confirm:'Оплата подтверждена. Участие одобрено.',reject:'Чек отклонён. Проверьте перевод и отправьте новый чек.',complete:'Участие завершено. Благодарим вас.'}[decision])+(note?'\nКомментарий администратора: '+note:'')]);
}
export async function cancelRegistration(c,personId,id){
const result=await c.query("UPDATE registrations SET status='cancelled',updated_at=now() WHERE id=$1 AND person_id=$2 AND status IN ('awaiting_payment','review') RETURNING id",[id,personId]);check(result.rowCount,'Эту запись уже нельзя отменить самостоятельно.',409);await c.query('DELETE FROM receipts WHERE registration_id=$1',[id]);await audit(c,personId,'registration_cancelled',id);
}
export async function registrations(c,personId){return (await c.query(`SELECT r.*,e.title,e.kind,e.starts_at,e.ends_at,e.location,e.payment_instructions,CASE WHEN r.status IN ('confirmed','completed') THEN e.participant_information ELSE '' END participant_information,EXISTS(SELECT 1 FROM receipts x WHERE x.registration_id=r.id) has_receipt FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.person_id=$1 ORDER BY r.created_at DESC`,[personId])).rows;}
export async function saveProfile(c,personId,body){const p=profile(body);return (await c.query('UPDATE people SET first_name=$1,last_name=$2,phone=$3 WHERE id=$4 RETURNING id,email,first_name,last_name,phone,role,telegram_id',[p.first_name,p.last_name,p.phone,personId])).rows[0];}
