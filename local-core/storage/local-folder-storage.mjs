import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function makeImageId(filePath) {
  return createHash("sha256").update(filePath).digest("hex").slice(0, 20);
}

function isHiddenName(name) {
  return name.startsWith(".");
}

async function walkImages(root, options, current = root, depth = 0, images = []) {
  if (depth > options.maxDepth || images.length >= options.maxImages) return images;
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  for (const entry of entries) {
    if (images.length >= options.maxImages) break;
    if (isHiddenName(entry.name)) continue;
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkImages(root, options, entryPath, depth + 1, images);
      continue;
    }
    if (!entry.isFile() || !imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    const fileStat = await stat(entryPath);
    const relativePath = path.relative(root, entryPath);
    const folderParts = path.dirname(relativePath)
      .split(path.sep)
      .filter((part) => part && part !== ".");
    images.push({
      id: makeImageId(entryPath),
      name: path.basename(entry.name, path.extname(entry.name)),
      absolutePath: entryPath,
      relativePath,
      folder: folderParts.join(" / "),
      tags: folderParts.slice(-3),
      bytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    });
  }
  return images;
}

export class LocalFolderStorage {
  constructor(config = {}) {
    this.kind = "local-folder";
    this.resultsRoot = path.resolve(
      config.resultsRoot ?? path.join(process.cwd(), "local-data"),
    );
    this.maxImages = config.maxImages ?? 500;
    this.maxDepth = config.maxDepth ?? 8;
  }

  async scanWardrobe(folderPath) {
    const root = await realpath(path.resolve(folderPath));
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) throw new TypeError("衣柜路径必须是文件夹");
    const images = await walkImages(
      root,
      { maxImages: this.maxImages, maxDepth: this.maxDepth },
    );
    return {
      root,
      images,
      total: images.length,
      truncated: images.length >= this.maxImages,
    };
  }

  async createRun(metadata = {}) {
    await mkdir(this.resultsRoot, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const runId = `${timestamp}-${randomUUID().slice(0, 8)}`;
    const runDirectory = path.join(this.resultsRoot, "runs", runId);
    await mkdir(runDirectory, { recursive: true });
    await this.writeJson(path.join(runDirectory, "request.json"), {
      runId,
      createdAt: new Date().toISOString(),
      ...metadata,
    });
    return { runId, runDirectory };
  }

  async writeJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return filePath;
  }

  async readJson(filePath) {
    return JSON.parse(await readFile(filePath, "utf8"));
  }

  async importImage(sourcePath, targetDirectory, preferredName) {
    const resolvedSource = await realpath(path.resolve(sourcePath));
    const extension = path.extname(resolvedSource).toLowerCase();
    if (!imageExtensions.has(extension)) throw new TypeError("只支持图片文件");
    const safeName = (preferredName || path.basename(resolvedSource, extension))
      .replace(/[^a-z0-9\u4e00-\u9fff_-]/gi, "-")
      .replace(/-+/g, "-")
      .slice(0, 80);
    await mkdir(targetDirectory, { recursive: true });
    const targetPath = path.join(targetDirectory, `${safeName || "image"}${extension}`);
    await copyFile(resolvedSource, targetPath);
    return targetPath;
  }

  async saveUploadedImage({ bytes, fileName = "image.png", category = "imports" }) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new TypeError("上传图片内容为空");
    }
    const extension = path.extname(fileName).toLowerCase();
    if (!imageExtensions.has(extension)) {
      throw new TypeError("只支持 JPG、PNG 或 WebP 图片");
    }
    const baseName = path
      .basename(fileName, extension)
      .replace(/[^a-z0-9\u4e00-\u9fff_-]/gi, "-")
      .replace(/-+/g, "-")
      .slice(0, 72);
    const safeCategory = String(category)
      .replace(/[^a-z0-9_-]/gi, "-")
      .slice(0, 40);
    const targetDirectory = path.join(
      this.resultsRoot,
      "assets",
      safeCategory || "imports",
    );
    await mkdir(targetDirectory, { recursive: true });
    const targetPath = path.join(
      targetDirectory,
      `${Date.now()}-${randomUUID().slice(0, 8)}-${baseName || "image"}${extension}`,
    );
    await writeFile(targetPath, bytes);
    return targetPath;
  }
}
