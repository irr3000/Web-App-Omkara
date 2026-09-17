import {database} from '../db.js';
const email=(process.argv[2]||'').trim().toLowerCase();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Usage: npm run admin -- verified-owner-email');
const db=database();
try {
 const result=await db.query("UPDATE people SET role='admin' WHERE email=$1 RETURNING id",[email]);
 if(result.rowCount!==1) throw new Error('First register and verify this email on the website.');
 console.log('Administrator assigned. Sign out and sign in again.');
}finally{await db.end();}
