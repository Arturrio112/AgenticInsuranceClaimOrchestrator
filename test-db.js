const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'admin',
  password: 'password123',
  database: 'insurance_db',
});
pool.query('SELECT 1').then(() => console.log("Success with admin")).catch(e => console.log("Error:", e.message)).finally(() => pool.end());
