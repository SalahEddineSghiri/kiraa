import pdf from "pdf-parse";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const exec=promisify(execFile);
export type Ingested={text:string;confidence:number;engine:string;errors:string[]};
export async function ingestFile(file:File):Promise<Ingested> {
  const failed=(message:string):Ingested=>({text:"",confidence:0,engine:"none",errors:[message]});
  if(!file.size||file.size>10*1024*1024) return failed("Empty or oversized file");
  const name=file.name.toLowerCase(), buf=Buffer.from(await file.arrayBuffer());
  if(name.endsWith(".json")) {
    try {const value=JSON.parse(buf.toString("utf8"));if(!value||Array.isArray(value)||typeof value!=="object")return failed("JSON object required");return {text:JSON.stringify(value),confidence:1,engine:"json",errors:[]};}
    catch{return failed("Invalid JSON");}
  }
  if(name.endsWith(".txt")) return {text:buf.toString("utf8"),confidence:1,engine:"text",errors:[]};
  const isPdf=name.endsWith(".pdf");
  if(isPdf) {
    try { const result=await pdf(buf);if(result.numpages>5)return failed("Maximum 5 PDF pages");if(result.text.trim().length>=40)return {text:result.text,confidence:.98,engine:"pdf-native",errors:[]};}
    catch{return failed("Unreadable PDF");}
  } else if(!/\.(jpg|jpeg|png)$/.test(name)) return failed("Unsupported file type");
  const dir=await mkdtemp(path.join(tmpdir(),"kiraa-ocr-"));
  try {
    const input=path.join(dir,isPdf?"input.pdf":"input"+path.extname(name));
    await writeFile(input,buf);
    let images=[input];
    if(isPdf) {
      await exec("pdftoppm",["-f","1","-l","5","-scale-to","2000","-png",input,path.join(dir,"page")],{timeout:60000,maxBuffer:1024*1024});
      images=(await readdir(dir)).filter(n=>n.endsWith(".png")).sort().map(n=>path.join(dir,n));
    }
    const texts:string[]=[], confidences:number[]=[];
    for(const [i,image] of images.entries()) {
      const output=path.join(dir,"ocr-"+i);
      await exec("tesseract",[image,output,"-l","eng+fra","txt","tsv"],{timeout:30000,maxBuffer:1024*1024});
      texts.push(await readFile(output+".txt","utf8"));
      for(const line of (await readFile(output+".tsv","utf8")).split("\n").slice(1)) {
        const columns=line.split("\t");const score=Number(columns[10]);
        if(columns[11]?.trim()&&Number.isFinite(score)&&score>=0)confidences.push(score/100);
      }
    }
    const text=texts.join("\n").trim();
    return {text,confidence:confidences.length?confidences.reduce((a,b)=>a+b,0)/confidences.length:0,engine:isPdf?"pdf-ocr":"tesseract",errors:text?[]:["No text extracted"]};
  } catch {return failed("OCR failed");}
  finally {await rm(dir,{recursive:true,force:true});}
}
