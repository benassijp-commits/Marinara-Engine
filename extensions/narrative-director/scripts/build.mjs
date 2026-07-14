import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = ["core.js", "storage.js", "api.js", "ui.js"];
const banner = `/* Narrative Curator v4 | browser extension build | generated, do not edit */\n`;
const sources = await Promise.all(sourceFiles.map((name) => readFile(resolve(root, "src", name), "utf8")));

await mkdir(resolve(root, "dist"), { recursive: true });
await writeFile(resolve(root, "dist", "extension.js"), `${banner}${sources.join("\n\n")}\n`, "utf8");
await writeFile(
  resolve(root, "dist", "extension.css"),
  await readFile(resolve(root, "src", "extension.css"), "utf8"),
  "utf8",
);
await writeFile(
  resolve(root, "dist", "manifest.json"),
  await readFile(resolve(root, "manifest.json"), "utf8"),
  "utf8",
);
await mkdir(resolve(root, "dist", "presets"), { recursive: true });
await writeFile(
  resolve(root, "dist", "presets", "marinara-agents.json"),
  await readFile(resolve(root, "presets", "marinara-agents.json"), "utf8"),
  "utf8",
);

process.stdout.write(`Built ${sourceFiles.length} modules into dist/extension.js\n`);
