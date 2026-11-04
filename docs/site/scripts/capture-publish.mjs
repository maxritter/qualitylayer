import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";

/** Commit no captured pixels until every scene and its source check have passed. */
export async function publishCaptures(files, errors, verifySource) {
  if (errors.length) throw new Error("Capture runtime errors:\n" + errors.join("\n"));
  verifySource();
  for (const { source, target } of files) {
    await mkdir(dirname(target), { recursive: true });
    const temporary = target + ".capture-tmp";
    await copyFile(source, temporary);
    await rename(temporary, target);
  }
}
