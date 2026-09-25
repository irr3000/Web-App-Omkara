import multer from 'multer';
import {check,receiptMime} from '../security.js';
import {transaction} from '../db.js';

export function installPhotoUploader(app,{db,admin,limit,uuid}){
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8388608,files:1,fields:0,parts:2}}).single('photo');
 app.post('/api/admin/scheduled-posts/:id/photo',admin,async(req,res,next)=>{await limit(req,'post-photo',20,900,req.user.id);next();},(req,res,next)=>upload(req,res,error=>error?res.status(400).json({error:'Выберите один JPEG или PNG до 8 МБ.'}):next()),async(req,res)=>{
  const id=uuid(req.params.id);check(req.file,'Выберите фото.');const mime=receiptMime(req.file.buffer);
  check(['image/jpeg','image/png'].includes(mime)&&req.file.mimetype===mime,'Поддерживаются JPEG и PNG; тип файла должен совпадать с содержимым.');
  await transaction(db,async c=>{
   const post=(await c.query('SELECT * FROM scheduled_posts WHERE id=$1 FOR UPDATE',[id])).rows[0];check(post,'Публикация не найдена.',404);
   check(post.status==='pending','Сначала завершите текущую отправку.',409);check(post.text.length<=1024,'Подпись к фото — до 1024 символов.');
   check(!(await c.query('SELECT 1 FROM post_deliveries WHERE post_id=$1 AND occurrence=$2',[id,post.publish_at])).rowCount,'Отправка уже началась.',409);
   await c.query('INSERT INTO post_photos VALUES($1,$2,$3) ON CONFLICT(post_id) DO UPDATE SET mime=$2,content=$3',[id,mime,req.file.buffer]);
  });res.status(201).json({url:`/api/admin/scheduled-posts/${id}/photo`});
 });
 app.get('/api/admin/scheduled-posts/:id/photo',admin,async(req,res)=>{const p=(await db.query('SELECT * FROM post_photos WHERE post_id=$1',[uuid(req.params.id)])).rows[0];check(p,'Фото удалено или не загружено.',404);res.set({'Content-Type':p.mime,'Content-Disposition':'inline','X-Content-Type-Options':'nosniff'}).send(Buffer.from(p.content));});
}
