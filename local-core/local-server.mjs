import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import { createServices } from "./create-services.mjs";

const mimeTypes = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function sendJson(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function sendNoContent(response, extraHeaders = {}) {
  response.writeHead(204, extraHeaders);
  response.end();
}

function getCorsHeaders(request) {
  const origin = request.headers.origin;
  if (
    !origin ||
    origin === "null" ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  ) {
    return {
      "access-control-allow-origin": origin || "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
    };
  }
  return null;
}

async function readJsonBody(request, maxBytes = 32 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("请求内容超过本地服务限制");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sanitizeRunId(value) {
  if (typeof value !== "string" || !/^[a-z0-9-]+$/i.test(value)) {
    throw new TypeError("运行记录 ID 无效");
  }
  return value;
}

function publicImage(image) {
  return {
    ...image,
    previewUrl: `/api/files?path=${encodeURIComponent(image.absolutePath)}`,
  };
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
  };
}

export function createLocalServer(options = {}) {
  const services = options.services ?? createServices(options.serviceConfig);
  const allowedRoots = new Set([path.resolve(services.storage.resultsRoot)]);
  const jobs = new Map();
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 43127;

  function startJob(type, task) {
    const job = {
      id: randomUUID(),
      type,
      status: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    };
    jobs.set(job.id, job);

    queueMicrotask(async () => {
      job.status = "running";
      job.startedAt = new Date().toISOString();
      try {
        job.result = await task();
        job.status = "completed";
      } catch (error) {
        job.error = error instanceof Error ? error.message : "本地任务执行失败";
        job.status = "failed";
      } finally {
        job.finishedAt = new Date().toISOString();
      }
    });

    return job;
  }

  const server = http.createServer(async (request, response) => {
    const corsHeaders = getCorsHeaders(request);
    if (!corsHeaders) {
      sendJson(response, 403, { error: "不允许从外部网页访问本地服务" });
      return;
    }
    if (request.method === "OPTIONS") {
      sendNoContent(response, corsHeaders);
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${host}`);
    try {
      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        const model = await services.model.healthCheck();
        sendJson(
          response,
          200,
          {
            ok: model.status
              ? model.status === "connected"
              : Boolean(model.authenticated),
            model,
            storage: {
              provider: services.storage.kind,
              resultsRoot: services.storage.resultsRoot,
            },
          },
          corsHeaders,
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/assets/import") {
        const body = await readJsonBody(request);
        if (typeof body.dataBase64 !== "string" || !body.dataBase64) {
          throw new TypeError("dataBase64 不能为空");
        }
        const bytes = Buffer.from(body.dataBase64, "base64");
        const imagePath = await services.storage.saveUploadedImage({
          bytes,
          fileName: body.fileName,
          category: body.category,
        });
        allowedRoots.add(path.resolve(services.storage.resultsRoot));
        sendJson(
          response,
          201,
          {
            imagePath,
            previewUrl: `/api/files?path=${encodeURIComponent(imagePath)}`,
          },
          corsHeaders,
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/wardrobe/scan") {
        const body = await readJsonBody(request, 128 * 1024);
        const result = await services.storage.scanWardrobe(body.folderPath);
        allowedRoots.add(result.root);
        sendJson(
          response,
          200,
          {
            ...result,
            images: result.images.map(publicImage),
          },
          corsHeaders,
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/api/runs/analyze") {
        const body = await readJsonBody(request, 2 * 1024 * 1024);
        const run = await services.storage.createRun({
          type: "outfit-analysis",
          input: body,
        });
        allowedRoots.add(run.runDirectory);
        const job = startJob("outfit-analysis", async () => {
          const result = await services.model.analyzeOutfits(body, {
            ...run,
            storage: services.storage,
          });
          return {
            runId: run.runId,
            outputPath: result.outputPath,
            provider: result.provider,
            plan: result.plan,
          };
        });
        sendJson(
          response,
          202,
          {
            jobId: job.id,
            runId: run.runId,
            status: job.status,
          },
          corsHeaders,
        );
        return;
      }

      const previewMatch = requestUrl.pathname.match(
        /^\/api\/runs\/([^/]+)\/preview$/,
      );
      if (request.method === "POST" && previewMatch) {
        const runId = sanitizeRunId(previewMatch[1]);
        const runDirectory = path.join(services.storage.resultsRoot, "runs", runId);
        const runStat = await stat(runDirectory);
        if (!runStat.isDirectory()) throw new Error("运行记录不存在");
        const body = await readJsonBody(request, 2 * 1024 * 1024);
        const job = startJob("outfit-preview", async () => {
          const result = await services.model.generateOutfitPreview(body, {
            runId,
            runDirectory,
            storage: services.storage,
          });
          allowedRoots.add(runDirectory);
          return {
            ...result,
            previewUrl: `/api/files?path=${encodeURIComponent(result.imagePath)}`,
          };
        });
        sendJson(
          response,
          202,
          {
            jobId: job.id,
            runId,
            status: job.status,
          },
          corsHeaders,
        );
        return;
      }

      const jobMatch = requestUrl.pathname.match(/^\/api\/jobs\/([^/]+)$/);
      if (request.method === "GET" && jobMatch) {
        const job = jobs.get(jobMatch[1]);
        if (!job) {
          sendJson(response, 404, { error: "本地任务不存在" }, corsHeaders);
          return;
        }
        sendJson(response, 200, publicJob(job), corsHeaders);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/api/files") {
        const requestedPath = requestUrl.searchParams.get("path");
        if (!requestedPath) throw new TypeError("缺少文件路径");
        const resolvedPath = await realpath(path.resolve(requestedPath));
        const allowed = [...allowedRoots].some((root) => isInside(root, resolvedPath));
        if (!allowed) {
          sendJson(response, 403, { error: "文件不在已授权的本地目录中" }, corsHeaders);
          return;
        }
        const extension = path.extname(resolvedPath).toLowerCase();
        const contentType = mimeTypes.get(extension);
        if (!contentType) {
          sendJson(response, 415, { error: "不支持读取该文件类型" }, corsHeaders);
          return;
        }
        const fileStat = await stat(resolvedPath);
        response.writeHead(200, {
          ...corsHeaders,
          "content-type": contentType,
          "content-length": fileStat.size,
          "cache-control": "private, max-age=60",
        });
        createReadStream(resolvedPath).pipe(response);
        return;
      }

      sendJson(response, 404, { error: "本地接口不存在" }, corsHeaders);
    } catch (error) {
      sendJson(
        response,
        400,
        {
          error: error instanceof Error ? error.message : "本地服务请求失败",
        },
        corsHeaders,
      );
    }
  });

  return {
    services,
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      const address = server.address();
      const actualPort =
        address && typeof address === "object" ? address.port : port;
      return {
        host,
        port: actualPort,
        origin: `http://${host}:${actualPort}`,
      };
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
