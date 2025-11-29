import fs from "fs";
import path from "path";
import { dispatchExtract } from "../lib/extraction/dispatcher";

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("Usage: ts-node scripts/test-extraction.ts <file> [more files]");
    process.exit(1);
  }

  for (const file of files) {
    try {
      const buffer = fs.readFileSync(file);
      const res = await dispatchExtract(buffer, path.basename(file), null);
      console.log(
        JSON.stringify(
          { file, meta: res.meta, previewSample: res.preview?.slice(0, 400) },
          null,
          2,
        ),
      );
    } catch (err) {
      console.error(`Failed to process ${file}:`, err);
    }
  }
}

main();
