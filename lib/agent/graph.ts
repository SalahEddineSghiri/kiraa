import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { z } from "zod";
import { pool } from "@/db/client";
import { KiraaStateSchema, ParamsSchema, IntentSchema, type KiraaState } from "@/lib/schemas/contracts";
import { calculateTotalPrice, verifyDriverEligibility, type Vehicle } from "@/lib/engine";
import { structuredCompletion } from "@/lib/llm";
import { retrievePolicies } from "@/lib/rag";
const State=Annotation.Root({state:Annotation<KiraaState>({reducer:(_,v)=>v,default:()=>KiraaStateSchema.parse({requestId:"",rawInput:""})})});
const trace=(s:KiraaState,n:string)=>({...s,graphTrace:[...s.graphTrace,n]});
const clarify=(s:KiraaState,message:string):KiraaState=>({...s,validation:{isValid:false,status:"CLARIFICATION_REQUIRED",errors:[message]},bookingStatus:"CLARIFICATION_REQUIRED"});
const review=(s:KiraaState,message:string):KiraaState=>({...s,needsHumanReview:true,escalationReasons:[...s.escalationReasons,message]});
export async function ingestorNode({state}:{state:KiraaState}) { return {state:trace(state,"ingestorNode")}; }
export async function extractorNode({state}:{state:KiraaState}) {
  let next=trace(state,"extractorNode");
  if(process.env.NODE_ENV==="test" && next.intentOverride) return {state:next};
  const result=await structuredCompletion(
    'Extract explicitly stated rental parameters. Return {params:{},confidence:number,ambiguous:boolean,conflicts:string[]}. Allowed params: fullName,birthDate,licenseIssueDate,licenseExpDate,vehicleId,startDate,endDate,insuranceOption (basic/all_risk/franchise_buyback),discountCode,kmDriven,kmAllowed. Omit missing fields. Dates must be explicit YYYY-MM-DD; ambiguous/relative dates require clarification. Report contradictions between form, documents and message. Do not infer dates from age.',
    {text:next.rawInput,form:next.params},
    z.object({params:ParamsSchema,confidence:z.number().min(0).max(1),ambiguous:z.boolean(),conflicts:z.array(z.string())}).strict()
  );
  const conflicts=[...result.conflicts];
  for(const [key,value] of Object.entries(result.params)) {
    const previous=next.params[key as keyof typeof next.params];
    if(previous!==undefined && previous!==value) conflicts.push("Conflicting "+key);
  }
  if(conflicts.length) return {state:review(clarify(next,conflicts.join("; ")),"Conflicting input")};
  next={...next,params:{...result.params,...next.params},extractedContent:{confidence:result.confidence}};
  if(result.ambiguous) next=clarify(next,"Dates ambiguës : préciser YYYY-MM-DD.");
  if(result.confidence<.85 || (next.ocrConfidence>0 && next.ocrConfidence<.85)) next=review(clarify(next,"Extraction incertaine : validation humaine nécessaire."),"Low extraction confidence");
  return {state:next};
}
export async function intentNode({state}:{state:KiraaState}) {
  let next=trace(state,"intentNode");
  if(next.validation.isValid===false) return {state:next};
  if(process.env.NODE_ENV==="test" && next.intentOverride) return {state:{...next,intent:next.intentOverride,intentConfidence:1}};
  const result=await structuredCompletion(
    'Classify rental intent. Return {intent,confidence}. Allowed intent: check_availability,calculate_total_cost,validate_eligibility,make_reservation,policy_query,human_escalation,out_of_scope. Never classify a price question as authorization to book.',
    next.rawInput,z.object({intent:IntentSchema,confidence:z.number().min(0).max(1)}).strict());
  next={...next,intent:result.intent,intentConfidence:result.confidence};
  if(result.confidence<.85) next=clarify(next,"Veuillez préciser votre demande.");
  if(result.intent==="human_escalation") next=review(next,"Human assistance requested");
  return {state:next};
}
export async function validatorNode({state}:{state:KiraaState}) {
  let next=trace(state,"validatorNode"); const p=next.params;
  if(next.intent==="make_reservation"&&!p.fullName) return {state:clarify(next,"Nom complet requis pour réserver.")};
  if(!p.birthDate||!p.licenseIssueDate||!p.licenseExpDate) return {state:clarify(next,"Date de naissance et dates du permis requises.")};
  const vehicle=p.vehicleId?(await pool.query("SELECT category FROM fleet_catalog WHERE id=$1",[p.vehicleId])).rows[0]:undefined;
  const eligibility=verifyDriverEligibility(p.birthDate,p.licenseIssueDate,p.licenseExpDate,undefined,vehicle?.category);
  next={...next,eligibilityResult:eligibility,validation:{isValid:eligibility.eligible,errors:eligibility.rejectionReasons,status:eligibility.eligible?"OK":"REJECTED"}};
  if(eligibility.needsHumanReview) next=review(next,"Young Premium driver");
  return {state:next};
}
export async function calculatorNode({state}:{state:KiraaState}) {
  let next=trace(state,"calculatorNode"); const p=next.params;
  if(next.intent==="policy_query") {
    const passages=await retrievePolicies(next.rawInput);
    return {state:passages.length?{...next,ragPassages:passages,validation:{isValid:true,status:"OK",errors:[]}}:clarify(next,"Aucun passage pertinent dans les politiques disponibles.")};
  }
  if(!p.vehicleId||!p.startDate||!p.endDate) return {state:clarify(next,"Véhicule et dates de location requis.")};
  if(next.intent==="make_reservation"&&p.startDate<new Date().toISOString().slice(0,10)) return {state:clarify(next,"Une réservation ne peut pas commencer dans le passé.")};
  const days=(Date.parse(p.endDate)-Date.parse(p.startDate))/86400000;
  if(!Number.isInteger(days)||days<=0) return {state:clarify(next,"La fin doit être postérieure au début.")};
  const v=(await pool.query("SELECT * FROM fleet_catalog WHERE id=$1",[p.vehicleId])).rows[0];
  if(!v) return {state:clarify(next,"Véhicule inconnu.")};
  const count=Number((await pool.query("SELECT count(*) FROM booking_logs WHERE vehicle_id=$1 AND status IN ('CONFIRMED','PENDING_REVIEW') AND start_date<$3 AND end_date>$2",[p.vehicleId,p.startDate,p.endDate])).rows[0].count);
  if(count>=v.vehicles_available) return {state:{...next,validation:{isValid:false,status:"REJECTED",errors:["Véhicule indisponible."]}}};
  next={...next,validation:{isValid:true,status:"OK",errors:[]}};
  if(next.intent==="check_availability") return {state:next};
  const month=Number(p.startDate.slice(5,7));
  const season=(await pool.query("SELECT multiplier FROM seasonal_pricing_matrix WHERE month=$1 AND category=$2",[month,v.category])).rows[0];
  if(!season) return {state:clarify(next,"Tarification saisonnière manquante : revue humaine requise.")};
  const price=calculateTotalPrice({id:v.id,make:v.make,model:v.model,category:v.category as Vehicle["category"],baseDailyRate:Number(v.base_daily_rate)},days,month,p.insuranceOption,p.discountCode,String(next.eligibilityResult.riskCategory),Number(season.multiplier));
  next={...next,priceResult:price};
  if(price.needsHumanReview) next=review(next,"Security deposit exceeds 20,000 MAD");
  return {state:next};
}
export async function reporterNode({state}:{state:KiraaState}) {
  let next=trace(state,"reporterNode");
  if(next.intent==="make_reservation") {
    next={...next,bookingStatus:next.validation.isValid!==true?(next.validation.status==="CLARIFICATION_REQUIRED"?"CLARIFICATION_REQUIRED":"REJECTED"):next.needsHumanReview?"PENDING_REVIEW":"UNKNOWN"};
    if(next.validation.isValid===true && !next.needsHumanReview && typeof next.priceResult.totalPrice==="number") {
      const c=await pool.connect();
      try {
        await c.query("BEGIN");
        const vehicle=(await c.query("SELECT vehicles_available FROM fleet_catalog WHERE id=$1 FOR UPDATE",[next.params.vehicleId])).rows[0];
        const existing=await c.query("SELECT id FROM booking_logs WHERE id=$1",[next.requestId]);
        const count=Number((await c.query("SELECT count(*) FROM booking_logs WHERE vehicle_id=$1 AND status IN ('CONFIRMED','PENDING_REVIEW') AND start_date<$3 AND end_date>$2",[next.params.vehicleId,next.params.startDate,next.params.endDate])).rows[0].count);
        if(existing.rowCount) next={...next,bookingStatus:"CONFIRMED"};
        else if(!vehicle||count>=vehicle.vehicles_available) next={...next,bookingStatus:"REJECTED",validation:{isValid:false,status:"REJECTED",errors:["Disponibilité modifiée, veuillez réessayer."]}};
        else {
          // Create a customer from validated supplied dates; never match another customer's identity by an untrusted ID.
          const existingCustomer=(await c.query("SELECT id FROM customer_profiles WHERE full_name=$1 AND birth_date=$2 AND license_issue_date=$3 AND license_exp_date=$4 LIMIT 1",[next.params.fullName,next.params.birthDate,next.params.licenseIssueDate,next.params.licenseExpDate])).rows[0];
          const customerId=existingCustomer?.id??("CL-"+next.requestId);
          if(!existingCustomer) await c.query("INSERT INTO customer_profiles(id,full_name,birth_date,license_issue_date,license_exp_date,risk_category) VALUES ($1,$2,$3,$4,$5,$6)",[customerId,next.params.fullName,next.params.birthDate,next.params.licenseIssueDate,next.params.licenseExpDate,next.eligibilityResult.riskCategory]);
          await c.query("INSERT INTO booking_logs(id,customer_id,vehicle_id,start_date,end_date,days,insurance_option,deposit_amount,discount_code,seasonal_multiplier,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CONFIRMED')",[next.requestId,customerId,next.params.vehicleId,next.params.startDate,next.params.endDate,next.priceResult.days,next.params.insuranceOption??"basic",next.priceResult.deposit,next.params.discountCode??null,next.priceResult.seasonalMultiplier]);
          next={...next,bookingStatus:"CONFIRMED"};
        }
        await c.query("COMMIT");
      } catch(error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
    }
  }
  return {state:{...next,report:{finalized:next.validation.isValid===true}}};
}
export async function explainerNode({state}:{state:KiraaState}) {
  const next=trace(state,"explainerNode");
  // The LLM selects a safe template; amounts, statuses and policy passages remain verbatim.
  let intro="Résultat de votre demande :";
  if(!(process.env.NODE_ENV==="test" && next.intentOverride)) {
    try {
      const result=await structuredCompletion('Choose a French introduction. Return {style:"result"|"clarification"|"review"}. Only choose clarification if validation failed, review if needsHumanReview.',{valid:next.validation.isValid,needsHumanReview:next.needsHumanReview},z.object({style:z.enum(["result","clarification","review"])}));
      intro={result:"Résultat de votre demande :",clarification:"Précisions nécessaires :",review:"Revue humaine nécessaire :"}[result.style];
    } catch {
      // A wording service failure must not hide a booking already committed.
      intro=next.needsHumanReview?"Revue humaine nécessaire :":next.validation.isValid===false?"Précisions nécessaires :":"Résultat de votre demande :";
    }
  }
  const details=next.validation.errors.length?next.validation.errors.join("\n"):next.intent==="policy_query"?next.ragPassages.map(p=>p.content+"\nSource : "+p.source).join("\n\n"):JSON.stringify({eligibility:next.eligibilityResult,price:next.priceResult,bookingStatus:next.bookingStatus},null,2);
  return {state:{...next,explanation:intro+"\n"+details}};
}
let compiled: ReturnType<typeof compile> | undefined;
function compile() {
  const saver=PostgresSaver.fromConnString(process.env.DATABASE_URL!, {schema:"kiraa_checkpoints"});
  return new StateGraph(State)
    .addNode("ingestorNode",ingestorNode).addNode("extractorNode",extractorNode).addNode("intentNode",intentNode)
    .addNode("validatorNode",validatorNode).addNode("calculatorNode",calculatorNode).addNode("reporterNode",reporterNode).addNode("explainerNode",explainerNode)
    .addEdge(START,"ingestorNode").addEdge("ingestorNode","extractorNode").addEdge("extractorNode","intentNode")
    .addConditionalEdges("intentNode",({state:s})=>s.validation.isValid===false?"reporterNode":["validate_eligibility","calculate_total_cost","make_reservation"].includes(s.intent)?"validatorNode":["policy_query","check_availability"].includes(s.intent)?"calculatorNode":"reporterNode")
    .addConditionalEdges("validatorNode",({state:s})=>s.validation.isValid===true&&["calculate_total_cost","make_reservation"].includes(s.intent)?"calculatorNode":"reporterNode")
    .addEdge("calculatorNode","reporterNode").addEdge("reporterNode","explainerNode").addEdge("explainerNode",END).compile({checkpointer:saver});
}
export async function buildGraph(){return compiled??=compile();}
export async function runAgent(state:KiraaState){return (await (await buildGraph()).invoke({state},{configurable:{thread_id:state.requestId}})).state;}
