import { startMockBackend } from "./mockBackend.mjs";

const backend = await startMockBackend();

process.stdout.write(`${JSON.stringify({ url: backend.url, devicePin: backend.devicePin })}\n`);

const keepAlive = setInterval(() => {}, 1 << 30);

async function shutdown() {
  clearInterval(keepAlive);
  await backend.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
