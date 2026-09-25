export function yekaterinburgInput(value){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yekaterinburg',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function yekaterinburgUTC(value){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Укажите дату и время Екатеринбурга.');
 const date=new Date(value+':00+05:00');
 if(!Number.isFinite(date.getTime())||yekaterinburgInput(date)!==value)throw Error('Проверьте дату и время Екатеринбурга.');
 return date.toISOString();
}
