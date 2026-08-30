import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startProdServer } from "vinext/server/prod-server";
import { createLocalServer } from "../local-core/local-server.mjs";

const desktopDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(desktopDirectory, "..");
const apiPort = 43127;
const uiPort = 43128;

let mainWindow = null;
let localServer = null;
let uiServer = null;
let resultsRoot = "";
let desktopSettings = {
  codexCliPath: "",
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

async function loadDesktopSettings() {
  try {
    const saved = JSON.parse(await readFile(settingsPath(), "utf8"));
    desktopSettings = {
      codexCliPath:
        typeof saved.codexCliPath === "string" ? saved.codexCliPath : "",
    };
  } catch {
    desktopSettings = { codexCliPath: "" };
  }
}

async function saveDesktopSettings() {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(
    settingsPath(),
    `${JSON.stringify(desktopSettings, null, 2)}\n`,
    "utf8",
  );
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createWindow(uiOrigin) {
  const window = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 920,
    minHeight: 680,
    show: false,
    title: "角色造型室",
    backgroundColor: "#f5f4ef",
    webPreferences: {
      preload: path.join(desktopDirectory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(uiOrigin)) event.preventDefault();
  });
  void window.loadURL(uiOrigin);
  return window;
}

async function startApplication() {
  await loadDesktopSettings();
  resultsRoot = path.join(app.getPath("userData"), "data");
  const schemaPath = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "local-core",
        "schemas",
        "outfit-plan.schema.json",
      )
    : path.join(
        applicationRoot,
        "local-core",
        "schemas",
        "outfit-plan.schema.json",
      );

  localServer = createLocalServer({
    port: apiPort,
    serviceConfig: {
      model: {
        provider: "codex-cli",
        codexCli: {
          cwd: app.getPath("userData"),
          schemaPath,
          binaryPath: desktopSettings.codexCliPath || undefined,
        },
      },
      storage: {
        provider: "local-folder",
        resultsRoot,
        maxImages: 500,
      },
    },
  });
  await localServer.listen();

  const buildDirectory = path.join(applicationRoot, "dist");
  const startedUi = await startProdServer({
    host: "127.0.0.1",
    port: uiPort,
    outDir: buildDirectory,
    noCompression: true,
  });
  uiServer = startedUi.server;
  const uiOrigin = `http://127.0.0.1:${startedUi.port}`;
  mainWindow = createWindow(uiOrigin);
}

ipcMain.handle("desktop:choose-wardrobe-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择本地衣柜文件夹",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "使用这个文件夹",
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("desktop:get-codex-cli-preference", () => ({
  mode: desktopSettings.codexCliPath ? "manual" : "auto",
  path: desktopSettings.codexCliPath,
}));

ipcMain.handle("desktop:choose-codex-cli", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Codex CLI 可执行文件",
    defaultPath:
      desktopSettings.codexCliPath ||
      "/Applications/ChatGPT.app/Contents/Resources/codex",
    properties: ["openFile"],
    buttonLabel: "使用这个 Codex CLI",
    message: "通常位于 ChatGPT.app/Contents/Resources/codex",
  });
  const selectedPath = result.canceled ? null : result.filePaths[0] ?? null;
  if (!selectedPath) return null;

  desktopSettings.codexCliPath = selectedPath;
  await saveDesktopSettings();
  localServer?.services.model.setBinaryPath?.(selectedPath);
  return {
    mode: "manual",
    path: selectedPath,
  };
});

ipcMain.handle("desktop:use-auto-codex-cli", async () => {
  desktopSettings.codexCliPath = "";
  await saveDesktopSettings();
  localServer?.services.model.setBinaryPath?.("");
  return {
    mode: "auto",
    path: "",
  };
});

ipcMain.handle(
  "desktop:save-generated-image",
  async (_event, sourcePath, suggestedName) => {
    if (!resultsRoot || typeof sourcePath !== "string") {
      throw new Error("生成图片路径无效");
    }
    const resolvedRoot = await realpath(resultsRoot);
    const resolvedSource = await realpath(sourcePath);
    if (!isInside(resolvedRoot, resolvedSource)) {
      throw new Error("只能另存本应用生成的图片");
    }

    const sourceExtension = path.extname(resolvedSource).toLowerCase() || ".png";
    const safeName =
      (typeof suggestedName === "string" ? suggestedName : "穿搭预览")
        .replace(/[\\/:*?"<>|]/g, "-")
        .trim() || "穿搭预览";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存穿搭预览图",
      defaultPath: path.join(app.getPath("pictures"), `${safeName}${sourceExtension}`),
      buttonLabel: "保存图片",
      filters: [
        {
          name: "图片",
          extensions: [sourceExtension.replace(/^\./, "")],
        },
      ],
    });
    if (result.canceled || !result.filePath) return null;

    const targetPath = path.extname(result.filePath)
      ? result.filePath
      : `${result.filePath}${sourceExtension}`;
    await copyFile(resolvedSource, targetPath);
    return targetPath;
  },
);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      await startApplication();
    } catch (error) {
      dialog.showErrorBox(
        "角色造型室启动失败",
        error instanceof Error ? error.message : "本地服务未能启动",
      );
      app.quit();
    }
  });
}

app.on("activate", () => {
  if (!mainWindow && uiServer?.listening) {
    mainWindow = createWindow(`http://127.0.0.1:${uiPort}`);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  uiServer?.close();
  void localServer?.close();
});
