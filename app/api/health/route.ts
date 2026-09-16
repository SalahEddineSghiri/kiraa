import { NextResponse } from "next/server"; import { pool } from "@/db/client";
export async function GET(){try{await pool.query("SELECT 1");return NextResponse.json({status:"ok",database:"ok"})}catch{return NextResponse.json({status:"degraded",database:"unavailable"},{status:503})}}
