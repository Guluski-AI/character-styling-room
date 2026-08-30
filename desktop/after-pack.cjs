const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const applicationPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const sign = spawnSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", applicationPath],
    { encoding: "utf8" },
  );
  if (sign.status !== 0) {
    throw new Error(
      `macOS ad-hoc 签名失败：${sign.stderr || sign.stdout || "unknown error"}`,
    );
  }
};
