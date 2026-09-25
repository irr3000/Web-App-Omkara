export function telegramAPI(botToken, fetcher=fetch){
 return async(method,payload,photo)=>{
  let body,headers;
  if(photo){body=new FormData();for(const [k,v] of Object.entries(payload))body.set(k,typeof v==='object'?JSON.stringify(v):String(v));body.set('photo',new Blob([photo.content],{type:photo.mime}),photo.mime==='image/png'?'photo.png':'photo.jpg');}
  else {body=JSON.stringify(payload);headers={'Content-Type':'application/json'};}
  let response,result;
  try{response=await fetcher(`https://api.telegram.org/bot${botToken}/${method}`,{method:'POST',headers,body,signal:AbortSignal.timeout(15000)});result=await response.json();}
  catch{throw Object.assign(Error('Результат отправки неизвестен; проверьте канал.'),{uncertain:true});}
  if(!result.ok)throw Object.assign(Error(`Telegram: ${result.error_code||response.status}`),{retryAfter:result.parameters?.retry_after||300,permanent:[400,401,403].includes(result.error_code)});
  return result.result;
 };
}
