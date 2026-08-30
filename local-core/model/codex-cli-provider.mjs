import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSchemaPath = path.resolve(
  moduleDirectory,
  "../schemas/outfit-plan.schema.json",
);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function asNonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} 不能为空`);
  }
  return value.trim();
}

function validateImagePath(value, field) {
  const imagePath = path.resolve(asNonEmptyString(value, field));
  if (!imageExtensions.has(path.extname(imagePath).toLowerCase())) {
    throw new TypeError(`${field} 必须是 JPG、PNG 或 WebP 图片`);
  }
  return imagePath;
}

function validateOutfitPlan(plan) {
  if (!plan || !Array.isArray(plan.outfits) || plan.outfits.length !== 3) {
    throw new Error("Codex CLI 未返回恰好 3 套穿搭方案");
  }

  const fields = [
    "id",
    "direction",
    "title",
    "summary",
    "top",
    "bottom",
    "shoes",
    "accessory",
    "hair",
    "tone",
    "fit",
    "imagePrompt",
    "consistency",
  ];
  const swatchPattern = /^#[0-9a-f]{6}$/i;

  plan.outfits.forEach((outfit, index) => {
    for (const field of fields) {
      asNonEmptyString(outfit?.[field], `outfits[${index}].${field}`);
    }
    if (!Array.isArray(outfit.tags) || outfit.tags.length < 3 || outfit.tags.length > 5) {
      throw new Error(`outfits[${index}].tags 数量无效`);
    }
    if (
      !Array.isArray(outfit.swatches) ||
      outfit.swatches.length !== 3 ||
      outfit.swatches.some((color) => !swatchPattern.test(color))
    ) {
      throw new Error(`outfits[${index}].swatches 格式无效`);
    }
  });

  return plan;
}

async function canExecute(candidate) {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveFromPath(command) {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const executableNames =
    process.platform === "win32"
      ? [command, `${command}.exe`, `${command}.cmd`]
      : [command];

  for (const directory of pathEntries) {
    for (const executableName of executableNames) {
      const candidate = path.join(directory, executableName);
      if (await canExecute(candidate)) return candidate;
    }
  }
  return null;
}

async function resolveCodexBinary(configuredPath) {
  if (configuredPath) {
    if (await canExecute(configuredPath)) {
      return { binary: configuredPath, source: "manual" };
    }
    const error = new Error(
      `手动设置的 Codex CLI 路径不可执行：${configuredPath}`,
    );
    error.code = "CODEX_NOT_FOUND";
    throw error;
  }

  const candidates = [
    { binary: process.env.CODEX_CLI_PATH, source: "environment" },
    {
      binary: "/Applications/ChatGPT.app/Contents/Resources/codex",
      source: "chatgpt-app",
    },
    { binary: "/opt/homebrew/bin/codex", source: "common-path" },
    { binary: "/usr/local/bin/codex", source: "common-path" },
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.binary && (await canExecute(candidate.binary))) return candidate;
  }

  const pathBinary = await resolveFromPath("codex");
  if (pathBinary) return { binary: pathBinary, source: "system-path" };

  const error = new Error(
    "未找到 Codex CLI。请安装 ChatGPT/Codex，或通过 CODEX_CLI_PATH 指定路径。",
  );
  error.code = "CODEX_NOT_FOUND";
  throw error;
}

function collectReadableDirectories(imagePaths) {
  return [...new Set(imagePaths.map((imagePath) => path.dirname(imagePath)))];
}

function runProcess(binary, args, { cwd, timeoutMs, allowNonZero = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) reject(new Error(`Codex CLI 超过 ${timeoutMs / 1000} 秒未完成`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      if (code === 0 || allowNonZero) {
        resolve({ stdout, stderr, code });
        return;
      }
      const error = new Error(
        `Codex CLI 执行失败（退出码 ${code}）\n${stderr || stdout}`.trim(),
      );
      error.exitCode = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function buildCommonArgs({ cwd, sandbox, model, reasoningEffort, imagePaths }) {
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "-C",
    cwd,
    "-s",
    sandbox,
    "-c",
    `model_reasoning_effort="${reasoningEffort}"`,
  ];
  if (model) args.push("-m", model);
  for (const directory of collectReadableDirectories(imagePaths)) {
    args.push("--add-dir", directory);
  }
  for (const imagePath of imagePaths) args.push("-i", imagePath);
  return args;
}

function makeAnalysisPrompt(input) {
  const referenceText = input.referenceImages.length
    ? `另有 ${input.referenceImages.length} 张穿搭收藏参考图，主要提取风格、配色、廓形和单品方向，不要完全复制。`
    : "本轮没有额外穿搭收藏参考图。";

  return [
    "你正在为本地应用“角色造型室”生成结构化穿搭方案。",
    "第一张图片是必须保持身份一致的数字角色参考。",
    referenceText,
    `角色身份：${input.role}`,
    `内容主题：${input.theme}`,
    `场景：${input.scene}`,
    `季节：${input.season}`,
    `风格：${input.styles.join("、")}`,
    input.avoid ? `避免：${input.avoid}` : "",
    "请输出恰好 3 套差异明显、可继续用于生图的方案。",
    "imagePrompt 必须是完整的中文生图提示词，consistency 必须说明人物一致性要求。",
    "严格按给定 JSON Schema 输出，不要添加 JSON 之外的文字。",
  ]
    .filter(Boolean)
    .join("\n");
}

function makeImagePrompt(input, targetPath) {
  return [
    "这是本地应用“角色造型室”的穿搭预览生成任务。",
    "请使用可用的图片生成能力，生成 1 张竖版、全身或接近全身的数字角色穿搭预览图。",
    "第一张图片是角色身份参考；其余图片是穿搭风格参考，只提取风格、配色、廓形和单品方向，不要完全复制。",
    `生图要求：${input.imagePrompt}`,
    `人物一致性：${input.consistency}`,
    `必须把最终图片保存或复制到绝对路径 ${targetPath}`,
    "不要修改其他项目文件。完成后只说明实际保存路径以及文件是否存在。",
  ].join("\n");
}

export class CodexCliModelProvider {
  constructor(config = {}) {
    this.kind = "codex-cli";
    this.cwd = path.resolve(config.cwd ?? process.cwd());
    this.schemaPath = path.resolve(config.schemaPath ?? defaultSchemaPath);
    this.binaryPath = config.binaryPath;
    this.model = config.model ?? process.env.CODEX_MODEL ?? "";
    this.reasoningEffort =
      config.reasoningEffort ?? process.env.CODEX_REASONING_EFFORT ?? "low";
    this.analysisTimeoutMs = config.analysisTimeoutMs ?? 8 * 60_000;
    this.imageTimeoutMs = config.imageTimeoutMs ?? 20 * 60_000;
  }

  setBinaryPath(binaryPath) {
    this.binaryPath =
      typeof binaryPath === "string" && binaryPath.trim()
        ? path.resolve(binaryPath.trim())
        : undefined;
  }

  async healthCheck() {
    try {
      const resolved = await resolveCodexBinary(this.binaryPath);
      const result = await runProcess(resolved.binary, ["login", "status"], {
        cwd: this.cwd,
        timeoutMs: 15_000,
        allowNonZero: true,
      });
      const detail = `${result.stdout}\n${result.stderr}`.trim();
      const authenticated =
        /logged in/i.test(detail) && !/not logged in/i.test(detail);
      return {
        provider: this.kind,
        binary: resolved.binary,
        source: resolved.source,
        configuredPath: this.binaryPath ?? "",
        status: authenticated ? "connected" : "not_authenticated",
        authenticated,
        detail,
      };
    } catch (error) {
      const notFound =
        error?.code === "CODEX_NOT_FOUND" || error?.code === "ENOENT";
      return {
        provider: this.kind,
        binary: "",
        source: this.binaryPath ? "manual" : "auto",
        configuredPath: this.binaryPath ?? "",
        status: notFound ? "not_found" : "not_authenticated",
        authenticated: false,
        detail: error instanceof Error ? error.message : "Codex CLI 检测失败",
      };
    }
  }

  async analyzeOutfits(rawInput, context) {
    const input = {
      characterImage: validateImagePath(rawInput.characterImage, "characterImage"),
      referenceImages: (rawInput.referenceImages ?? []).map((value, index) =>
        validateImagePath(value, `referenceImages[${index}]`),
      ),
      role: asNonEmptyString(rawInput.role, "role"),
      theme: asNonEmptyString(rawInput.theme, "theme"),
      scene: asNonEmptyString(rawInput.scene, "scene"),
      season: asNonEmptyString(rawInput.season ?? "不限", "season"),
      styles: Array.isArray(rawInput.styles)
        ? rawInput.styles.map((value, index) => asNonEmptyString(value, `styles[${index}]`))
        : [],
      avoid: typeof rawInput.avoid === "string" ? rawInput.avoid.trim() : "",
    };
    if (!input.styles.length) throw new TypeError("styles 至少需要一项");

    const runDirectory = path.resolve(
      asNonEmptyString(context?.runDirectory, "runDirectory"),
    );
    const outputPath = path.join(runDirectory, "outfits.json");
    const lastMessagePath = path.join(runDirectory, "analysis-last-message.json");
    const imagePaths = [input.characterImage, ...input.referenceImages];
    const { binary } = await resolveCodexBinary(this.binaryPath);
    const args = buildCommonArgs({
      cwd: this.cwd,
      sandbox: "workspace-write",
      model: this.model,
      reasoningEffort: this.reasoningEffort,
      imagePaths,
    });
    args.push(
      "--add-dir",
      runDirectory,
      "--output-schema",
      this.schemaPath,
      "-o",
      lastMessagePath,
      makeAnalysisPrompt(input),
    );

    await runProcess(binary, args, {
      cwd: this.cwd,
      timeoutMs: this.analysisTimeoutMs,
    });
    const plan = validateOutfitPlan(
      JSON.parse(await readFile(lastMessagePath, "utf8")),
    );
    await context.storage.writeJson(outputPath, plan);
    return { plan, outputPath, provider: this.kind };
  }

  async generateOutfitPreview(rawInput, context) {
    const characterImage = validateImagePath(
      rawInput.characterImage,
      "characterImage",
    );
    const referenceImages = (rawInput.referenceImages ?? []).map((value, index) =>
      validateImagePath(value, `referenceImages[${index}]`),
    );
    const outfitId = asNonEmptyString(rawInput.outfitId, "outfitId").replace(
      /[^a-z0-9_-]/gi,
      "-",
    );
    const imagePrompt = asNonEmptyString(rawInput.imagePrompt, "imagePrompt");
    const consistency = asNonEmptyString(rawInput.consistency, "consistency");
    const runDirectory = path.resolve(
      asNonEmptyString(context?.runDirectory, "runDirectory"),
    );
    const targetPath = path.join(runDirectory, `${outfitId}-preview.png`);
    const lastMessagePath = path.join(
      runDirectory,
      `${outfitId}-image-last-message.txt`,
    );
    const imagePaths = [characterImage, ...referenceImages];
    const { binary } = await resolveCodexBinary(this.binaryPath);
    const args = buildCommonArgs({
      cwd: this.cwd,
      sandbox: "workspace-write",
      model: this.model,
      reasoningEffort: "low",
      imagePaths,
    });
    args.push(
      "--add-dir",
      runDirectory,
      "-o",
      lastMessagePath,
      makeImagePrompt({ imagePrompt, consistency }, targetPath),
    );

    await runProcess(binary, args, {
      cwd: this.cwd,
      timeoutMs: this.imageTimeoutMs,
    });
    const imageStat = await stat(targetPath);
    if (!imageStat.isFile() || imageStat.size === 0) {
      throw new Error("Codex CLI 已结束，但没有生成有效的图片文件");
    }
    return {
      imagePath: targetPath,
      bytes: imageStat.size,
      provider: this.kind,
    };
  }
}

export { validateOutfitPlan };
