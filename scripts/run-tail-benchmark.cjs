/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const vitestBin =
  process.platform === "win32"
    ? path.join(root, "node_modules", ".bin", "vitest.cmd")
    : path.join(root, "node_modules", ".bin", "vitest");

const args = [
  "run",
  "src/lib/engine/__tests__/tail-assignment-benchmark.test.ts",
  "--reporter=verbose",
];

const result =
  process.platform === "win32"
    ? spawnSync(`"${vitestBin}" ${args.join(" ")}`, {
        cwd: root,
        env: { ...process.env, OCC_TAIL_BENCHMARK: "1" },
        stdio: "inherit",
        shell: true,
      })
    : spawnSync(vitestBin, args, {
        cwd: root,
        env: { ...process.env, OCC_TAIL_BENCHMARK: "1" },
        stdio: "inherit",
        shell: false,
      });

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
