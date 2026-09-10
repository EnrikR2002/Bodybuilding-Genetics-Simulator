import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const blend = path.join(
  root,
  "assets-src/mike-freeman/source/Mike_Freeman.blend",
);
const local = path.join(root, ".tools/blender-runtime");
const candidates = [
  process.env.BLENDER_PATH,
  ...(fs.existsSync(local)
    ? fs.readdirSync(local).map((d) => path.join(local, d, "blender.exe"))
    : []),
].filter(Boolean);
const blender = candidates.find((p) => fs.existsSync(p)) || "blender";
if (!fs.existsSync(blend))
  throw Error(
    "Extract the Freeman archive into assets-src/mike-freeman/source first.",
  );
const result = spawnSync(
  blender,
  [
    "--background",
    blend,
    "--python-exit-code",
    "1",
    "--python",
    path.join(root, "tools/blender/bake_freeman.py"),
  ],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.error)
  throw Error(
    "Blender was not found. Set BLENDER_PATH to your Blender executable. " +
      result.error.message,
  );
if (result.status !== 0) process.exit(result.status ?? 1);
