import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),llm:vi.fn(),run:vi.fn()}));
vi.mock("@/db/client",()=>({pool:{query:mocks.query,connect:mocks.connect}}));
vi.mock("@/lib/llm",()=>({structuredCompletion:mocks.llm}));
vi.mock("@/lib/ingestor",()=>({ingestFile:vi.fn()}));
import { calculatorNode, reporterNode, extractorNode } from "@/lib/agent/graph";
import { KiraaStateSchema } from "@/lib/schemas/contracts";
import { verifyDriverEligibility } from "@/lib/engine";
const state=(overrides:Record<string,unknown>={})=>KiraaStateSchema.parse({requestId:"test",rawInput:"test",...overrides});
beforeEach(()=>vi.resetAllMocks());
describe("production safeguards",()=>{
  it("uses calendar birthday boundaries",()=>{
    expect(verifyDriverEligibility("2005-07-16","2020-01-01","2030-01-01","2026-07-15").age).toBe(20);
    expect(verifyDriverEligibility("2005-07-16","2020-01-01","2030-01-01","2026-07-16").age).toBe(21);
  });
  it("rejects an unknown vehicle instead of declaring availability",async()=>{
    mocks.query.mockResolvedValue({rows:[]});
    const result=await calculatorNode({state:state({intent:"check_availability",params:{vehicleId:"missing",startDate:"2027-01-01",endDate:"2027-01-03"}})});
    expect(result.state.validation.isValid).toBe(false);
  });
  it("uses stock count rather than rejecting the first overlap",async()=>{
    mocks.query.mockResolvedValueOnce({rows:[{vehicles_available:2}]}).mockResolvedValueOnce({rows:[{count:"1"}]});
    const result=await calculatorNode({state:state({intent:"check_availability",params:{vehicleId:"VH-1",startDate:"2027-01-01",endDate:"2027-01-03"}})});
    expect(result.state.validation.isValid).toBe(true);
  });
  it("requires a seasonal price instead of silently using 1",async()=>{
    mocks.query.mockResolvedValueOnce({rows:[{vehicles_available:2,category:"Economy"}]}).mockResolvedValueOnce({rows:[{count:"0"}]}).mockResolvedValueOnce({rows:[]});
    const result=await calculatorNode({state:state({intent:"calculate_total_cost",params:{vehicleId:"VH-1",startDate:"2027-01-01",endDate:"2027-01-03"}})});
    expect(result.state.validation.status).toBe("CLARIFICATION_REQUIRED");
  });
  it("blocks contradictory extraction",async()=>{
    mocks.llm.mockResolvedValue({params:{birthDate:"1990-01-01"},confidence:1,ambiguous:false,conflicts:[]});
    const result=await extractorNode({state:state({params:{birthDate:"1980-01-01"}})});
    expect(result.state.needsHumanReview).toBe(true);
    expect(result.state.validation.isValid).toBe(false);
  });
  it("does not persist a reservation pending human review",async()=>{
    const result=await reporterNode({state:state({intent:"make_reservation",needsHumanReview:true,validation:{isValid:true,errors:[],status:"OK"},priceResult:{totalPrice:1000}})});
    expect(result.state.bookingStatus).toBe("PENDING_REVIEW");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("does not confirm an unvalidated reservation",async()=>{
    const result=await reporterNode({state:state({intent:"make_reservation"})});
    expect(result.state.bookingStatus).not.toBe("CONFIRMED");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("commits customer and booking before returning CONFIRMED",async()=>{
    const query=vi.fn(async(sql:string)=>{
      if(sql.includes("FOR UPDATE")) return {rows:[{vehicles_available:1}]};
      if(sql.includes("count(*)")) return {rows:[{count:"0"}]};
      return {rows:[],rowCount:0};
    });
    const release=vi.fn();mocks.connect.mockResolvedValue({query,release});
    const result=await reporterNode({state:state({
      intent:"make_reservation",params:{fullName:"Test Client",vehicleId:"VH-1",birthDate:"1990-01-01",licenseIssueDate:"2010-01-01",licenseExpDate:"2030-01-01",startDate:"2027-01-01",endDate:"2027-01-03"},
      validation:{isValid:true,status:"OK",errors:[]},eligibilityResult:{riskCategory:"standard"},
      priceResult:{totalPrice:2600,days:2,deposit:2000,seasonalMultiplier:1},
    })});
    expect(result.state.bookingStatus).toBe("CONFIRMED");
    const sql=query.mock.calls.map(([s])=>s);
    expect(sql.some(s=>s.startsWith("INSERT INTO booking_logs"))).toBe(true);
    expect(sql.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });
  it("rejects when the stock changes before the transaction",async()=>{
    const query=vi.fn(async(sql:string)=>sql.includes("FOR UPDATE")?{rows:[{vehicles_available:1}]}:sql.includes("count(*)")?{rows:[{count:"1"}]}:{rows:[],rowCount:0});
    mocks.connect.mockResolvedValue({query,release:vi.fn()});
    const result=await reporterNode({state:state({intent:"make_reservation",validation:{isValid:true,status:"OK",errors:[]},priceResult:{totalPrice:100}})});
    expect(result.state.bookingStatus).toBe("REJECTED");
    expect(query.mock.calls.some(([sql])=>sql.startsWith("INSERT"))).toBe(false);
  });
});
