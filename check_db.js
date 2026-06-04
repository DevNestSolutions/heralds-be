const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    const res = await pool.query('SELECT * FROM products');
    console.log(JSON.stringify(res.rows, null, 2));
    process.exit();
}
check();
