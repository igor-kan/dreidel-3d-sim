import * as CANNON from "cannon-es";
import { getLocalFaceNormals } from "./dreidelModels";
import type { DreidelModelDefinition, DreidelValue } from "./types";

export function detectFaceUp(
  quaternion: CANNON.Quaternion,
  model: DreidelModelDefinition
): { value: DreidelValue; confidence: number } {
  const up = new CANNON.Vec3(0, 1, 0);
  const localFaces = getLocalFaceNormals(model);

  let bestValue: DreidelValue = localFaces[0]?.value ?? "Nun";
  let bestDot = -Infinity;

  for (const face of localFaces) {
    const worldNormal = quaternion.vmult(face.normal);
    const dot = worldNormal.dot(up);
    if (dot > bestDot) {
      bestDot = dot;
      bestValue = face.value;
    }
  }

  const confidence = Math.min(1, Math.max(0, (bestDot + 1) / 2));
  return { value: bestValue, confidence };
}
