import { defineConfig } from "vitest/config";
import { isolatedTestTemp } from "./scripts/test-temp.js";

export default defineConfig({ test: { env: isolatedTestTemp("pi-contour-vitest-"), maxWorkers: 2, minWorkers: 1, testTimeout: 20_000, hookTimeout: 20_000 } });
