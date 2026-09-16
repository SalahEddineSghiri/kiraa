import { z } from "zod";
import { structuredCompletion } from "../lib/llm";
async function main() {
  const result=await structuredCompletion(
    'Extract explicitly stated rental intent and dates. Return {intent:"check_availability",vehicleId:string,startDate:string,endDate:string}.',
    "Le véhicule VH-0001 est-il disponible du 2027-01-10 au 2027-01-12 ?",
    z.object({intent:z.literal("check_availability"),vehicleId:z.literal("VH-0001"),startDate:z.literal("2027-01-10"),endDate:z.literal("2027-01-12")}).strict(),
  );
  console.log("Groq structured extraction: PASS",result.intent);
}
main().catch(error=>{console.error("Groq structured extraction: FAIL",error instanceof Error?error.name:"UnknownError");process.exitCode=1;});
