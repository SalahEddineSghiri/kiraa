import { describe,it,expect } from "vitest";
import { Pool } from "pg";
// Explicit opt-in: run only against an initialized disposable test database.
describe.skipIf(process.env.RUN_DB_TESTS!=="true")("PostgreSQL integration",()=>{
  it("has seeded business data, policy vectors and SDK checkpoint tables",async()=>{
    const pool=new Pool({connectionString:process.env.DATABASE_URL});
    try {
      for(const table of ["fleet_catalog","customer_profiles","booking_logs","seasonal_pricing_matrix","rental_policies_vectors"]) {
        expect(Number((await pool.query("SELECT count(*) FROM "+table)).rows[0].count)).toBeGreaterThan(0);
      }
      expect((await pool.query("SELECT to_regclass('kiraa_checkpoints.checkpoints') AS name")).rows[0].name).toBeTruthy();
      const result=await pool.query("SELECT 1-(embedding <=> embedding) AS score FROM rental_policies_vectors LIMIT 1");
      expect(Number(result.rows[0].score)).toBeCloseTo(1);
    } finally {await pool.end();}
  });
});
