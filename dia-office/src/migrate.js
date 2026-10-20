import { migrate, pool } from "./db.js";

await migrate();
console.log("Database ready.");
await pool.end();
