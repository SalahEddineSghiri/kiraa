import { NextResponse } from "next/server";
import { pool } from "@/db/client";
export const dynamic="force-dynamic";
export async function GET(){
  try {
    await pool.query("SELECT id FROM fleet_catalog LIMIT 1");
    await pool.query("SELECT id FROM booking_logs LIMIT 1");
    await pool.query("SELECT id FROM seasonal_pricing_matrix LIMIT 1");
    await pool.query("SELECT '[1]'::vector");
    await pool.query("SELECT checkpoint_id FROM kiraa_checkpoints.checkpoints LIMIT 1");
    const policies=await pool.query("SELECT 1 FROM rental_policies_vectors WHERE source='rental_policies.md#lexical-hash-v1' LIMIT 1");
    const configured=process.env.LLM_PROVIDER==="groq"&&!!process.env.GROQ_API_KEY&&!!process.env.LLM_MODEL;
    if(!configured||!policies.rowCount) return NextResponse.json({status:"degraded"},{status:503});
    return NextResponse.json({status:"ok",database:"ok",llm:"configured",policies:"ready"});
  } catch {return NextResponse.json({status:"degraded"},{status:503});}
}
