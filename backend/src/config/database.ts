import { readEnv } from './env.js';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: readEnv('DATABASE_URL'),
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
export { pool };
export default pool;
