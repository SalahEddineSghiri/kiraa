"use client";
import { useState } from "react";
type Result={explanation?:string;error?:string;details?:string[];intent?:string;bookingStatus?:string;needsHumanReview?:boolean;report?:{url?:string};validation?:{status:string;errors:string[]};ocrConfidence?:number;extractedContent?:Record<string,unknown>;eligibilityResult?:Record<string,unknown>;escalationReasons?:string[];graphTrace?:string[]};
export function ChatUI(){
  const [message,setMessage]=useState("");
  const [files,setFiles]=useState<FileList|null>(null),[result,setResult]=useState<Result>(),[busy,setBusy]=useState(false);
  async function send(){
    setBusy(true);setResult(undefined);
    try {
      const form=new FormData();form.set("message",message);form.set("params","{}");
      const sessionId=sessionStorage.getItem("kiraa-session")??crypto.randomUUID();
      sessionStorage.setItem("kiraa-session",sessionId);
      form.set("sessionId",sessionId);
      Array.from(files??[]).forEach(f=>form.append("files",f));
      const response=await fetch("/api/chat",{method:"POST",body:form});
      const body=await response.json();
      setResult(response.ok?body:{error:body.error??"Demande échouée.",details:body.details});
    } catch {setResult({error:"Connexion impossible. Veuillez réessayer."});}
    finally {setBusy(false);}
  }
  return <section className="space-y-4">
    <textarea aria-label="Message" className="w-full" rows={5} value={message} placeholder="Votre demande (facultatif si vous joignez un permis)" onChange={e=>setMessage(e.target.value)}/>
    <p>Pour réserver : indiquez votre nom, le véhicule, les dates de location, votre date de naissance et les dates du permis. Utilisez AAAA-MM-JJ.</p>
    <input aria-label="Upload documents" type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.json,.txt" onChange={e=>setFiles(e.target.files)}/>
    <button disabled={busy||(!message.trim()&&!files?.length)} onClick={send}>{busy?"Analyse…":"Analyser"}</button>
    {result&&<div className="rounded border border-slate-700 p-4" aria-live="polite">
      {result.error?<p role="alert">{result.error} {result.details?.join("; ")}</p>:<>
        <p>Intention : {result.intent}</p><p>Réservation : {result.bookingStatus}</p>
        <p>Validation : {result.validation?.status}</p>
        <p>Confiance OCR : {result.ocrConfidence??"sans document"}</p>
        {result.validation?.errors?.length?<p>Précisions : {result.validation.errors.join("; ")}</p>:null}
        {result.extractedContent&&<p>Données extraites : {JSON.stringify(result.extractedContent)}</p>}
        {result.eligibilityResult&&<p>Éligibilité : {JSON.stringify(result.eligibilityResult)}</p>}
        {result.escalationReasons?.length?<p>Raisons de la revue : {result.escalationReasons.join("; ")}</p>:null}
        {result.graphTrace?.length?<p>Étapes : {result.graphTrace.join(" → ")}</p>:null}
        {result.needsHumanReview&&<p>Validation humaine nécessaire ; aucune réservation confirmée.</p>}
        <p className="whitespace-pre-wrap">{result.explanation}</p>
        {result.report?.url&&<a href={result.report.url} download="kiraa-devis.pdf">Télécharger le devis PDF</a>}
      </>}
    </div>}
  </section>;
}
