import {readFile} from 'node:fs/promises';
import {database,transaction} from '../db.js';
const db=database();
try {
 await transaction(db,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(70913001)');
  await c.query(await readFile(new URL('../migrations/001.sql',import.meta.url),'utf8'));
  await c.query(await readFile(new URL('../migrations/002.sql',import.meta.url),'utf8'));
  await c.query(await readFile(new URL('../migrations/003.sql',import.meta.url),'utf8'));
  await c.query(await readFile(new URL('../migrations/004.sql',import.meta.url),'utf8'));
  await c.query(await readFile(new URL('../migrations/005.sql',import.meta.url),'utf8'));
 });
 console.log('Database schema ready. No demo people or events created.');
}finally{await db.end();}
