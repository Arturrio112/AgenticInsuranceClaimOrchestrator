import { Pool } from 'pg';
import * as dotenv from 'dotenv';

process.env.DOTENV_QUIET = 'true';
dotenv.config();

export const pool = new Pool(
    process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'insurance_db',
    }
);

export const query = (text: string, params?: any[]) => {
    return pool.query(text, params);
};

