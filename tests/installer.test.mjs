import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = join(process.cwd(), "scripts", "install.mjs");

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, HIAPI_API_KEY: "" },
  });
}

test("installer exposes the GitHub installation command", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /github:HiAPIAI\/hiapi-2d-to-3d-video-skill/);
  assert.match(result.stdout, /--force/);
});

test("installer copies only runtime skill files and protects existing installs", async () => {
  const root = await mkdtemp(join(tmpdir(), "animation-forge-install-"));
  try {
    const first = run([`--target=${root}`, "--yes"]);
    assert.equal(first.status, 0, first.stderr);

    const destination = join(root, "hiapi-2d-to-3d-video");
    assert.match(await readFile(join(destination, "SKILL.md"), "utf8"), /HiAPI Animation Forge/);
    await assert.rejects(readFile(join(destination, "TODO.md"), "utf8"), /ENOENT/);

    const marker = join(destination, "local-marker.txt");
    await writeFile(marker, "keep until forced");
    const protectedRun = run([`--target=${root}`, "--yes"]);
    assert.notEqual(protectedRun.status, 0);
    assert.equal(await readFile(marker, "utf8"), "keep until forced");

    const forcedRun = run([`--target=${root}`, "--yes", "--force"]);
    assert.equal(forcedRun.status, 0, forcedRun.stderr);
    await assert.rejects(readFile(marker, "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
