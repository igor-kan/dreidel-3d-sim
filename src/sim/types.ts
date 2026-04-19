export type DreidelValue = "Nun" | "Gimel" | "Hei" | "Shin";

export interface DreidelVisualConfig {
  kind: "procedural" | "gltf";
  assetUrl?: string;
  scale?: number;
  yOffset?: number;
  rotationY?: number;
}

export interface DreidelModelDefinition {
  key: string;
  label: string;
  bodyTopRadius: number;
  bodyBottomRadius: number;
  bodyHeight: number;
  tipHeight: number;
  tipRadius: number;
  stemHeight: number;
  stemRadius: number;
  mass: number;
  colorA: number;
  colorB: number;
  stemColor: number;
  faceOrder: DreidelValue[];
  faceAngleOffset: number;
  visual?: DreidelVisualConfig;
}

export interface SpinOptions {
  spinRate: number;
  tilt: number;
}

export interface DreidelResult {
  value: DreidelValue;
  confidence: number;
  spinRateAtRest: number;
  linearSpeedAtRest: number;
  modelKey: string;
  timestamp: number;
}
