import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createModelProvider, createStorageProvider } from "../create-services.mjs";
import { createLocalServer } from "../local-server.mjs";
import {
  CodexCliModelProvider,
  validateOutfitPlan,
} from "../model/codex-cli-provider.mjs";

test("provider factories keep model and storage replaceable", () => {
  assert.equal(createModelProvider().kind, "codex-cli");
  assert.equal(createStorageProvider().kind, "local-folder");
  assert.throws(
    () => createModelProvider({ provider: "future-api" }),
    /尚未配置模型提供方/,
  );
  assert.throws(
    () => createStorageProvider({ provider: "future-cloud" }),
    /尚未配置存储提供方/,
  );
});

test("Codex CLI manual path can be tested and replaced", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "styling-codex-path-"));
  const fakeCodex = path.join(root, "codex");
  await writeFile(fakeCodex, "#!/bin/sh\necho 'Logged in using ChatGPT'\n");
  await chmod(fakeCodex, 0o755);

  const provider = new CodexCliModelProvider({
    cwd: root,
    binaryPath: fakeCodex,
  });
  const connected = await provider.healthCheck();
  assert.equal(connected.status, "connected");
  assert.equal(connected.source, "manual");
  assert.equal(connected.binary, fakeCodex);

  provider.setBinaryPath(path.join(root, "missing-codex"));
  const missing = await provider.healthCheck();
  assert.equal(missing.status, "not_found");
  assert.equal(missing.authenticated, false);
});

test("local folder storage scans nested image folders and ignores hidden data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "styling-wardrobe-"));
  await mkdir(path.join(root, "夏季", "轻科技"), { recursive: true });
  await mkdir(path.join(root, ".internal"), { recursive: true });
  await writeFile(path.join(root, "夏季", "轻科技", "look-a.png"), "png");
  await writeFile(path.join(root, "夏季", "look-b.webp"), "webp");
  await writeFile(path.join(root, "夏季", "notes.txt"), "ignore");
  await writeFile(path.join(root, ".internal", "hidden.jpg"), "ignore");

  const storage = createStorageProvider({
    resultsRoot: path.join(root, ".results"),
  });
  const result = await storage.scanWardrobe(root);

  assert.equal(result.total, 2);
  assert.deepEqual(
    result.images.map((item) => item.name).sort(),
    ["look-a", "look-b"],
  );
  assert.deepEqual(
    result.images.find((item) => item.name === "look-a").tags,
    ["夏季", "轻科技"],
  );
});

test("outfit plan validation rejects malformed color values", () => {
  const outfit = {
    id: "look-01",
    direction: "方向 01",
    title: "测试方案",
    summary: "测试摘要",
    tags: ["清爽", "亲和", "夏季"],
    top: "浅色上装",
    bottom: "直筒长裤",
    shoes: "简洁鞋履",
    accessory: "极简配饰",
    hair: "保留发型",
    tone: "亲和自然",
    fit: "教程内容",
    swatches: ["#ffffff", "#aabbcc", "not-a-color"],
    imagePrompt: "完整生图提示词",
    consistency: "保持人物一致",
  };
  assert.throws(
    () => validateOutfitPlan({ outfits: [outfit, outfit, outfit] }),
    /swatches 格式无效/,
  );
});

test("local service scans and serves images only after folder authorization", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "styling-server-"));
  const resultsRoot = path.join(root, ".results");
  const wardrobeRoot = path.join(root, "衣柜", "夏季");
  await mkdir(wardrobeRoot, { recursive: true });
  const imagePath = path.join(wardrobeRoot, "look.png");
  await writeFile(imagePath, Buffer.from("fake-png"));

  const storage = createStorageProvider({ resultsRoot });
  const services = {
    storage,
    model: {
      kind: "test-model",
      async healthCheck() {
        return { provider: "test-model", authenticated: true };
      },
      async analyzeOutfits(_input, runContext) {
        const plan = { outfits: [{ id: "look-test" }] };
        const outputPath = path.join(runContext.runDirectory, "outfits.json");
        await runContext.storage.writeJson(outputPath, plan);
        return { plan, outputPath, provider: "test-model" };
      },
      async generateOutfitPreview(_input, runContext) {
        const imagePath = path.join(runContext.runDirectory, "look-test-preview.png");
        await writeFile(imagePath, "generated-image");
        return { imagePath, bytes: 15, provider: "test-model" };
      },
    },
  };
  const localServer = createLocalServer({ services, port: 0 });
  const address = await localServer.listen();
  context.after(() => localServer.close());

  const forbidden = await fetch(
    `${address.origin}/api/files?path=${encodeURIComponent(imagePath)}`,
  );
  assert.equal(forbidden.status, 403);

  const scan = await fetch(`${address.origin}/api/wardrobe/scan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath: path.join(root, "衣柜") }),
  });
  assert.equal(scan.status, 200);
  const scanBody = await scan.json();
  assert.equal(scanBody.total, 1);
  assert.equal(scanBody.images[0].folder, "夏季");

  const image = await fetch(`${address.origin}${scanBody.images[0].previewUrl}`);
  assert.equal(image.status, 200);
  assert.equal(Buffer.from(await image.arrayBuffer()).toString(), "fake-png");

  const imported = await fetch(`${address.origin}/api/assets/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: "角色.png",
      category: "characters",
      dataBase64: Buffer.from("character-image").toString("base64"),
    }),
  });
  assert.equal(imported.status, 201);
  const importedBody = await imported.json();
  assert.equal(
    (await readFile(importedBody.imagePath)).toString(),
    "character-image",
  );

  const analyze = await fetch(`${address.origin}/api/runs/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ characterImage: importedBody.imagePath }),
  });
  assert.equal(analyze.status, 202);
  const analyzeStarted = await analyze.json();
  assert.ok(analyzeStarted.jobId);

  let analyzeJob;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    analyzeJob = await fetch(
      `${address.origin}/api/jobs/${analyzeStarted.jobId}`,
    ).then((response) => response.json());
    if (analyzeJob.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(analyzeJob.status, "completed");
  assert.equal(analyzeJob.result.runId, analyzeStarted.runId);

  const preview = await fetch(
    `${address.origin}/api/runs/${analyzeStarted.runId}/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outfitId: "look-test" }),
    },
  );
  assert.equal(preview.status, 202);
  const previewStarted = await preview.json();
  let previewJob;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    previewJob = await fetch(
      `${address.origin}/api/jobs/${previewStarted.jobId}`,
    ).then((response) => response.json());
    if (previewJob.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(previewJob.status, "completed");
  assert.match(previewJob.result.previewUrl, /look-test-preview\.png/);
});
