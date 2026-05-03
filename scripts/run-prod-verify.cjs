/* eslint-disable @typescript-eslint/no-require-imports */
const { spawnSync } = require("node:child_process");

const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

function runCommand(command, args, options) {
  if (process.platform !== "win32") {
    return spawnSync(command, args, { ...options, shell: false });
  }

  return spawnSync([command, ...args].join(" "), {
    ...options,
    shell: true,
  });
}

const s8BenchmarkEnv = {
  OCC_TAIL_BENCHMARK_SCHEDULE: "public/uat/uat_tail_assignment_schedule.csv",
  OCC_TAIL_BENCHMARK_AIRCRAFT: "public/uat/uat_tail_assignment_aircraft.csv",
  OCC_TAIL_BENCHMARK_DISRUPTION: "public/uat/uat_scenario_tail_assignment.csv",
};

const steps = [
  {
    name: "Lint",
    args: ["run", "lint"],
  },
  {
    name: "Unit and smoke tests",
    args: ["test"],
  },
  {
    name: "Production build",
    args: ["run", "build"],
  },
  {
    name: "S8 tail-assignment benchmark",
    args: ["run", "benchmark:tail"],
    env: s8BenchmarkEnv,
  },
];

for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.name}`);
  const result = runCommand(npmBin, step.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...step.env },
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`\nPROD verification failed during: ${step.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nPROD verification passed.");
