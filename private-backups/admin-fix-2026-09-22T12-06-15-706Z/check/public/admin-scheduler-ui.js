import {yekaterinburgInput,yekaterinburgUTC} from './scheduler-time.js';
export async function mountScheduler({root,api,esc,nav,isCurrent}){
 const data=await api('/admin/scheduled-posts');if(!isCurrent())return;
 const labels={pending:'В очереди',sending:'Отправляется',sent:'Отправлено',expired:'Срок истёк',uncertain:'Результат неизвестен',failed:'Ошибка'};
 const chatName=id=>data.channels.find(c=>c.id===id)?.label||id;
 root.innerHTML=`<h1>Планировщик</h1>${nav}<p>Время: Екатеринбург (UTC+5). Повторы через 24 часа или 7 суток. Срок удаления — время удаления сообщений из Telegram и окончания повторов.</p><p>Выберите чаты для каждой публикации. Фото JPEG/PNG до 8 МБ; подпись до 1024 символов. На телефоне таблица прокручивается в ширину.</p><div class="actions"><button type="button" class="scheduler-new">Добавить публикацию</button><button type="button" class="scheduler-refresh">Обновить статусы</button></div><p class="scheduler-status" role="status" aria-live="polite"></p><div class="scheduler-scroll" tabindex="0" role="region" aria-label="Публикации — таблица с горизонтальной прокруткой"><table class="scheduler-table"><colgroup>${Array.from({length:9},(_,i)=>`<col class="scheduler-col-${i}">`).join('')}</colgroup><thead><tr>${['Текст','Дата','Время Екатеринбурга','Повтор','Чаты','Удаление из Telegram (Екатеринбург)','Кнопки Telegram','Фото','Статус и действия'].map(t=>`<th scope="col">${t}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
 const tbody=root.querySelector('tbody'),status=root.querySelector('.scheduler-status');
 if(!data.telegram_ready)status.textContent='Telegram не настроен: отправка недоступна.';
 if(!data.channels.length)status.textContent='Нет доступных чатов. Добавьте бота в группу или канал и предоставьте право отправки.';
 if(data.deletion_errors?.length){const info=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Требует внимания: удаление сообщений из Telegram';info.append(summary);for(const d of data.deletion_errors){const p=document.createElement('p');p.textContent=chatName(d.chat_id)+': '+d.error;info.append(p);}root.append(info);}
 const input=(type,value,label)=>`<input type="${type}" value="${esc(value||'')}" aria-label="${label}">`;
 function addButton(container,b={}){
  const div=document.createElement('div');div.className='scheduler-button';div.innerHTML=input('text',b.text,'Текст кнопки')+input('url',b.url,'URL кнопки')+'<button type="button" aria-label="Удалить кнопку">Удалить кнопку</button>';
  div.querySelector('button').onclick=()=>div.remove();container.append(div);
 }
 function addRow(p={}){
  const tr=document.createElement('tr'),iso=yekaterinburgInput(p.publish_at||Date.now()+3600000);
  tr.innerHTML=`<td><textarea aria-label="Текст публикации" maxlength="4096">${esc(p.text||'')}</textarea></td><td>${input('date',iso.slice(0,10),'Дата')}</td><td>${input('time',iso.slice(11,16),'Время Екатеринбурга')}</td><td><select class="repeat" aria-label="Повтор">${[['once','Однократно'],['daily','Ежедневно'],['weekly','Еженедельно']].map(([v,t])=>`<option value="${v}" ${p.repeat===v?'selected':''}>${t}</option>`).join('')}</select></td><td><details class="scheduler-chats"><summary>Выбрать чаты</summary><div class="chat-options"></div></details><div class="selected-chats"></div></td><td>${input('datetime-local',p.expires_at?yekaterinburgInput(p.expires_at):'','Удаление из Telegram (Екатеринбург)')}</td><td><div class="buttons"></div><button type="button" class="add-button">Добавить кнопку</button></td><td><input type="file" accept="image/png,image/jpeg" aria-label="Фото"><span class="photo-status">${p.has_photo?'Фото загружено':''}</span></td><td><strong class="post-status"></strong><p class="delivery-status"></p><button type="button" class="save">Запланировать</button><button type="button" class="pause">Приостановить</button><button type="button" class="remove">Удалить строку</button><div class="recovery"></div></td>`;
  const bs=tr.querySelector('.buttons');(p.buttons||[]).forEach(b=>addButton(bs,b));
  const selected=new Set(p.channels||[]),options=tr.querySelector('.chat-options');
  const allChats=[...data.channels,...[...selected].filter(id=>!data.channels.some(c=>c.id===id)).map(id=>({id,label:id+' (недоступен)'}))];
  for(const c of allChats){const label=document.createElement('label');label.className='scheduler-chat-option';label.innerHTML=`<input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id)?'checked':''}><span>${esc(c.label)}</span>`;const box=label.querySelector('input');box.onchange=()=>{if(box.checked)selected.add(c.id);else selected.delete(c.id);drawChats();};options.append(label);}
  function drawChats(){const list=tr.querySelector('.selected-chats');list.replaceChildren();for(const id of selected){const chip=document.createElement('button');chip.type='button';chip.className='chat-chip';chip.textContent=chatName(id)+' ×';chip.setAttribute('aria-label','Убрать чат '+chatName(id));chip.disabled=p.id&&p.status!=='pending';chip.onclick=()=>{selected.delete(id);for(const box of options.querySelectorAll('input'))box.checked=selected.has(box.value);drawChats();};list.append(chip);}tr.querySelector('.scheduler-chats summary').textContent=selected.size?'Выбрано чатов: '+selected.size:'Выбрать чаты';}
  drawChats();
  function photoLink(){const span=tr.querySelector('.photo-status');span.textContent='';const link=document.createElement('a');link.href=`/api/admin/scheduled-posts/${p.id}/photo`;link.target='_blank';link.rel='noopener';link.textContent='Посмотреть фото';span.append(link);}
  if(p.has_photo)photoLink();
  tr.querySelector('.add-button').onclick=()=>addButton(bs);
  const current=data.deliveries.filter(d=>d.post_id===p.id),results=current.length?current:p.last_result||[];
  tr.querySelector('.delivery-status').textContent=(results.length&&!current.length&&p.repeat!=='once'?'Последняя отправка:\n':'')+results.map(d=>`${chatName(d.chat_id)}: ${d.error&&d.state==='pending'?'Ошибка, ожидает повтора':labels[d.state]||d.state}${d.error?' — '+d.error:''}`).join('\n');
  function sync(){
   const editable=!p.id||p.status==='pending';
   tr.querySelectorAll('input,textarea,select,.add-button,.scheduler-button button,.chat-chip').forEach(e=>e.disabled=!editable);
   tr.querySelector('.save').hidden=!editable;
   tr.querySelector('.pause').hidden=!(p.id&&p.status==='pending'&&p.enabled);
   tr.querySelector('.save').textContent=p.id?(p.enabled?'Сохранить изменения':'Возобновить'):'Запланировать';
   tr.querySelector('.post-status').textContent=current.some(d=>d.error||['failed','uncertain'].includes(d.state))?(current.some(d=>d.state==='sent')?'Отправлено частично':'Ошибка отправки'):!p.id?'Новая публикация':p.status==='pending'?(p.enabled?'Запланировано':'Приостановлено'):labels[p.status]||p.status;
  }
  for(const d of current.filter(d=>['failed','uncertain'].includes(d.state))){
   const recovery=document.createElement('div');recovery.innerHTML=`<p>${esc(chatName(d.chat_id))}</p><input type="number" min="1" aria-label="ID доставленного сообщения"><button type="button">Отметить доставленным</button><button type="button">Повторить после проверки чата</button>`;
   const [delivered,retry]=recovery.querySelectorAll('button');
   async function resolve(action){try{await api(`/admin/post-deliveries/${d.id}/resolve`,'POST',{action,message_id:Number(recovery.querySelector('input').value),checked_channel:true});recovery.remove();status.textContent='Статус обновлён. Нажмите «Обновить статусы».';}catch(e){status.textContent=e.message;}}
   delivered.onclick=()=>resolve('delivered');retry.onclick=()=>{if(confirm('Проверьте чат '+chatName(d.chat_id)+'. Сообщение точно не доставлено? Повтор может создать дубликат.'))resolve('retry');};tr.querySelector('.recovery').append(recovery);
  }
  let saving=false;
  async function save(){
   if(saving)return;saving=true;
   tr.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='';
   try{
    const text=tr.querySelector('textarea').value;
    if(!text.trim())throw Error('Введите текст публикации.');
    if(!selected.size)throw Error('Выберите хотя бы один чат.');
    const publish_at=yekaterinburgUTC(tr.querySelector('[type=date]').value+'T'+tr.querySelector('[type=time]').value),expiry=tr.querySelector('[type=datetime-local]').value;
    const values={text,publish_at,repeat:tr.querySelector('.repeat').value,channels:[...selected],expires_at:expiry?yekaterinburgUTC(expiry):null,buttons:[...bs.children].map(b=>({text:b.querySelector('[type=text]').value,url:b.querySelector('[type=url]').value})),enabled:true};
    const file=tr.querySelector('[type=file]').files[0];if(file&&(file.size>8388608||text.length>1024))throw Error('Фото — до 8 МБ, подпись — до 1024 символов.');
    const saved=await api('/admin/scheduled-posts'+(p.id?'/'+p.id:''),p.id?'PATCH':'POST',{...values,enabled:file?false:true});p={...p,...saved};
    if(file){const form=new FormData();form.set('photo',file);await api(`/admin/scheduled-posts/${p.id}/photo`,'POST',form);tr.querySelector('[type=file]').value='';photoLink();p={...p,...await api('/admin/scheduled-posts/'+p.id,'PATCH',values)};}
    if(!p.id||!p.enabled)throw Error('Публикация не включена в расписание. Повторите сохранение.');
    status.textContent='Сохранено в базе. Публикация запланирована по времени Екатеринбурга.';
   }catch(e){status.textContent=e.message;tr.querySelector('.delivery-status').textContent='Не удалось запланировать: '+e.message;}
   finally{saving=false;tr.querySelectorAll('button').forEach(b=>b.disabled=false);sync();}
  }
  tr.querySelector('.save').onclick=()=>save();
  tr.querySelector('.pause').onclick=async()=>{try{await api(`/admin/scheduled-posts/${p.id}/pause`,'POST');p.enabled=false;sync();status.textContent='Будущие отправки приостановлены.';}catch(e){status.textContent=e.message;}};
  tr.querySelector('.remove').onclick=async()=>{if(p.id&&!confirm('Удалить строку и прекратить будущие отправки? Уже назначенное удаление сообщений из Telegram будет выполнено.'))return;try{if(p.id)await api(`/admin/scheduled-posts/${p.id}`,'DELETE');tr.remove();status.textContent='Строка удалена.';}catch(e){status.textContent=e.message;}};
  sync();tr.querySelectorAll('.recovery input').forEach(e=>e.disabled=false);tbody.append(tr);
 }
 (data.posts.length?data.posts:[{}]).forEach(addRow);
 root.querySelector('.scheduler-new').onclick=()=>addRow();
 root.querySelector('.scheduler-refresh').onclick=()=>mountScheduler({root,api,esc,nav,isCurrent}).catch(e=>{status.textContent=e.message;});
}
