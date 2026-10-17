import esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Builds main.js into the repo root (where Obsidian releases expect it next to manifest.json and
// styles.css). Set OBSIDIAN_VAULT to a vault folder to also install the build there while developing:
//   OBSIDIAN_VAULT="D:/path/to/vault" npm run dev
const here = dirname(fileURLToPath(import.meta.url));
const production = process.argv[2] === "production";
// `npm run demo` installs into the demo/ vault (screenshots, trying it out).
const vault = process.env.OBSIDIAN_VAULT ?? (process.argv.includes("demo") ? resolve(here, "demo") : undefined);

const installIntoVault = {
  name: "install-into-vault",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length || !vault) return;
      const dir = resolve(vault, ".obsidian/plugins/projects-system");
      await mkdir(dir, { recursive: true });
      for (const f of ["main.js", "manifest.json", "styles.css"]) {
        await copyFile(resolve(here, f), resolve(dir, f));
      }
      console.log(`[projects-system] installed into ${dir}`);
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: [resolve(here, "src/main.ts")],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: resolve(here, "main.js"),
  plugins: [installIntoVault],
});

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
