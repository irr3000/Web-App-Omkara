import pg from 'pg';
export function database() {
 const connectionString=process.env.DATABASE_URL||process.env.DB_CONNECTION_STRING;
 if(!connectionString) throw new Error('Set DATABASE_URL or DB_CONNECTION_STRING before starting.');
 return new pg.Pool({connectionString,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
}
export async function transaction(pool, work) {
 const client=await pool.connect();
 try { await client.query('BEGIN'); const result=await work(client); await client.query('COMMIT'); return result; }
 catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();}
}
