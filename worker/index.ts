/** 별도 워커 프로세스 (WORKER_MODE=separate): pnpm worker */
import { config } from "dotenv";
config({ path: ".env.local", override: false, quiet: true });
config({ path: ".env", override: false, quiet: true });

const { startWorker } = await import("../lib/jobs/worker");
await startWorker();
