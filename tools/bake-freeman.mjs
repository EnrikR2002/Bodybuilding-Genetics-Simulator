/* Re-bake the Freeman rig and skin weights with Blender.

   The surface and its vertex order are a contract (the projected anatomy is
   indexed by them), so the committed bake is backed up first and every
   surface block of the new bake is compared with it byte for byte. On any
   difference the backup is restored and the bake fails. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fixFile } from "./fix-freeman-weights.mjs";

const root = path.resolve(import.meta.dirname, "..");
const blend = path.join(root, "assets-src/mike-freeman/source/Mike_Freeman.blend");
const models = path.join(root, "public/models");
const local = path.join(root, ".tools/blender-runtime");
const candidates = [
  process.env.BLENDER_PATH,
  ...(fs.existsSync(local) ? fs.readdirSync(local).map((d) => path.join(local, d, "blender.exe")) : []),
].filter(Boolean);
const blender = candidates.find((p) => fs.existsSync(p)) || "blender";
if (!fs.existsSync(blend)) throw Error("Extract the Freeman archive into assets-src/mike-freeman/source first.");

export const SURFACE = ["position", "normal", "uv", "index", "cover", "smoothPosition", "smoothNormal"];

function read(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "freeman.json")));
  return { meta, bin: fs.readFileSync(path.join(dir, "freeman.bin")) };
}
function bytes({ meta, bin }, name) {
  const b = meta.blocks.find((x) => x.name === name);
  if (!b) return null;
  const size = { f: 4, I: 4, H: 2, B: 1 }[b.type];
  return bin.subarray(b.offset, b.offset + b.length * size);
}

const backup = fs.mkdtempSync(path.join(os.tmpdir(), "freeman-bake-"));
for (const f of ["freeman.json", "freeman.bin"]) fs.copyFileSync(path.join(models, f), path.join(backup, f));
const restore = (why) => {
  for (const f of ["freeman.json", "freeman.bin"]) fs.copyFileSync(path.join(backup, f), path.join(models, f));
  console.error(`Bake rejected, the committed files are restored: ${why}`);
  process.exit(1);
};

const result = spawnSync(blender, ["--background", blend, "--python-exit-code", "1", "--python",
  path.join(root, "tools/blender/bake_freeman.py")], { cwd: root, stdio: "inherit", windowsHide: true });
if (result.error) restore("Blender was not found. Set BLENDER_PATH to your Blender executable. " + result.error.message);
if (result.status !== 0) restore(`Blender exited with ${result.status}`);

const before = read(backup), after = read(models);
const names = [...SURFACE, ...before.meta.extras.flatMap((_, i) => [`extraPosition${i}`, `extraIndex${i}`])];
for (const name of names) {
  const a = bytes(before, name), b = bytes(after, name);
  if (!a || !b || !a.equals(b)) restore(`the ${name} block is not identical to the previous bake`);
}
if (after.meta.vertices !== before.meta.vertices) restore("the vertex count changed");
before.meta.bones.forEach((bone, i) => {
  const now = after.meta.bones[i];
  if (!now || now.name !== bone.name || now.parent !== bone.parent) restore(`bone ${bone.name} was renamed or moved`);
});
console.log(`Surface identical to the previous bake (${names.length} blocks); ${after.meta.bones.length} bones. Backup: ${backup}`);
// Blender writes raw heat weights; clean them (midline fade, trunk smoothing).
fixFile(models);
