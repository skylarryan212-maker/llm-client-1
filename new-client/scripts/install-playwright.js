const { execSync } = require("node:child_process");

function installPlaywrightBrowsers() {
  // Ensure browsers are downloaded into node_modules so they ship with the deployment.
  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "0",
  };
  try {
    console.log("[postinstall] Installing Playwright Chromium browser...");
    execSync("npx playwright install chromium", { stdio: "inherit", env });
    console.log("[postinstall] Playwright Chromium installed.");
  } catch (error) {
    console.warn("[postinstall] Failed to install Playwright browser", error);
  }
}

installPlaywrightBrowsers();
