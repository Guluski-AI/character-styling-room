const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stylingDesktop", {
  chooseWardrobeFolder() {
    return ipcRenderer.invoke("desktop:choose-wardrobe-folder");
  },
  getCodexCliPreference() {
    return ipcRenderer.invoke("desktop:get-codex-cli-preference");
  },
  chooseCodexCli() {
    return ipcRenderer.invoke("desktop:choose-codex-cli");
  },
  useAutoCodexCli() {
    return ipcRenderer.invoke("desktop:use-auto-codex-cli");
  },
  saveGeneratedImage(sourcePath, suggestedName) {
    return ipcRenderer.invoke(
      "desktop:save-generated-image",
      sourcePath,
      suggestedName,
    );
  },
});
