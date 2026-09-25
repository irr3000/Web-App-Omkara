import {transaction} from '../db.js';
import {telegramAPI} from './telegram-api.js';
export function poller({db,botToken,fetcher=fetch,request}){
 const controller=new AbortController();
 const call=request||telegramAPI(botToken,(url,options)=>fetcher(url,{...options,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])}));
 let busy=false,stopped=false;
 async function tick(){
 if(busy||stopped)return;busy=true;
 try{await transaction(db,async c=>{
 const row=(await c.query('SELECT next_offset FROM telegram_poll_cursor WHERE id=1 FOR UPDATE SKIP LOCKED')).rows[0];if(!row)return;
 const updates=await call('getUpdates',{offset:Number(row.next_offset),timeout:20,limit:100,allowed_updates:['message','callback_query']});
 let offset=Number(row.next_offset);
 for(const update of updates){if(!Number.isSafeInteger(update.update_id))throw Error('Invalid Telegram update');await c.query('INSERT INTO telegram_updates(update_id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING',[update.update_id,JSON.stringify(update)]);offset=Math.max(offset,update.update_id+1);}
 if(offset!==Number(row.next_offset))await c.query('UPDATE telegram_poll_cursor SET next_offset=$1 WHERE id=1',[offset]);
 });}catch{if(!stopped)console.error('Telegram polling deferred.');}finally{busy=false;}
 }
 return {tick,start(){const timer=setInterval(tick,2000);timer.unref();void tick();return ()=>{stopped=true;clearInterval(timer);controller.abort();};}};
}
