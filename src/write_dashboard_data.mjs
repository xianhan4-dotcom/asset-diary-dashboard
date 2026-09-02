import fs from "node:fs/promises";
import path from "node:path";

export async function writeDashboardData(snapshots, projectRoot) {
  const outputPath = path.join(projectRoot, "web", "data", "snapshots.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), snapshots }, null, 2)}\n`,
    "utf8",
  );
  return outputPath;
}
