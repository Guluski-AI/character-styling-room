export const LOCAL_SERVICE_ORIGIN =
  process.env.NEXT_PUBLIC_STYLING_LOCAL_ORIGIN ?? "http://127.0.0.1:43127";

export type LocalWardrobeImage = {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  folder: string;
  tags: string[];
  bytes: number;
  modifiedAt: string;
  previewUrl: string;
};

export type LocalHealth = {
  ok: boolean;
  model: {
    provider: string;
    status: "connected" | "not_found" | "not_authenticated";
    authenticated: boolean;
    binary?: string;
    source?: string;
    configuredPath?: string;
    detail?: string;
  };
  storage: {
    provider: string;
    resultsRoot: string;
  };
};

type AnalyzeRequest = {
  characterImage: string;
  referenceImages: string[];
  role: string;
  theme: string;
  scene: string;
  season: string;
  styles: string[];
  avoid: string;
};

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LOCAL_SERVICE_ORIGIN}${pathname}`, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `本地服务请求失败（${response.status}）`);
  }
  return body;
}

function absolutePreviewUrl(relativeUrl: string) {
  return relativeUrl.startsWith("http")
    ? relativeUrl
    : `${LOCAL_SERVICE_ORIGIN}${relativeUrl}`;
}

type LocalJob<T> = {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  result: T | null;
  error: string | null;
};

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForJob<T>(jobId: string, timeoutMs = 15 * 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await requestJson<LocalJob<T>>(
      `/api/jobs/${encodeURIComponent(jobId)}`,
    );
    if (job.status === "completed" && job.result) return job.result;
    if (job.status === "failed") {
      throw new Error(job.error || "本地 Codex 任务执行失败");
    }
    await wait(2_000);
  }
  throw new Error("本地 Codex 任务等待超过 15 分钟，请检查 CLI 状态");
}

export async function checkLocalHealth() {
  return requestJson<LocalHealth>("/api/health");
}

export async function scanLocalWardrobe(folderPath: string) {
  const result = await requestJson<{
    root: string;
    images: LocalWardrobeImage[];
    total: number;
    truncated: boolean;
  }>("/api/wardrobe/scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folderPath }),
  });
  return {
    ...result,
    images: result.images.map((image) => ({
      ...image,
      previewUrl: absolutePreviewUrl(image.previewUrl),
    })),
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export async function importLocalAsset(
  file: File,
  category: "characters" | "references" = "characters",
) {
  const dataBase64 = await fileToBase64(file);
  const result = await requestJson<{
    imagePath: string;
    previewUrl: string;
  }>("/api/assets/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      category,
      dataBase64,
    }),
  });
  return {
    ...result,
    previewUrl: absolutePreviewUrl(result.previewUrl),
  };
}

export async function importDataUrlAsset(
  dataUrl: string,
  fileName: string,
) {
  const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const result = await requestJson<{
    imagePath: string;
    previewUrl: string;
  }>("/api/assets/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName,
      category: "references",
      dataBase64,
    }),
  });
  return {
    ...result,
    previewUrl: absolutePreviewUrl(result.previewUrl),
  };
}

export async function analyzeWithCodex(input: AnalyzeRequest) {
  const started = await requestJson<{
    jobId: string;
    runId: string;
    status: string;
  }>("/api/runs/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return waitForJob<{
    runId: string;
    outputPath: string;
    provider: string;
    plan: {
      outfits: Array<{
        id: string;
        direction: string;
        title: string;
        summary: string;
        tags: string[];
        top: string;
        bottom: string;
        shoes: string;
        accessory: string;
        hair: string;
        tone: string;
        fit: string;
        swatches: string[];
        imagePrompt: string;
        consistency: string;
      }>;
    };
  }>(started.jobId);
}

export async function generateWithCodex(
  runId: string,
  input: {
    characterImage: string;
    referenceImages: string[];
    outfitId: string;
    imagePrompt: string;
    consistency: string;
  },
) {
  const started = await requestJson<{
    jobId: string;
    runId: string;
    status: string;
  }>(`/api/runs/${encodeURIComponent(runId)}/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await waitForJob<{
    imagePath: string;
    bytes: number;
    provider: string;
    previewUrl: string;
  }>(started.jobId, 22 * 60_000);
  return {
    ...result,
    previewUrl: absolutePreviewUrl(result.previewUrl),
  };
}
