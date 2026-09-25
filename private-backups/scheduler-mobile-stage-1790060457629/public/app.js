(() => {
 'use strict';
 const root=document.querySelector('#app'),notice=document.querySelector('#notice');
 let user=null,csrf='',events=[],registrationAvailable=false,pending=false,adminEvents=[],offset=0,renderId=0;
 const status={awaiting_payment:'Ожидает оплаты',review:'Чек на проверке',confirmed:'Участие подтверждено',completed:'Участие завершено',cancelled:'Запись отменена'};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function linkedText(value){
  const text=String(value??'');
  const pattern=/(?:https?:\/\/|www\.|(?:t|telegram)\.me\/)[^\s<>"'«»]+/gi;
  let html='',end=0;
  for(const match of text.matchAll(pattern)){
   const start=match.index;
   if(start&&/[\p{L}\p{N}_@/]/u.test(text[start-1]))continue;
   let label=match[0].replace(/[.,!?;:]+$/u,'');
   for(const [open,close] of [['(',')'],['[',']'],['{','}']]){
    while(label.endsWith(close)&&label.split(close).length>label.split(open).length)label=label.slice(0,-1);
   }
   const href=/^https?:\/\//i.test(label)?label:'https://'+label;
   try{const url=new URL(href);if(!url.hostname||!['http:','https:'].includes(url.protocol))continue;}catch{continue;}
   html+=esc(text.slice(end,start))+`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
   end=start+label.length;
  }
  return html+esc(text.slice(end));
 }
 const money=v=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(v/100);
 const date=v=>v?new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeStyle:'short'}).format(new Date(v)):'Дата и время по согласованию';
 const btn=(label,action,id='',secondary=false)=>`<button type="button" class="${secondary?'secondary':''}" data-action="${action}" data-id="${esc(id)}">${label}</button>`;
 const field=(label,name,value='',type='text',extra='')=>`<label class="field" for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}>`;
 const area=(label,name,value='')=>`<label class="field" for="${name}">${label}</label><textarea id="${name}" name="${name}" rows="4">${esc(value)}</textarea>`;
 const message=text=>{notice.textContent=text;notice.hidden=!text;};
 function go(path){if(location.hash==='#'+path)render();else location.hash=path;}
 async function api(path,method='GET',body){
  const headers={};if(method!=='GET')headers['X-CSRF-Token']=csrf;
  if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
  let response;
  try{response=await fetch('/api'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,credentials:'same-origin',signal:AbortSignal.timeout(25000)});}catch{throw Error('Не удалось связаться с сайтом. Проверьте соединение и повторите.');}
  const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось выполнить действие.');return result;
 }
 async function mutate(work){if(pending)return;pending=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);message('');try{await work();}catch(error){message(error.message);window.scrollTo({top:0});}finally{pending=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 async function loadSession(){const s=await api('/session');user=s.user;csrf=s.csrf;registrationAvailable=s.registration_available;document.querySelector('#account').textContent='Мой кабинет';}
 function authView(mode='login'){
  const signup=mode==='signup',forgot=mode==='forgot';
  root.innerHTML=`<div class="detail"><p class="eyebrow">Личный кабинет</p><h1>${signup?'Давайте познакомимся.':forgot?'Восстановление доступа':'С возвращением.'}</h1><p class="lead">Вход по электронной почте. Telegram для работы с сайтом не требуется.</p><form id="auth" class="card body" data-mode="${mode}">${signup?field('Имя','first_name','','text','required maxlength="80" autocomplete="given-name"')+field('Фамилия','last_name','','text','required maxlength="80" autocomplete="family-name"')+field('Телефон','phone','','tel','required maxlength="25" autocomplete="tel"'):''}${field('Электронная почта','email','','email','required autocomplete="email" maxlength="254"')}${forgot?'':field('Пароль','password','','password',`required ${signup?'minlength="12"':''} maxlength="128" autocomplete="${signup?'new-password':'current-password'}"`)}${signup?'<p class="subtle">Не менее 12 символов. На почту придёт ссылка для подтверждения адреса.</p>':''}<button class="full" ${signup&&!registrationAvailable?'disabled':''}>${signup?'Создать кабинет':forgot?'Получить ссылку':'Войти'}</button>${!registrationAvailable&&signup?'<p class="note">Регистрация пока закрыта. Мы готовим запуск.</p>':''}</form><div class="actions">${btn(signup?'У меня уже есть кабинет':'Создать кабинет','go',signup?'login':'signup',true)}${!forgot?btn('Забыли пароль?','go','forgot',true):btn('Вернуться ко входу','go','login',true)}</div></div>`;
 }
 function eventCard(e){return `<article class="card"><div class="landscape"><span class="sun"></span><span class="tag">${e.registration_open?'Запись открыта':'Запись закрыта'}</span></div><div class="body"><p class="meta">${esc(date(e.starts_at))}</p><h2>${esc(e.title)}</h2><p class="lead">${esc(e.location)}</p><div class="row"><span class="price">${money(e.price_kop)}</span>${btn('Подробнее','go','event/'+e.id)}</div></div></article>`;}
 function homeView(){
  const openRetreats=events.filter(e=>e.kind==='retreat'&&e.registration_open);
  return `<div class="home-page">
   <section id="welcome-top" class="welcome" aria-labelledby="welcome-title" tabindex="-1">
    <picture class="welcome-photo"><source media="(max-width:680px)" srcset="/master-about2.PNG"><img src="/master-about.jpg" width="1701" height="924" alt="Мастер Омкара на фоне храмов и горного пейзажа" fetchpriority="high"></picture>
  <div class="social-links hero-social" aria-label="Социальные сети мастера">
   <a href="https://t.me/Omkapa" target="_blank" rel="noopener noreferrer" aria-label="Telegram — группа мастера"><img src="/Telegram_group.png" width="24" height="24" alt=""></a>
   <a href="https://www.instagram.com/master_omkara/profilecard/?igsh=cmloYndzbW5zbHZk" target="_blank" rel="noopener noreferrer" aria-label="Instagram — Мастер Омкара"><img src="/Instagram_group.png" width="24" height="24" alt=""></a>
   <a href="https://youtube.com/@master_omkara?si=hGpPq25ZtZUOKb8F" target="_blank" rel="noopener noreferrer" aria-label="YouTube — канал мастера"><img src="/Youtube_group.png" width="24" height="24" alt=""></a>
  </div>
    <div class="welcome-copy">
     <div class="welcome-logo"><img src="/omkara-logo.png" width="1650" height="960" alt="Логотип Омкара"></div>
     <h1 id="welcome-title" class="visually-hidden">Мастер Омкара · Ретриты и встречи</h1>
     <blockquote class="welcome-quote"><p>Когда на зов твоего сердца<br>перед тобой является <strong>ИСТИНА</strong> —<br>ты узнаёшь её <strong>РАдостью</strong><br>в своём сердце.</p><cite><em>Омкара</em></cite></blockquote>
    </div>
   </section>
   <section class="home-section retreat-intro" aria-labelledby="retreat-title">
    <p class="eyebrow">В поле мастера</p><h2 id="retreat-title">Ретрит</h2>
    <p>Это глубокий процесс трансформации ума и тела. В поле мастера у созревшего возникает возможность успокоить свой ум и окончательно освободится от обусловленного восприятия.</p>
   </section>
   <section class="practice-section" aria-labelledby="practice-title">
    <figure><img src="/retreat-practice.png" width="1405" height="1120" alt="Участники ретрита сидят перед мастером Омкарой во время совместной практики" loading="lazy" decoding="async"></figure>
    <div class="practice-copy"><p class="eyebrow">Совместные медитации</p><h2 id="practice-title">Мауна на ретрите</h2><p>Это глубокое погружение в тишину через ежедневные совместные медитации, сатсанги и даршаны с Мастером. Прикоснувшись к Свету сознания эго растворяется, кармические узлы очищаются и обнаруживается твоя истинная природа. Вместе с этим естественным образом отпадают вредные привычки.</p></div>
   </section>
   <section id="open-retreats" class="home-section" aria-labelledby="open-retreats-title" tabindex="-1">
    <p class="eyebrow">Встреча с мастером</p><h2 id="open-retreats-title">Открытая запись на ретриты</h2>
    <div class="grid">${openRetreats.map(eventCard).join('')||'<article class="card body"><h3>Новые ретриты появятся здесь</h3><p class="lead">Сейчас открытой записи нет. Расписание будет опубликовано на этой странице.</p></article>'}</div>
    ${user?.role==='admin'?'<div class="actions">'+btn('Управление мероприятиями','go','admin/events',true)+'</div>':''}
   </section>
   <section id="about-master" class="home-section about-master" aria-labelledby="about-title" tabindex="-1">
    <p class="eyebrow">Омкара</p><h2 id="about-title">О мастере</h2>
    <blockquote class="master-quote"><p><strong>«Бог принимает форму Гуру и является преданному, открывает ему Истину и очищает его ум своим присутствием».</strong></p><cite>Рамана Махарши</cite></blockquote>
    <div class="about-layout">
    <div class="about-copy">
     <p>Мастер Омкара — это бесформенный Свет Самости, из сострадания проявившийся в видимой форме.</p>
     <p>В результате многолетнего поиска Истины и пребывания в монашеском уединении рядом со своим Гуру сердце Мастера слилось с Единым. Его тело прошло глубокую трансформацию, став источником Света Божественной Любви, дарующего покой и освобождение.</p>
     <p>Из этого преображения родилось естественное служение всем живым существам, чтобы каждый готовый мог прийти к Мастеру здесь и сейчас.</p>
     <p>Во время Даршана и медитации Свет СоЗнания проливается на Тебя, растворяя искажения ума и возвращая его к изначальному просветлённому состоянию.</p>
     <p>В поле Мастера ум замолкает, открывая каждому возможность пройти глубочайшую внутреннюю трансформацию и очищение физического тела на всех уровнях. Двойственное восприятие исчезает вместе с эго, освобождая сознание от иллюзии отдельной личности.</p>
     <p>Все твои вопросы получат ответы на сатсангах с Мастером.</p>
     <p class="about-invitation"><strong>Если ты созрел и готов обнаружить истинную природу своей Самости — Мастер здесь.</strong></p>
     <div class="welcome-actions"><button type="button" data-action="scroll" data-id="open-retreats">Открытая запись на ретриты</button><button type="button" class="text-button" data-action="scroll" data-id="welcome-top">Наверх <span aria-hidden="true">↑</span></button></div>
    </div>
    <img class="about-photo" src="/master-portrait.png" width="1477" height="1055" alt="Портрет мастера Омкары без фона" loading="lazy" decoding="async">
    </div>
   </section>
  </div>`;
 }
 async function render(){
  const current=++renderId,route=location.hash.slice(1)||'retreats',path=route.startsWith('retreats/')?'retreats':route;message('');
  document.body.classList.toggle('is-home',path==='retreats');
  document.querySelectorAll('nav a').forEach(a=>{const active=a.hash==='#'+path;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  try{
   if(path.startsWith('verify=')){
    root.innerHTML='<h1>Подтверждение почты</h1><p class="lead">Нажмите кнопку, чтобы завершить регистрацию.</p>'+btn('Подтвердить почту','verify',path.slice(7));
   }else if(path.startsWith('reset=')){
    root.innerHTML=`<div class="detail"><h1>Новый пароль</h1><form class="card body" id="reset" data-token="${esc(path.slice(6))}">${field('Новый пароль','password','','password','required minlength="12" maxlength="128" autocomplete="new-password"')}<button class="full">Сохранить пароль</button></form></div>`;
   }else if(['login','signup','forgot'].includes(path))authView(path);
   else if(path==='retreats'){
    root.innerHTML=homeView();
    const section=route.slice('retreats/'.length);
    if(route.startsWith('retreats/')&&['open-retreats','about-master'].includes(section)){
     const target=document.getElementById(section);target.scrollIntoView({block:'start',behavior:'instant'});target.focus({preventScroll:true});
    }
   }
   else if(path==='meetings'){
    const kind=path==='retreats'?'retreat':'meeting';root.innerHTML=`<p class="eyebrow">Внимание к себе · В своём ритме</p><h1>${kind==='retreat'?'Побудьте<br>в настоящем.':'Время для<br>личной встречи.'}</h1><p class="lead">${kind==='retreat'?'Ретриты с мастером Омкарой. Выберите встречу, которая откликается вам.':'Индивидуальные и совместные встречи с мастером Омкарой.'}</p><div class="grid">${events.filter(e=>e.kind===kind).map(eventCard).join('')||'<article class="card body"><h2>Скоро здесь появится расписание</h2><p class="lead">Новые мероприятия будут опубликованы на этой странице.</p></article>'}</div>${user?.role==='admin'?'<div class="actions">'+btn('Управление мероприятиями','go','admin/events',true)+'</div>':''}`;
   }else if(path.startsWith('event/')){
    const e=events.find(e=>e.id===path.slice(6));if(!e)throw Error('Мероприятие не найдено.');
    root.innerHTML=`<div class="detail"><a class="back" href="#${e.kind==='retreat'?'retreats':'meetings'}">← К расписанию</a><p class="eyebrow">${e.kind==='retreat'?'Ретрит':'Встреча'}</p><h1>${esc(e.title)}</h1><article class="card body"><p class="meta">${esc(date(e.starts_at))}${e.ends_at?' — '+esc(date(e.ends_at)):''}</p><p class="prose">${esc(e.description)}</p><p class="lead">${esc(e.location)}</p><div class="row"><strong class="price">${money(e.price_kop)}</strong><span class="tag">${e.registration_open?'Запись открыта':'Запись закрыта'}</span></div>${e.registration_open?btn(user?'Записаться':'Войти и записаться',user?'register':'go',user?e.id:'login'):''}</article></div>`;
   }else if(path==='registrations'){
    if(!user)return authView();const rows=await api('/registrations');if(current!==renderId)return;
    root.innerHTML=`<p class="eyebrow">Личный кабинет</p><h1>Мои записи</h1><p class="lead">Оплата и информация об участии — в одном месте.</p>${rows.map(r=>`<article class="card body application"><p class="meta">${esc(date(r.starts_at))}</p><h2>${esc(r.title)}</h2><span class="status ${r.status==='confirmed'?'ok':''}">${status[r.status]}</span><div class="row"><span>Стоимость участия</span><strong>${money(r.price_kop)}</strong></div>${r.status==='awaiting_payment'?`<p class="prose">${esc(r.payment_instructions||'Реквизиты появятся после уточнения у организатора. Пожалуйста, пока не переводите деньги.')}</p><form data-receipt="${r.id}"><label class="field" for="receipt-${r.id}">Чек об оплате</label><input id="receipt-${r.id}" type="file" name="receipt" accept="image/jpeg,image/png,application/pdf" required><p class="subtle">JPEG, PNG или PDF до 8 МБ. Файл удаляется из рабочей базы после проверки.</p><button>Отправить на проверку</button></form>`:''}${r.status==='review'?'<p class="note">Чек получен. Администратор проверит оплату; результат появится здесь.</p>':''}${r.admin_note?`<p class="note">Комментарий организатора: ${esc(r.admin_note)}</p>`:''}${r.participant_information?`<p class="prose">${linkedText(r.participant_information)}</p>`:''}${['awaiting_payment','review'].includes(r.status)?`<details><summary>Отменить запись</summary><p>Место освободится, загруженный чек будет удалён. Если деньги уже переведены, сначала согласуйте отмену с организатором.</p>${btn('Подтвердить отмену','cancel',r.id,true)}</details>`:''}</article>`).join('')||'<article class="card body"><h2>Пока нет записей</h2><p class="lead">Выберите ретрит или встречу в расписании.</p></article>'}<div class="actions">${btn('Обновить статусы','refresh','',true)}${btn('Моя анкета','go','profile',true)}</div>`;
   }else if(path==='profile'){
    if(!user)return authView();root.innerHTML=`<div class="detail"><h1>Моя анкета</h1><p class="lead">${esc(user.email)}</p><form id="profile" class="card body">${field('Имя','first_name',user.first_name,'text','required maxlength="80"')}${field('Фамилия','last_name',user.last_name,'text','required maxlength="80"')}${field('Телефон','phone',user.phone,'tel','required maxlength="25"')}<button class="full">Сохранить</button></form><div class="actions">${btn(user.telegram_id?'Telegram подключён':'Подключить Telegram','telegram','',true)}${user.role==='admin'?btn('Администрирование','go','admin/events',true):''}${btn('Выйти','logout','',true)}</div></div>`;
   }else if(path.startsWith('admin/')){
    if(user?.role!=='admin')throw Error('Этот раздел доступен администратору.');
    const nav=`<div class="actions">${btn('Мероприятия','go','admin/events',true)}${btn('Записи и чеки','go','admin/registrations',true)}${btn('Ищущие','go','admin/people',true)}${btn('Планировщик','go','admin/scheduler',true)}</div>`;
    if(path==='admin/scheduler'){
     const {mountScheduler}=await import('/admin-scheduler-ui.js');
     await mountScheduler({root,api,esc,nav,isCurrent:()=>current===renderId});
    }else if(path==='admin/events'){
     adminEvents=await api('/admin/events');if(current!==renderId)return;
     root.innerHTML=`<p class="eyebrow">Администратор</p><h1>Мероприятия</h1>${nav}<div class="actions">${btn('Добавить мероприятие','go','admin/event/new')}</div>${adminEvents.map(e=>`<article class="card body application"><span class="tag">${e.published?'Опубликовано':'Черновик'}</span><h2>${esc(e.title)}</h2><p>${money(e.price_kop)} · ${esc(date(e.starts_at))}</p>${btn('Редактировать','go','admin/event/'+e.id,true)}</article>`).join('')}`;
    }else if(path.startsWith('admin/event/')){
     adminEvents=await api('/admin/events');if(current!==renderId)return;const id=path.slice(12),e=adminEvents.find(x=>x.id===id)||{};
     const local=value=>{if(!value)return '';const d=new Date(value);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
     root.innerHTML=`<div class="detail"><h1>${e.id?'Редактирование':'Новое мероприятие'}</h1>${nav}<form id="event" data-id="${esc(e.id||'')}" class="card body"><label class="field" for="kind">Тип</label><select id="kind" name="kind"><option value="retreat" ${e.kind==='retreat'?'selected':''}>Ретрит</option><option value="meeting" ${e.kind==='meeting'?'selected':''}>Встреча</option></select>${field('Название','title',e.title,'text','required maxlength="200"')}${area('Описание','description',e.description)}${field('Начало (ваше местное время)','starts_at',local(e.starts_at),'datetime-local')}${field('Окончание','ends_at',local(e.ends_at),'datetime-local')}${field('Место или формат','location',e.location,'text','maxlength="500"')}${field('Стоимость, ₽','price',(e.price_kop||0)/100,'number','required min="0" max="1000000" step="0.01"')}${field('Количество мест (пусто — без ограничения)','capacity',e.capacity,'number','min="1" max="100000"')}${area('Реквизиты и порядок оплаты — для записавшихся','payment_instructions',e.payment_instructions)}${area('Информация после подтверждения участия','participant_information',e.participant_information)}<label class="check"><input type="checkbox" name="published" ${e.published?'checked':''}> Опубликовать на сайте</label><label class="check"><input type="checkbox" name="registration_open" ${e.registration_open?'checked':''}> Открыть запись</label><button class="full">Сохранить</button></form></div>`;
    }else if(path==='admin/registrations'){
     const rows=await api('/admin/registrations?offset='+offset);if(current!==renderId)return;
     root.innerHTML=`<p class="eyebrow">Администратор</p><h1>Записи и чеки</h1>${nav}${rows.map(r=>`<article class="card body application"><h2>${esc(r.title)}</h2><p>${esc(r.first_name)} ${esc(r.last_name)}<br>${esc(r.phone)} · ${esc(r.email)}</p><span class="status">${status[r.status]}</span><p class="meta">Запись: ${esc(date(r.created_at))}</p><p>Стоимость: ${money(r.price_kop)} · Подтверждено: ${money(r.paid_kop)}</p>${r.receipt_id?`<a class="button secondary" href="/api/admin/receipts/${r.receipt_id}" download>Скачать чек для проверки</a>`:''}${r.status==='review'?`<form data-review="${r.id}">${field('Полученная сумма, ₽','paid-'+r.id,r.price_kop/100,'number','min="0" max="1000000" step="0.01" required')}${area('Комментарий участнику','note-'+r.id)}<div class="actions"><button name="decision" value="confirm">Подтвердить оплату</button><button class="secondary" name="decision" value="reject">Отклонить чек</button></div></form>`:''}${r.status==='confirmed'?btn('Отметить участие завершённым','complete',r.id,true):''}${r.admin_note?`<p class="note">${esc(r.admin_note)}</p>`:''}</article>`).join('')||'<p class="lead">Записей пока нет.</p>'}${pager(rows.length)}`;
    }else if(path==='admin/people'){
     const rows=await api('/admin/people?offset='+offset);if(current!==renderId)return;
     root.innerHTML=`<p class="eyebrow">Администратор</p><h1>Ищущие</h1>${nav}<div class="people-scroll" tabindex="0" role="region" aria-label="Ищущие — таблица с горизонтальной прокруткой"><table class="people-table"><thead><tr>${["Имя","Фамилия","Телефон","Почта","Telegram","Дата регистрации"].map(t=>`<th scope="col">${t}</th>`).join("")}</tr></thead><tbody>${rows.map(p=>`<tr><td>${esc(p.first_name)}</td><td>${esc(p.last_name)}</td><td>${esc(p.phone)}</td><td>${esc(p.email)}</td><td>${esc(p.telegram_id||"—")}</td><td>${esc(date(p.created_at))}</td></tr>`).join("")}</tbody></table></div>${rows.length?"":"<p>Анкет пока нет.</p>"}${pager(rows.length)}`;
    }else throw Error('Раздел не найден.');
   }else throw Error('Страница не найдена.');
  }catch(error){root.innerHTML='<h1>Не удалось открыть страницу</h1><p class="lead">'+esc(error.message)+'</p>'+btn('Повторить','refresh','',true);}
 }
 function pager(length){return `<div class="actions">${offset?btn('Предыдущие','previous','',true):''}${length===100?btn('Следующие','next','',true):''}${btn('Обновить','refresh','',true)}</div>`;}
 root.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const {action,id}=button.dataset;if(action==='scroll'){const target=document.getElementById(id);target?.scrollIntoView({block:'start'});if(target?.hasAttribute('tabindex'))target.focus({preventScroll:true});return;}if(action==='go'){offset=0;go(id);return;}mutate(async()=>{
  if(action==='register'){await api('/registrations','POST',{event_id:id});go('registrations');}
  if(action==='cancel'){await api('/registrations/'+id+'/cancel','POST');await render();}
  if(action==='complete'){await api('/admin/registrations/'+id+'/review','POST',{decision:'complete'});await render();}
  if(action==='logout'){await api('/auth/logout','POST');await loadSession();go('retreats');}
  if(action==='verify'){await api('/auth/verify','POST',{token:id});history.replaceState(null,'','#registrations');await loadSession();await render();}
  if(action==='refresh'){events=await api('/events');await loadSession();await render();}
  if(action==='next'||action==='previous'){offset=Math.max(0,offset+(action==='next'?100:-100));await render();}
  if(action==='telegram'){const result=await api('/telegram/link','POST');root.insertAdjacentHTML('beforeend',`<p class="note"><a href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">Открыть бота и связать кабинет</a>. Ссылка действует 10 минут.</p>`);}
 });});
 root.addEventListener('submit',event=>{event.preventDefault();const form=event.target,values=Object.fromEntries(new FormData(form)),decision=event.submitter?.value;mutate(async()=>{
  if(form.id==='auth'){
   const mode=form.dataset.mode,result=await api('/auth/'+(mode==='forgot'?'forgot':mode),'POST',values);
   if(mode==='login'){await loadSession();go('registrations');}else{message(result.message);form.reset();}
  }else if(form.id==='reset'){const result=await api('/auth/reset','POST',{token:form.dataset.token,password:values.password});history.replaceState(null,'','#login');await loadSession();await render();message(result.message);
  }else if(form.id==='profile'){await api('/profile','PATCH',values);await loadSession();message('Анкета сохранена.');
  }else if(form.dataset.receipt){const file=form.querySelector('input').files[0];if(!file||file.size>8388608)throw Error('Выберите файл размером до 8 МБ.');await api('/registrations/'+form.dataset.receipt+'/receipt','POST',new FormData(form));await render();message('Чек получен и доступен администратору.');
  }else if(form.dataset.review){const id=form.dataset.review;await api('/admin/registrations/'+id+'/review','POST',{decision,paid_kop:Math.round(Number(values['paid-'+id])*100),note:values['note-'+id]});await render();message('Решение сохранено.');
  }else if(form.id==='event'){const id=form.dataset.id;await api('/admin/events'+(id?'/'+id:''),id?'PATCH':'POST',{...values,price_kop:Math.round(Number(values.price)*100),capacity:values.capacity||null,starts_at:values.starts_at?new Date(values.starts_at).toISOString():null,ends_at:values.ends_at?new Date(values.ends_at).toISOString():null,published:values.published==='on',registration_open:values.registration_open==='on'});events=await api('/events');go('admin/events');}
 });});
 const menuToggle=document.querySelector('#menu-toggle'),primaryNav=document.querySelector('#primary-nav');
 function closeMenu(restoreFocus=false){document.body.classList.remove('menu-open');menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label','Открыть меню');if(restoreFocus)menuToggle.focus();}
 menuToggle.addEventListener('click',()=>{if(document.body.classList.contains('menu-open')){closeMenu(true);return;}document.body.classList.add('menu-open');menuToggle.setAttribute('aria-expanded','true');menuToggle.setAttribute('aria-label','Закрыть меню');primaryNav.querySelector('a').focus();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('menu-open'))closeMenu(true);});
 document.addEventListener('click',event=>{if(!event.target.closest('.site-header'))closeMenu();});
 document.addEventListener('focusin',event=>{if(!event.target.closest('.site-header'))closeMenu();});
 window.matchMedia('(max-width:680px)').addEventListener('change',()=>closeMenu());
 document.querySelector('#account').addEventListener('click',()=>{closeMenu();go(user?'profile':'login');});
 document.querySelector('#primary-nav').addEventListener('click',event=>{
  const link=event.target.closest('a');if(!link)return;closeMenu();if(link.hash!==location.hash)return;
  event.preventDefault();render();if(!link.hash.startsWith('#retreats/'))window.scrollTo({top:0,behavior:'instant'});
 });
 window.addEventListener('scroll',()=>document.body.classList.toggle('page-scrolled',window.scrollY>24),{passive:true});
 window.addEventListener('hashchange',async()=>{closeMenu();await render();if(!location.hash.startsWith('#retreats/'))window.scrollTo({top:0,behavior:'instant'});});
 (async()=>{try{await loadSession();events=await api('/events');await render();}catch(error){root.innerHTML='<h1>Скоро здесь откроется<br>наше пространство.</h1><p class="lead">Сайт готовится к запуску. Пожалуйста, загляните позже.</p>';message(error.message);}})();
})();
