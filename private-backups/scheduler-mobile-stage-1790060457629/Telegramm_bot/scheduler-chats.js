// Only the bot's membership changes register recipients. Private seeker chats are never listed.
export async function recordSchedulerChat(c,update){
 const change=update.my_chat_member,chat=change?.chat,member=change?.new_chat_member;
 if(!chat||!['group','supergroup','channel'].includes(chat.type)||!member)return;
 const active=chat.type==='channel'?member.status==='administrator'&&member.can_post_messages!==false:['member','administrator','creator'].includes(member.status);
 await c.query('INSERT INTO scheduler_chats(id,label,active,update_id) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,active=EXCLUDED.active,update_id=EXCLUDED.update_id WHERE scheduler_chats.update_id<EXCLUDED.update_id',[String(chat.id),String(chat.title||chat.id).slice(0,100),active,update.update_id]);
}
export async function schedulerChannels(db,configured){
 const map=new Map(configured.map(c=>[c.id,c]));
 for(const c of (await db.query('SELECT id,label,active FROM scheduler_chats ORDER BY label')).rows){if(c.active)map.set(c.id,{id:c.id,label:c.label});else map.delete(c.id);}
 return [...map.values()];
}
