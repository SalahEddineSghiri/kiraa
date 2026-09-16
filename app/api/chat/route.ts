import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ChatRequestSchema, KiraaStateSchema, ParamsSchema } from "@/lib/schemas/contracts";
import { runAgent } from "@/lib/agent/graph";
import { ingestFile } from "@/lib/ingestor";
import { generateQuotePdf } from "@/lib/reporter";
export const runtime="nodejs";
export async function POST(request:Request) {
  try {
    let message:string, params; let ocrConfidence=0;
    const size=Number(request.headers.get("content-length")??0);
    if(size>10*1024*1024) return NextResponse.json({error:"Requête trop volumineuse."},{status:413});
    if(request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form=await request.formData();
      const parsed=ChatRequestSchema.parse({message:String(form.get("message")??""),params:JSON.parse(String(form.get("params")??"{}"))});
      message=parsed.message; params=parsed.params;
      const files=form.getAll("files").filter((v):v is File=>v instanceof File);
      if(files.length>5||files.reduce((n,f)=>n+f.size,0)>10*1024*1024) return NextResponse.json({error:"Maximum 5 fichiers et 10 MiB."},{status:413});
      const docs=await Promise.all(files.map(ingestFile));
      if(docs.some(d=>d.errors.length)) return NextResponse.json({error:"CLARIFICATION_REQUIRED",details:docs.flatMap(d=>d.errors)},{status:422});
      ocrConfidence=docs.length?Math.min(...docs.map(d=>d.confidence)):0;
      for(const doc of docs.filter(d=>d.engine==="json")) {
        const source=JSON.parse(doc.text);
        const mapped=ParamsSchema.parse(Object.fromEntries(Object.entries({birthDate:source.birthDate??source.birth_date??source.date_naissance,licenseIssueDate:source.licenseIssueDate??source.license_issue_date??source.date_permis,licenseExpDate:source.licenseExpDate??source.license_exp_date}).filter(([,v])=>v!==undefined)));
        for(const [key,value] of Object.entries(mapped)) if(params[key as keyof typeof params]!==undefined&&params[key as keyof typeof params]!==value) return NextResponse.json({error:"CLARIFICATION_REQUIRED",needsHumanReview:true,details:["Conflit : "+key]},{status:409});
        params={...mapped,...params};
      }
      message+="\n"+docs.map(d=>d.text).join("\n");
      if(message.length>50000) return NextResponse.json({error:"Documents trop longs."},{status:413});
    } else { const body=ChatRequestSchema.parse(await request.json());message=body.message;params=body.params; }
    const result=await runAgent(KiraaStateSchema.parse({requestId:randomUUID(),rawInput:message,params,ocrConfidence}));
    if(result.validation.isValid===true&&typeof result.priceResult.totalPrice==="number") {
      try {
        const pdf=await generateQuotePdf(result);
        result.report={finalized:true,url:"data:application/pdf;base64,"+pdf.toString("base64")};
      } catch {
        result.report={finalized:false};
        result.explanation+="\nLe devis PDF est temporairement indisponible ; le statut de réservation ci-dessus reste valable.";
      }
    }
    return NextResponse.json(result);
  } catch(error) {
    if(error instanceof z.ZodError||error instanceof SyntaxError) return NextResponse.json({error:"Entrée ou réponse structurée invalide. Veuillez préciser votre demande."},{status:422});
    console.error("chat failed",error instanceof Error?error.name:"UnknownError");
    return NextResponse.json({error:"Service temporairement indisponible. Réessayez plus tard."},{status:503});
  }
}
