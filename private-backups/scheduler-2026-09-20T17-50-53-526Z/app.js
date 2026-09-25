import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {transaction} from './db.js';
import {token,digest,check,problem,emailAddress,validPassword,hashPassword,verifyPassword,receiptMime,cookieValue,profile} from './security.js';
import {installTelegramWebhook} from './telegram.js';

const ownFields='id,email,first_name,last_name,phone,role,telegram_id';
const uuid=value=>{check(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),'Запись не найдена.',404);return value;};
export function createApp({db,mail,origin,secure=true,botUsername='',telegramSecret='',ownerEmail=''}){
 const app=express();
 app.disable('x-powered-by');
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'blob:'],connectSrc:["'self'"],frameAncestors:["'none'"],upgradeInsecureRequests:secure?[]:null}},hsts:secure?undefined:false}));
 app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.use(express.json({limit:'32kb'}));
 if(telegramSecret)installTelegramWebhook(app,{db,secret:telegramSecret});
 app.use((req,res,next)=>{if(secure&&req.hostname!==new URL(origin).hostname)return res.redirect(308,origin+req.originalUrl);next();});
 app.use('/api',async(req,res,next)=>{
  if(!['GET','HEAD'].includes(req.method))check(req.headers.origin===origin,'Обновите страницу и повторите действие.',403);
  const raw=cookieValue(req,'omkara_session');
  if(raw){const result=await db.query(`SELECT s.csrf,s.token_hash,p.${ownFields.split(',').join(',p.')} FROM sessions s JOIN people p ON p.id=s.person_id WHERE token_hash=$1 AND expires_at>now()`,[digest(raw)]);req.user=result.rows[0];}
  next();
 });
 async function limit(req,label,max=15,seconds=900,extra=''){
  // Address comes from the socket; never trust arbitrary forwarded headers.
  const key=digest(`${label}:${req.socket.remoteAddress}:${extra}`);
  const result=await db.query(`INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+($2*interval '1 second')) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END RETURNING hits`,[key,seconds]);
  check(result.rows[0].hits<=max,'Слишком много попыток. Попробуйте позже.',429);
 }
 function member(req,res,next){check(req.user,'Войдите в личный кабинет.',401);if(!['GET','HEAD'].includes(req.method))check(req.get('X-CSRF-Token')===req.user.csrf,'Обновите страницу и повторите действие.',403);next();}
 function admin(req,res,next){member(req,res,()=>{check(req.user.role==='admin','Нет доступа.',403);next();});}
 function publicUser(user){if(!user)return null;return Object.fromEntries(ownFields.split(',').map(key=>[key,user[key]]));}
 async function session(res,person){const raw=token(),csrf=token();await db.query("INSERT INTO sessions VALUES($1,$2,$3,now()+interval '7 days')",[digest(raw),person.id,csrf]);res.cookie('omkara_session',raw,{httpOnly:true,secure,sameSite:'lax',path:'/',maxAge:7*86400000});return {user:publicUser(person),csrf};}
 async function audit(c,actor,action,id,details={}){await c.query('INSERT INTO audit(actor_id,action,target_id,details) VALUES($1,$2,$3,$4)',[actor,action,id,JSON.stringify(details)]);}
 app.get('/healthz',async(_req,res)=>{await db.query('SELECT 1');res.json({ok:true});});
 app.get('/api/session',(req,res)=>res.json({user:publicUser(req.user),csrf:req.user?.csrf||'',registration_available:mail.ready}));
 app.post('/api/auth/signup',async(req,res)=>{
  check(mail.ready,'Регистрация откроется после настройки почты.',503);
  await limit(req,'signup-global',40);const email=emailAddress(req.body.email);await limit(req,'signup',3,900,email);
  const person=profile(req.body),password_hash=await hashPassword(req.body.password),raw=token();
  const existing=await db.query('SELECT id FROM people WHERE email=$1',[email]);
  if(!existing.rowCount){
   await db.query("INSERT INTO email_tokens VALUES($1,$2,'signup',$3,now()+interval '30 minutes')",[digest(raw),email,JSON.stringify({...person,password_hash})]);
   try{await mail.send(email,'Подтверждение почты · Омкара',`Чтобы создать личный кабинет, откройте ссылку:\n${origin}/#verify=${raw}\nСсылка действует 30 минут. Если вы не регистрировались, ничего делать не нужно.`);}catch{await db.query('DELETE FROM email_tokens WHERE token_hash=$1',[digest(raw)]);throw problem(503,'Не удалось отправить письмо. Попробуйте позже.');}
  }
  res.json({message:'Если адрес доступен для регистрации, на него отправлено письмо. Если кабинет уже есть — воспользуйтесь входом или восстановлением пароля.'});
 });
 app.post('/api/auth/verify',async(req,res)=>{
  await limit(req,'verify',25);const person=await transaction(db,async c=>{
   const found=await c.query("DELETE FROM email_tokens WHERE token_hash=$1 AND purpose='signup' AND expires_at>now() RETURNING *",[digest(String(req.body.token||''))]);check(found.rowCount,'Ссылка недействительна или истекла. Зарегистрируйтесь повторно.');
   const record=found.rows[0],p=record.payload;
   const role=ownerEmail&&record.email===ownerEmail.trim().toLowerCase()?'admin':'member';
   const created=await c.query(`INSERT INTO people(id,email,password_hash,first_name,last_name,phone,role) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(email) DO NOTHING RETURNING ${ownFields}`,[randomUUID(),record.email,p.password_hash,p.first_name,p.last_name,p.phone,role]);
   check(created.rowCount,'Этот адрес уже зарегистрирован. Войдите с паролем.');await c.query('DELETE FROM email_tokens WHERE email=$1 AND purpose=\'signup\'',[record.email]);return created.rows[0];
  });res.json(await session(res,person));
 });
 app.post('/api/auth/login',async(req,res)=>{
  await limit(req,'login-global',100);const email=emailAddress(req.body.email);await limit(req,'login',10,900,email);
  const found=await db.query('SELECT * FROM people WHERE email=$1',[email]);const person=found.rows[0];
  check(await verifyPassword(req.body.password,person?.password_hash)&&person,'Неверная почта или пароль.',401);
  res.json(await session(res,person));
 });
 app.post('/api/auth/forgot',async(req,res)=>{
  check(mail.ready,'Восстановление временно недоступно.',503);await limit(req,'forgot-global',40);
  const email=emailAddress(req.body.email);await limit(req,'forgot',3,900,email);
  const found=await db.query('SELECT id FROM people WHERE email=$1',[email]);
  if(found.rowCount){const raw=token();await db.query("INSERT INTO email_tokens VALUES($1,$2,'reset','{}',now()+interval '30 minutes')",[digest(raw),email]);
   try{await mail.send(email,'Восстановление пароля · Омкара',`Ссылка для смены пароля:\n${origin}/#reset=${raw}\nОна действует 30 минут. Если вы не запрашивали смену пароля, проигнорируйте письмо.`);}catch{await db.query('DELETE FROM email_tokens WHERE token_hash=$1',[digest(raw)]);throw problem(503,'Не удалось отправить письмо. Попробуйте позже.');}}
  res.json({message:'Если кабинет с такой почтой существует, мы отправили ссылку для восстановления.'});
 });
 app.post('/api/auth/reset',async(req,res)=>{
  await limit(req,'reset',20);const password_hash=await hashPassword(validPassword(req.body.password));
  await transaction(db,async c=>{const found=await c.query("SELECT * FROM email_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>now() FOR UPDATE",[digest(String(req.body.token||''))]);check(found.rowCount,'Ссылка недействительна или истекла.');
   const updated=await c.query('UPDATE people SET password_hash=$1 WHERE email=$2 RETURNING id',[password_hash,found.rows[0].email]);check(updated.rowCount,'Ссылка недействительна.');await c.query('DELETE FROM sessions WHERE person_id=$1',[updated.rows[0].id]);await c.query("DELETE FROM email_tokens WHERE email=$1 AND purpose='reset'",[found.rows[0].email]);});
  res.clearCookie('omkara_session',{path:'/',httpOnly:true,secure,sameSite:'lax'}).json({message:'Пароль изменён. Войдите заново.'});
 });
 app.post('/api/auth/logout',member,async(req,res)=>{await db.query('DELETE FROM sessions WHERE token_hash=$1',[req.user.token_hash]);res.clearCookie('omkara_session',{path:'/',httpOnly:true,secure,sameSite:'lax'}).json({ok:true});});
 app.patch('/api/profile',member,async(req,res)=>{const p=profile(req.body);const result=await db.query(`UPDATE people SET first_name=$1,last_name=$2,phone=$3 WHERE id=$4 RETURNING ${ownFields}`,[p.first_name,p.last_name,p.phone,req.user.id]);res.json({user:result.rows[0]});});
 app.get('/api/events',async(_req,res)=>{const result=await db.query(`SELECT id,kind,title,description,starts_at,ends_at,location,price_kop,capacity,registration_open FROM events WHERE published=true ORDER BY starts_at NULLS LAST,created_at`);res.json(result.rows);});
 app.get('/api/registrations',member,async(req,res)=>{
  const result=await db.query(`SELECT r.*,e.title,e.kind,e.starts_at,e.ends_at,e.location,e.payment_instructions,CASE WHEN r.status IN ('confirmed','completed') THEN e.participant_information ELSE '' END participant_information,EXISTS(SELECT 1 FROM receipts x WHERE x.registration_id=r.id) has_receipt FROM registrations r JOIN events e ON e.id=r.event_id WHERE r.person_id=$1 ORDER BY r.created_at DESC`,[req.user.id]);res.json(result.rows);
 });
 app.post('/api/registrations',member,async(req,res)=>{
  const eventId=uuid(req.body.event_id);const result=await transaction(db,async c=>{
   const event=(await c.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[eventId])).rows[0];check(event&&event.published,'Мероприятие не найдено.',404);
   const prior=await c.query("SELECT * FROM registrations WHERE person_id=$1 AND event_id=$2 AND status NOT IN ('cancelled','completed')",[req.user.id,eventId]);if(prior.rowCount)return prior.rows[0];
   check(event.registration_open&&(!event.ends_at||new Date(event.ends_at)>new Date()),'Запись на мероприятие закрыта.');
   if(event.kind==='retreat'){const old=await c.query("SELECT id FROM registrations WHERE person_id=$1 AND event_id=$2 AND status='completed'",[req.user.id,eventId]);check(!old.rowCount,'Вы уже участвовали в этом ретрите.');}
   if(event.capacity){const count=await c.query("SELECT count(*)::integer AS total FROM registrations WHERE event_id=$1 AND status<>'cancelled'",[eventId]);check(count.rows[0].total<event.capacity,'Свободных мест больше нет.');}
   const record=await c.query("INSERT INTO registrations(id,person_id,event_id,price_kop,status) VALUES($1,$2,$3,$4,$5) RETURNING *",[randomUUID(),req.user.id,eventId,event.price_kop,event.price_kop===0?'confirmed':'awaiting_payment']);
   await audit(c,req.user.id,'registration_created',record.rows[0].id);return record.rows[0];
  });res.status(201).json(result);
 });
 app.post('/api/registrations/:id/cancel',member,async(req,res)=>{
  await transaction(db,async c=>{const result=await c.query("UPDATE registrations SET status='cancelled',updated_at=now() WHERE id=$1 AND person_id=$2 AND status IN ('awaiting_payment','review') RETURNING id",[uuid(req.params.id),req.user.id]);check(result.rowCount,'Эту запись уже нельзя отменить самостоятельно.',409);await c.query('DELETE FROM receipts WHERE registration_id=$1',[req.params.id]);await audit(c,req.user.id,'registration_cancelled',req.params.id);});res.json({ok:true});
 });
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1,fields:0,parts:2}}).single('receipt');
 app.post('/api/registrations/:id/receipt',member,async(req,res,next)=>{await limit(req,'receipt',20,900,req.user.id);next();},upload,async(req,res)=>{
  check(req.file,'Выберите файл чека.');const mime=receiptMime(req.file.buffer);
  await transaction(db,async c=>{const result=await c.query("SELECT id FROM registrations WHERE id=$1 AND person_id=$2 AND status='awaiting_payment' FOR UPDATE",[uuid(req.params.id),req.user.id]);check(result.rowCount,'Обновите запись: чек уже на проверке или статус изменился.',409);
   await c.query('INSERT INTO receipts(id,registration_id,mime,content) VALUES($1,$2,$3,$4)',[randomUUID(),req.params.id,mime,req.file.buffer]);await c.query("UPDATE registrations SET status='review',updated_at=now() WHERE id=$1",[req.params.id]);await audit(c,req.user.id,'receipt_uploaded',req.params.id);
  });res.json({ok:true});
 });
 app.get('/api/admin/events',admin,async(_req,res)=>res.json((await db.query('SELECT * FROM events ORDER BY created_at DESC')).rows));
 function eventValues(body){
  const title=String(body.title||'').trim(),description=String(body.description||''),location=String(body.location||''),payment=String(body.payment_instructions||''),info=String(body.participant_information||'');
  const price=Number(body.price_kop),capacity=body.capacity==null||body.capacity===''?null:Number(body.capacity);
  check(title.length>0&&title.length<=200&&description.length<=10000&&location.length<=500&&payment.length<=3000&&info.length<=5000);
  check(['retreat','meeting'].includes(body.kind)&&Number.isSafeInteger(price)&&price>=0&&price<=100000000);
  check(capacity===null||(Number.isInteger(capacity)&&capacity>0&&capacity<=100000));
  const starts=body.starts_at||null,ends=body.ends_at||null;
  check((!starts||Number.isFinite(Date.parse(starts)))&&(!ends||Number.isFinite(Date.parse(ends)))&&(!starts||!ends||Date.parse(ends)>=Date.parse(starts)),'Проверьте даты мероприятия.');
  return [body.kind,title,description,starts,ends,location,price,capacity,body.registration_open===true,body.published===true,payment,info];
 }
 app.post('/api/admin/events',admin,async(req,res)=>{const values=eventValues(req.body);const id=randomUUID();const result=await db.query('INSERT INTO events(id,kind,title,description,starts_at,ends_at,location,price_kop,capacity,registration_open,published,payment_instructions,participant_information) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[id,...values]);res.status(201).json(result.rows[0]);});
 app.patch('/api/admin/events/:id',admin,async(req,res)=>{const values=eventValues(req.body);const result=await transaction(db,async c=>{await c.query('SELECT id FROM events WHERE id=$1 FOR UPDATE',[uuid(req.params.id)]);const count=await c.query("SELECT count(*)::integer AS total FROM registrations WHERE event_id=$1 AND status<>'cancelled'",[req.params.id]);check(values[7]===null||values[7]>=count.rows[0].total,'Вместимость меньше числа существующих записей.');const changed=await c.query('UPDATE events SET kind=$2,title=$3,description=$4,starts_at=$5,ends_at=$6,location=$7,price_kop=$8,capacity=$9,registration_open=$10,published=$11,payment_instructions=$12,participant_information=$13 WHERE id=$1 RETURNING *',[req.params.id,...values]);check(changed.rowCount,'Мероприятие не найдено.',404);await audit(c,req.user.id,'event_updated',req.params.id);return changed.rows[0];});res.json(result);});
 app.get('/api/admin/people',admin,async(req,res)=>{const offset=Math.max(0,Math.min(1000000,Number(req.query.offset)||0));res.json((await db.query(`SELECT ${ownFields},created_at FROM people ORDER BY created_at DESC LIMIT 100 OFFSET $1`,[offset])).rows);});
 app.get('/api/admin/registrations',admin,async(req,res)=>{const offset=Math.max(0,Math.min(1000000,Number(req.query.offset)||0));res.json((await db.query(`SELECT r.*,p.first_name,p.last_name,p.phone,p.email,e.title,e.kind,x.id AS receipt_id FROM registrations r JOIN people p ON p.id=r.person_id JOIN events e ON e.id=r.event_id LEFT JOIN receipts x ON x.registration_id=r.id ORDER BY CASE WHEN r.status='review' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100 OFFSET $1`,[offset])).rows);});
 app.get('/api/admin/receipts/:id',admin,async(req,res)=>{const result=await db.query('SELECT mime,content FROM receipts WHERE id=$1',[uuid(req.params.id)]);check(result.rowCount,'Чек уже удалён после проверки.',404);const file=result.rows[0];res.set({'Content-Type':file.mime,'Content-Disposition':`attachment; filename="receipt.${file.mime==='application/pdf'?'pdf':file.mime==='image/png'?'png':'jpg'}"`}).send(file.content);});
 app.post('/api/admin/registrations/:id/review',admin,async(req,res)=>{
  check(['confirm','reject','complete'].includes(req.body.decision));const note=String(req.body.note||'').trim();check(note.length<=1000);
  await transaction(db,async c=>{const row=(await c.query('SELECT * FROM registrations WHERE id=$1 FOR UPDATE',[uuid(req.params.id)])).rows[0];check(row,'Запись не найдена.',404);
   const decision=req.body.decision;check(decision==='complete'?row.status==='confirmed':row.status==='review','Статус уже изменился. Обновите список.',409);
   const paid=decision==='confirm'?Number(req.body.paid_kop):row.paid_kop;check(Number.isSafeInteger(paid)&&paid>=0&&paid<=100000000,'Проверьте сумму оплаты.');
   const status=decision==='confirm'?'confirmed':decision==='reject'?'awaiting_payment':'completed';
   await c.query('UPDATE registrations SET status=$1,paid_kop=$2,reviewed_by=$3,reviewed_at=now(),admin_note=$4,updated_at=now() WHERE id=$5',[status,paid,req.user.id,note,row.id]);
   await c.query('DELETE FROM receipts WHERE registration_id=$1',[row.id]);await audit(c,req.user.id,'payment_'+decision,row.id,{paid_kop:paid,note});
  });res.json({ok:true});
 });
 app.post('/api/telegram/link',member,async(req,res)=>{check(botUsername,'Telegram пока не подключён.',503);const raw=token();await db.query("INSERT INTO telegram_links VALUES($1,$2,now()+interval '10 minutes')",[digest(raw),req.user.id]);res.json({url:`https://t.me/${botUsername}?start=${raw}`});});
 app.use(express.static(fileURLToPath(new URL('./public',import.meta.url)),{index:'index.html',maxAge:0}));
 app.use((_req,res)=>res.status(404).json({error:'Страница не найдена.'}));
 app.use((error,req,res,_next)=>{
  const status=error instanceof multer.MulterError?400:error.status||500;
  if(status>=500)console.error(JSON.stringify({event:'request_failed',path:req.path,code:error.code||'INTERNAL'}));
  res.status(status).json({error:error instanceof multer.MulterError?'Загрузите один файл JPEG, PNG или PDF размером до 8 МБ.':status>=500?(error.status?error.message:'Не удалось выполнить действие. Попробуйте позже.'):error.message});
 });
 return app;
}
