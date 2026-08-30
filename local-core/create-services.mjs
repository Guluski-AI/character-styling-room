import path from "node:path";
import { CodexCliModelProvider } from "./model/codex-cli-provider.mjs";
import { LocalFolderStorage } from "./storage/local-folder-storage.mjs";

export function createModelProvider(config = {}) {
  const provider = config.provider ?? process.env.STYLING_MODEL_PROVIDER ?? "codex-cli";
  if (provider === "codex-cli") {
    return new CodexCliModelProvider(config.codexCli);
  }
  throw new Error(
    `尚未配置模型提供方“${provider}”。当前支持 codex-cli，未来可在此接入 OpenAI API。`,
  );
}

export function createStorageProvider(config = {}) {
  const provider =
    config.provider ?? process.env.STYLING_STORAGE_PROVIDER ?? "local-folder";
  if (provider === "local-folder") {
    return new LocalFolderStorage({
      resultsRoot:
        config.resultsRoot ??
        process.env.STYLING_RESULTS_ROOT ??
        path.join(process.cwd(), "local-data"),
      maxImages: config.maxImages,
      maxDepth: config.maxDepth,
    });
  }
  throw new Error(
    `尚未配置存储提供方“${provider}”。当前支持 local-folder，未来可在此接入其他存储。`,
  );
}

export function createServices(config = {}) {
  return {
    model: createModelProvider(config.model),
    storage: createStorageProvider(config.storage),
  };
}
