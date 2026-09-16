import { expect,it,vi } from "vitest";
vi.mock("@/lib/agent/graph",()=>({runAgent:vi.fn(async s=>({...s,explanation:"OK"}))}));
vi.mock("@/lib/ingestor",()=>({ingestFile:vi.fn()}));
vi.mock("@/lib/reporter",()=>({generateQuotePdf:vi.fn()}));
import { POST } from "@/app/api/chat/route";
it("accepts a multipart message without an attachment",async()=>{
  const form=new FormData();form.set("message","Bonjour");form.set("params","{}");
  const result=await POST(new Request("http://localhost/api/chat",{method:"POST",body:form}));
  expect(result.status).toBe(200);
  expect((await result.json()).ocrConfidence).toBe(0);
});
