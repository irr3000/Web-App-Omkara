// Telegram accepts deletion only while a message is less than 48 hours old.
export function deletionDelay(value){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<60||value>=172800)
  throw new Error('Удаление: укажите интервал от 1 минуты до 48 часов (не включая 48 часов).');
 return value;
}
export function deletionDeadline(seconds,telegramDate,now=Date.now()){
 if(seconds===null||seconds===undefined)return null;
 const sent=Number.isFinite(telegramDate)&&telegramDate>0?telegramDate*1000:now;
 return new Date(sent+seconds*1000);
}
