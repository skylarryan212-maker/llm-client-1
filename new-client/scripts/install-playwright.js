const { execSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

function installPlaywrightBrowsers() {
  // Ensure browsers are downloaded into node_modules so they ship with the deployment.
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "0",
  };
  try {
    console.log("[postinstall] Installing Playwright Chromium browser...");
    execSync("npx playwright install chromium chromium-headless-shell", { stdio: "inherit", env });
    console.log("[postinstall] Playwright Chromium + headless shell installed.");
    const expected = join(
      process.cwd(),
      "node_modules",
      "playwright-core",
      ".local-browsers",
      "chromium_headless_shell-1200",
      process.platform === "win32"
        ? "chrome-headless-shell-win64"
        : process.platform === "darwin"
          ? "chrome-headless-shell-mac-x64"
          : "chrome-headless-shell-linux64",
      process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell"
    );
    if (!existsSync(expected)) {
      throw new Error(`Playwright browser missing after install: ${expected}`);
    }
    console.log("[postinstall] Playwright browser verified.");
  } catch (error) {
    console.error("[postinstall] Failed to install Playwright browser", error);
    process.exit(1);
  }
}

installPlaywrightBrowsers();
