// Keep only identifiers required for future Telegram deletion, independent of visible posts.
export async function preserveDeletions(c,postId=null){
 await c.query(`INSERT INTO scheduler_deletions(source_delivery_id,chat_id,message_id,delete_at)
  SELECT id,chat_id,message_id,delete_at FROM post_deliveries WHERE state='sent' AND message_id IS NOT NULL AND delete_at IS NOT NULL AND NOT deleted AND ($1::uuid IS NULL OR post_id=$1)
  ON CONFLICT(source_delivery_id) DO NOTHING`,[postId]);
}
