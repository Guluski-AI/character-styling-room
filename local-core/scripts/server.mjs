import { createLocalServer } from "../local-server.mjs";

const port = Number(process.env.STYLING_LOCAL_PORT ?? 43127);
const localServer = createLocalServer({ port });
const address = await localServer.listen();

process.stdout.write(
  `角色造型室本地服务已启动：${address.origin}\n结果目录：${localServer.services.storage.resultsRoot}\n`,
);

async function shutdown() {
  await localServer.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
