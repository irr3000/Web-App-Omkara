import {aboutMaster} from './seeker-content.js';
import {randomUUID} from 'node:crypto';
import {check,digest,emailAddress,profile} from '../security.js';
import {register,registrations,submitReceipt,cancelRegistration,saveProfile,audit} from '../seeker-service.js';

const button=(text,callback_data)=>({text,callback_data});
const back=[button('⬅️ Главное меню','menu')];
const keyboard=rows=>({inline_keyboard:[...rows,back]});
const menu={inline_keyboard:[[button('🕉 Онлайн-ретрит','retreat')],[button('🧘 Индивидуальная встреча','meeting')],[button('📋 Мои заявки и чеки','requests')],[button('👤 Моя анкета','profile')],[button('ℹ️ О мастере','about')]]};
const labels={awaiting_payment:'Ожидает оплаты',review:'Чек на проверке',confirmed:'Участие подтверждено',completed:'Завершено',cancelled:'Отменено'};
const validId=id=>{check(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id),'Кнопка устарела. Откройте главное меню.');return id;};
export function privateMessage(update){const m=update.message||update.callback_query?.message;const from=update.callback_query?.from||m?.from;return m?.chat?.type==='private'&&String(m.chat.id)===String(from?.id)&&!from?.is_bot?{...m,from}:null;}
export async function seekerDialog(c,update,{origin,receipt,receiptError}={}){
 const m=privateMessage(update);if(!m)return null;
 const tg=String(m.from.id),text=String(m.text||'').trim(),data=String(update.callback_query?.data||'');
 const reply=(text,reply_markup=keyboard([]))=>({chat_id:tg,text,reply_markup});
 await c.query("INSERT INTO telegram_dialogs(telegram_id) VALUES($1) ON CONFLICT DO NOTHING",[tg]);
 const d=(await c.query('SELECT state,expires_at FROM telegram_dialogs WHERE telegram_id=$1 FOR UPDATE',[tg])).rows[0];
 let state=new Date(d.expires_at)>new Date()?d.state:{};
 const set=async value=>{state=value;await c.query("UPDATE telegram_dialogs SET state=$2,expires_at=now()+interval '30 minutes' WHERE telegram_id=$1",[tg,JSON.stringify(value)]);};
 let person=(await c.query('SELECT * FROM people WHERE telegram_id=$1',[tg])).rows[0];
 const start=text.match(/^\/start(?:@\w+)? ([a-f0-9]{64})$/);
 if(start){
  const link=(await c.query('SELECT p.email FROM telegram_links l JOIN people p ON p.id=l.person_id WHERE l.token_hash=$1 AND l.expires_at>now()',[digest(start[1])])).rows[0];
  check(link,'Ссылка истекла. Создайте новую ссылку в анкете на сайте.');
  await set({step:'link',token:digest(start[1])});
  return reply('Связать этот Telegram с кабинетом '+link.email+'? Ваши заявки из Telegram станут доступны в этом кабинете. Подтверждайте только связь со своим кабинетом.',keyboard([[button('Подтвердить связь','link_confirm')]]));
 }
 if(data==='link_confirm'&&state.step==='link'){
  const link=(await c.query('SELECT * FROM telegram_links WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[state.token])).rows[0];check(link,'Ссылка истекла. Создайте новую ссылку на сайте.');
  const ids=[link.person_id,...(person?[person.id]:[])].sort();
  const people=(await c.query('SELECT * FROM people WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
  const owner=people.find(p=>p.id===link.person_id),source=people.find(p=>p.id===person?.id);
  check(owner&&(!owner.telegram_id||owner.telegram_id===tg),'Кабинет уже связан с другим Telegram.');
  if(source&&source.id!==owner.id){
   check(!source.email&&source.role==='member','Этот Telegram уже связан с другим кабинетом. Обратитесь к администратору.');
   const conflicts=await c.query("SELECT 1 FROM registrations a JOIN registrations b ON a.event_id=b.event_id WHERE a.person_id=$1 AND b.person_id=$2 AND a.status NOT IN ('cancelled','completed') AND b.status NOT IN ('cancelled','completed')",[source.id,owner.id]);
   check(!conflicts.rowCount,'В обоих профилях есть активная запись на одно мероприятие. Обратитесь к администратору для проверки заявок.');
   await c.query('UPDATE registrations SET person_id=$1 WHERE person_id=$2',[owner.id,source.id]);
   await c.query('UPDATE people SET telegram_id=NULL,merged_into=$2 WHERE id=$1',[source.id,owner.id]);
   await c.query('UPDATE people SET contact_email=COALESCE(contact_email,$2) WHERE id=$1',[owner.id,source.contact_email]);
   await audit(c,owner.id,'telegram_identity_merged',source.id);
  }
  await c.query('UPDATE people SET telegram_id=$1 WHERE id=$2',[tg,owner.id]);
  await c.query('DELETE FROM telegram_links WHERE token_hash=$1',[state.token]);await set({});
  return reply('Telegram связан с кабинетом. Заявки и решения администратора теперь общие.',menu);
 }
 let action=data||text.replace(/^\/(\w+)(?:@\w+)?$/,'$1');
 if(['start','menu','cancel'].includes(action)){await set({});return reply('🙏 Добро пожаловать! Выберите интересующий раздел.',menu);}
 if(action==='about'){await set({});return reply(aboutMaster);}
 if(['retreat','retreats','meeting','meetings'].includes(action)||/^(retreat|meeting):\d+$/.test(action)){
  await set({});const kind=action.startsWith('retreat')?'retreat':'meeting',page=Math.min(50000,Number(action.split(':')[1])||0);
  const events=(await c.query('SELECT id,title FROM events WHERE published=true AND kind=$1 ORDER BY starts_at NULLS LAST,created_at,id LIMIT 21 OFFSET $2',[kind,page*20])).rows;
  const rows=events.slice(0,20).map(e=>[button(e.title.slice(0,60),'event:'+e.id)]);
  if(page)rows.push([button('Назад',kind+':'+(page-1))]);if(events.length>20)rows.push([button('Далее',kind+':'+(page+1))]);
  return reply(events.length?'Выберите мероприятие:':'Сейчас опубликованных мероприятий нет.',keyboard(rows));
 }
 if(action==='requests'||/^requests:\d+$/.test(action)){
  await set({});const rows=person?await registrations(c,person.id):[],page=Math.min(50000,Number(action.split(':')[1])||0);
  const buttons=rows.slice(page*20,page*20+20).map(r=>[button((r.title+' · '+labels[r.status]).slice(0,60),'request:'+r.id)]);
  if(page)buttons.push([button('Назад','requests:'+(page-1))]);if(rows.length>page*20+20)buttons.push([button('Далее','requests:'+(page+1))]);
  return reply(rows.length?'Ваши заявки:':'У вас пока нет заявок. Выберите ретрит или встречу.',keyboard(buttons));
 }
 if(action==='profile'){
  await set({});return reply(person?`${person.first_name} ${person.last_name}\n${person.phone}\n${person.email||person.contact_email||'Почта не указана'}`:'Анкета ещё не заполнена.',keyboard([[button('✏️ Заполнить или изменить','edit_profile')],[button('📧 Контактная почта','email')],[{text:'Связать с кабинетом сайта',url:origin+'/#profile'}]]));
 }
 if(action==='email'){check(person,'Сначала заполните анкету.');await set({step:'email'});return reply('Укажите контактную почту. Она не используется для входа без подтверждения на сайте.');}
 if(action.startsWith('event:')){
  await set({});const e=(await c.query('SELECT * FROM events WHERE id=$1 AND published=true',[validId(action.slice(6))])).rows[0];check(e,'Мероприятие не найдено.');
  return reply(`${e.title}\n\n${e.description}\n\nДата: ${e.starts_at?new Date(e.starts_at).toISOString().replace('T',' ').slice(0,16)+' UTC':'уточняется'}\nМесто: ${e.location||'уточняется'}\nВзнос: ${(e.price_kop/100).toFixed(2)} ₽`,keyboard(e.registration_open?[[button('✅ Записаться','register:'+e.id)]]:[]));
 }
 const showRequest=async id=>{
  check(person,'Сначала заполните анкету.');const r=(await registrations(c,person.id)).find(r=>r.id===id);check(r,'Заявка не найдена.',404);
  const rows=[];if(r.status==='awaiting_payment')rows.push([button('📷 Прикрепить чек','receipt:'+r.id)]);
  if(['awaiting_payment','review'].includes(r.status))rows.push([button('Отменить заявку','cancel_request:'+r.id)]);
  rows.push([button('📖 О мероприятии','event:'+r.event_id)]);
  return reply(`${r.title}\n${labels[r.status]}\nВзнос: ${(r.price_kop/100).toFixed(2)} ₽${r.status==='awaiting_payment'?'\n\n'+(r.payment_instructions||'Реквизиты пока не опубликованы. Обратитесь к администратору.'):''}${r.admin_note?'\n\nКомментарий: '+r.admin_note:''}${r.participant_information?'\n\n'+r.participant_information:''}`,keyboard(rows));
 };
 if(action.startsWith('request:')){await set({});return showRequest(validId(action.slice(8)));}
 if(action.startsWith('cancel_request:'))return reply('Отменить эту заявку?',keyboard([[button('Да, отменить','cancel_yes:'+validId(action.slice(15)))]]));
 if(action.startsWith('cancel_yes:')){check(person,'Анкета не найдена.');await cancelRegistration(c,person.id,validId(action.slice(11)));await set({});return reply('Заявка отменена.',menu);}
 if(action.startsWith('receipt:')){
  const id=validId(action.slice(8));check(person,'Анкета не найдена.');const r=(await registrations(c,person.id)).find(r=>r.id===id);check(r?.status==='awaiting_payment','Заявка больше не ожидает чек.');
  await set({step:'receipt',id});return reply('Отправьте чек фотографией или файлом JPEG, PNG либо PDF размером до 8 МБ. Для выхода — /cancel.');
 }
 if(action==='edit_profile'||action.startsWith('register:')){
  const event=action.startsWith('register:')?validId(action.slice(9)):null;
  if(event){check((await c.query('SELECT id FROM events WHERE id=$1 AND published=true AND registration_open=true',[event])).rowCount,'Запись закрыта.');}
  await set({step:'first_name',event,draft:{}});
  if(event&&person?.first_name&&person?.last_name&&person?.phone){await set({step:'confirm_profile',event});return reply(`Использовать вашу анкету?\n${person.first_name} ${person.last_name}\n${person.phone}`,keyboard([[button('✅ Использовать эти данные','use_profile')],[button('✏️ Изменить','edit_for_event')]]));}
  return reply('Введите имя. Для выхода — /cancel.',{remove_keyboard:true});
 }
 if(action==='edit_for_event'&&state.step==='confirm_profile'){await set({step:'first_name',event:state.event,draft:{}});return reply('Введите имя.',{remove_keyboard:true});}
 if(action==='use_profile'&&state.step==='confirm_profile'){check(person,'Анкета не найдена.');const r=await register(c,person.id,state.event);await set({});return showRequest(r.id);}
 // Old Apps Script buttons cannot safely identify PostgreSQL UUIDs. Show the corresponding current list.
 if(data&&/^(retreat_|meeting_)/.test(data)){await set({});return reply('Откройте актуальные мероприятия или вашу заявку через меню.',menu);}
 if(!data&&state.step==='email'){await c.query('UPDATE people SET contact_email=$1 WHERE id=$2',[emailAddress(text),person.id]);await set({});return reply('Контактная почта сохранена.',menu);}
 if(!data&&['first_name','last_name'].includes(state.step)){
  check(text.length>0&&text.length<=80&&!text.startsWith('/'),'Введите имя или фамилию длиной до 80 символов.');
  const draft={...state.draft,[state.step]:text};const next=state.step==='first_name'?'last_name':'phone';await set({...state,step:next,draft});
  return reply(next==='last_name'?'Введите фамилию.':'Отправьте свой номер телефона кнопкой ниже или введите его текстом.',next==='phone'?{keyboard:[[{text:'📱 Отправить номер телефона',request_contact:true}]],resize_keyboard:true,one_time_keyboard:true}:{remove_keyboard:true});
 }
 if(!data&&state.step==='phone'){
  if(m.contact)check(String(m.contact.user_id)===tg,'Отправьте свой контакт или введите номер текстом.');
  const p=profile({...state.draft,phone:m.contact?.phone_number||text});
  if(!person){person=(await c.query('INSERT INTO people(id,telegram_id,first_name,last_name,phone) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),tg,p.first_name,p.last_name,p.phone])).rows[0];}
  else person=await saveProfile(c,person.id,p);
  const event=state.event;await set({});
  if(event){const r=await register(c,person.id,event);return showRequest(r.id);}
  return reply('Анкета сохранена. Откройте /menu для выбора мероприятия.',{remove_keyboard:true});
 }
 if(!data&&state.step==='receipt'){
  if(receiptError)throw receiptError;
  check(receipt,'Отправьте чек фотографией или файлом JPEG, PNG либо PDF до 8 МБ.');
  check(person,'Анкета не найдена.');await submitReceipt(c,person.id,state.id,receipt);await set({});return reply('🙏 Чек получен и передан администратору. Решение придёт в этот чат.',menu);
 }
 return reply('Выберите раздел меню. Для отмены текущего шага — /cancel.',menu);
}
