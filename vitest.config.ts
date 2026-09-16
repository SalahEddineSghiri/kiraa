import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve:{alias:{"@":path.resolve(__dirname)}},
  test:{include:["tests/*.test.ts"],maxWorkers:1,minWorkers:1,fileParallelism:false},
});
