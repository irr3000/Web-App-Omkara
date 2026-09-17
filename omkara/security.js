import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const token=()=>randomBytes(32).toString('hex');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function problem(status,message){return Object.assign(new Error(message),{status});}
export function check(condition,message='Проверьте заполненные поля.',status=400){if(!condition)throw problem(status,message);}
export function emailAddress(value){const email=String(value||'').trim().toLowerCase();check(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Укажите электронную почту.');return email;}
export function validPassword(value){check(typeof value==='string'&&value.length>=12&&value.length<=128,'Пароль должен содержать от 12 до 128 символов.');return value;}
export async function hashPassword(password){validPassword(password);const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64,{N:16384,r:8,p:1});return `${salt}:${hash.toString('hex')}`;}
export async function verifyPassword(password,stored){
 if(typeof password!=='string'||password.length>128)return false;
 const [salt,encoded]=(stored||'00000000000000000000000000000000:'+ '00'.repeat(64)).split(':');
 const actual=await scrypt(password,salt,64,{N:16384,r:8,p:1});
 const expected=Buffer.from(encoded,'hex');return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function receiptMime(buffer){
 if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
 if(buffer.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 throw problem(400,'Поддерживаются фотографии JPEG/PNG и PDF.');
}
export function cookieValue(req,name){
 const item=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
 return item?item.slice(name.length+1):'';
}
export function profile(body){
 const first_name=String(body.first_name||'').trim(),last_name=String(body.last_name||'').trim(),phone=String(body.phone||'').trim();
 check(first_name.length>0&&first_name.length<=80&&last_name.length>0&&last_name.length<=80&&phone.length<=25&&/^\+?[\d ()-]{10,25}$/.test(phone)&&phone.replace(/\D/g,'').length>=10,'Заполните имя, фамилию и телефон.');
 return {first_name,last_name,phone};
}
