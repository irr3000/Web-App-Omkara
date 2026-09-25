export async function mountScheduler({root,api,esc,nav,isCurrent}){
 const data=await api('/admin/scheduled-posts');if(!isCurrent())return;
 const labels={pending:'Ожидает отправки',sending:'Отправка началась',sent:'Доставлено',expired:'Срок истёк',uncertain:'Проверьте канал',failed:'Ошибка'};
 root.innerHTML=`<h1>Планировщик</h1>${nav}<p>Время: UTC. Повторы через 24 часа или 7 суток. Срок публикации — время удаления из Telegram и завершения повторов.</p><p>Фото JPEG/PNG до 8 МБ; подпись до 1024 символов. Новая строка выключена: включите её для отправки по расписанию.</p><p class="scheduler-status" role="status"></p><div class="scheduler-scroll"><table class="scheduler-table"><thead><tr>${['Текст','Дата','Время','Повтор','Каналы','Срок публикации (UTC)','Кнопки Telegram','Фото','Действия'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody></tbody></table></div><button type="button" class="scheduler-refresh">Обновить статусы</button>`;
 const tbody=root.querySelector('tbody'),status=root.querySelector('.scheduler-status');
 if(!data.telegram_ready)status.textContent='Telegram не настроен: отправка недоступна.';
 if(!data.channels.length)status.textContent='Настройте TELEGRAM_DESTINATIONS на сервере.';
 const input=(type,value,label)=>`<input type="${type}" value="${esc(value||'')}" aria-label="${label}">`;
 function addButton(container,b={}){
  const div=document.createElement('div');div.className='scheduler-button';div.innerHTML=input('text',b.text,'Текст кнопки')+input('url',b.url,'URL кнопки')+'<button type="button" aria-label="Удалить кнопку">−</button>';
  div.querySelector('button').onclick=()=>div.remove();container.append(div);
 }
 function addRow(p={}){
  const tr=document.createElement('tr');const iso=p.publish_at?new Date(p.publish_at).toISOString():new Date(Date.now()+3600000).toISOString();
  tr.innerHTML=`<td><textarea aria-label="Текст публикации" maxlength="4096">${esc(p.text||'')}</textarea><label><input type="checkbox" class="enabled" ${p.enabled?'checked':''}> Включена</label><span class="post-status">${esc(p.status||'Черновик')}</span></td><td>${input('date',iso.slice(0,10),'Дата')}</td><td>${input('time',iso.slice(11,16),'Время UTC')}</td><td><select aria-label="Повтор">${[['once','однократно'],['daily','ежедневно'],['weekly','еженедельно']].map(([v,t])=>`<option value="${v}" ${p.repeat===v?'selected':''}>${t}</option>`).join('')}</select></td><td><select multiple aria-label="Каналы">${data.channels.map(c=>`<option value="${esc(c.id)}" ${p.channels?.includes(c.id)?'selected':''}>${esc(c.label)}</option>`).join('')}</select></td><td>${input('datetime-local',p.expires_at?new Date(p.expires_at).toISOString().slice(0,16):'','Срок публикации UTC')}</td><td><div class="buttons"></div><button type="button" class="add-button">Добавить кнопку</button></td><td><input type="file" accept="image/png,image/jpeg" aria-label="Фото"><span class="photo-status">${p.has_photo?'Фото загружено':''}</span></td><td><button type="button" class="save">Сохранить</button><button type="button" class="send">Отправить уведомление</button><button type="button" class="add-row" aria-label="Добавить строку">+</button><p class="delivery-status"></p></td>`;
  const bs=tr.querySelector('.buttons');(p.buttons||[]).forEach(b=>addButton(bs,b));
  tr.querySelector('.post-status').textContent=labels[p.status]||'Черновик';
  function photoLink(){const span=tr.querySelector('.photo-status');span.textContent='';const link=document.createElement('a');link.href=`/api/admin/scheduled-posts/${p.id}/photo`;link.target='_blank';link.rel='noopener';link.textContent='Посмотреть фото';span.append(link);}
  if(p.has_photo)photoLink();
  tr.querySelector('.add-button').onclick=()=>addButton(bs);
  tr.querySelector('.add-row').onclick=()=>addRow();
  tr.querySelector('.delivery-status').textContent=data.deliveries.filter(d=>d.post_id===p.id).map(d=>`${d.chat_id}: ${labels[d.state]||d.state}${d.deleted?' (удалено)':''}${d.error?' — '+d.error:''}`).join('\n');
  for(const d of data.deliveries.filter(d=>d.post_id===p.id&&['failed','uncertain'].includes(d.state))){
   const recovery=document.createElement('div');recovery.innerHTML='<input type="number" min="1" aria-label="ID доставленного сообщения"><button type="button">Отметить доставленным</button><button type="button">Повторить после проверки канала</button>';
   const [delivered,retry]=recovery.querySelectorAll('button');
   async function resolve(action){try{await api(`/admin/post-deliveries/${d.id}/resolve`,'POST',{action,message_id:Number(recovery.querySelector('input').value),checked_channel:true});recovery.remove();status.textContent='Статус обновлён.';}catch(e){status.textContent=e.message;}}
   delivered.onclick=()=>resolve('delivered');retry.onclick=()=>{if(confirm('Проверьте канал '+d.chat_id+'. Сообщение точно не доставлено? Повтор может создать дубликат.'))resolve('retry');};tr.lastElementChild.append(recovery);
  }
  async function save(sendNow=false){
   tr.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='';
   try{
    const text=tr.querySelector('textarea').value;
    const publish_at=new Date(tr.querySelector('[type=date]').value+'T'+tr.querySelector('[type=time]').value+':00Z').toISOString();
    const expiry=tr.querySelector('[type=datetime-local]').value;
    const values={text,publish_at,repeat:tr.querySelector('select').value,channels:[...tr.querySelector('select[multiple]').selectedOptions].map(o=>o.value),expires_at:expiry?new Date(expiry+'Z').toISOString():null,buttons:[...bs.children].map(b=>({text:b.querySelector('[type=text]').value,url:b.querySelector('[type=url]').value})),enabled:tr.querySelector('.enabled').checked};
    const file=tr.querySelector('[type=file]').files[0];if(file&&(file.size>8388608||text.length>1024))throw Error('Фото — до 8 МБ, подпись — до 1024 символов.');
    const saved=await api('/admin/scheduled-posts'+(p.id?'/'+p.id:''),p.id?'PATCH':'POST',{...values,enabled:file?false:values.enabled});p={...p,...saved};
    if(file){const form=new FormData();form.set('photo',file);await api(`/admin/scheduled-posts/${p.id}/photo`,'POST',form);tr.querySelector('[type=file]').value='';photoLink();await api('/admin/scheduled-posts/'+p.id,'PATCH',{...values});}
    if(sendNow)await api(`/admin/scheduled-posts/${p.id}/send`,'POST');
    status.textContent=sendNow?'Публикация поставлена в очередь. Обновите статусы через несколько секунд.':'Сохранено.';tr.querySelector('.post-status').textContent='Сохранено';
   }catch(e){status.textContent=e.message;}
   finally{tr.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  tr.querySelector('.save').onclick=()=>save();tr.querySelector('.send').onclick=()=>save(true);tbody.append(tr);
 }
 (data.posts.length?data.posts:[{}]).forEach(addRow);
 root.querySelector('.scheduler-refresh').onclick=()=>mountScheduler({root,api,esc,nav,isCurrent}).catch(e=>{status.textContent=e.message;});
}
