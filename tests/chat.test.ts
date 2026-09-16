import { expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({runAgent:vi.fn(async s=>({...s,explanation:"OK"})),ingestFile:vi.fn()}));
vi.mock("@/lib/agent/graph",()=>({runAgent:mocks.runAgent}));
vi.mock("@/lib/ingestor",()=>({ingestFile:mocks.ingestFile}));
vi.mock("@/lib/reporter",()=>({generateQuotePdf:vi.fn()}));
import { POST } from "@/app/api/chat/route";
import Groq from "groq-sdk";
it("accepts a multipart message without an attachment",async()=>{
  const form=new FormData();form.set("message","Bonjour");form.set("params","{}");
  const result=await POST(new Request("http://localhost/api/chat",{method:"POST",body:form}));
  expect(result.status).toBe(200);
  expect((await result.json()).ocrConfidence).toBe(0);
});
it("accepts a licence alone and keeps the document separate from the user's intent",async()=>{
  mocks.ingestFile.mockResolvedValue({text:"PERMIS DE CONDUIRE 1990-01-01 2010-01-01 2030-01-01",confidence:.96,engine:"tesseract",errors:[]});
  const form=new FormData();form.set("message","");form.set("params","{}");
  form.append("files",new File(["image"],"permis.jpg",{type:"image/jpeg"}));
  const response=await POST(new Request("http://localhost/api/chat",{method:"POST",body:form}));
  expect(response.status).toBe(200);
  const state=mocks.runAgent.mock.lastCall?.[0];
  expect(state.userMessage).toContain("éligibilité");
  expect(state.documents[0].text).toContain("PERMIS");
  expect(state.userMessage).not.toContain("PERMIS DE CONDUIRE 1990");
});
it("returns HTTP 429 when Groq reaches its quota",async()=>{
  mocks.runAgent.mockRejectedValueOnce(Groq.APIError.generate(429,{},"quota",new Headers() as never));
  const form=new FormData();form.set("message","Quelle est la politique d'annulation ?");form.set("params","{}");
  const response=await POST(new Request("http://localhost/api/chat",{method:"POST",body:form}));
  expect(response.status).toBe(429);
  expect((await response.json()).error).toContain("Quota Groq");
});
