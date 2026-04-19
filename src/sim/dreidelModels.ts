import * as CANNON from "cannon-es";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { DreidelModelDefinition, DreidelValue } from "./types";

const gltfLoader = new GLTFLoader();
const scratchBox = new THREE.Box3();
const scratchSize = new THREE.Vector3();

export const DREIDEL_MODELS: DreidelModelDefinition[] = [
  {
    key: "classic",
    label: "Classic Wood",
    bodyTopRadius: 0.36,
    bodyBottomRadius: 0.5,
    bodyHeight: 0.92,
    tipHeight: 0.42,
    tipRadius: 0.24,
    stemHeight: 0.34,
    stemRadius: 0.11,
    mass: 0.09,
    colorA: 0xa86d37,
    colorB: 0x704322,
    stemColor: 0xd7b58a,
    faceOrder: ["Nun", "Gimel", "Hei", "Shin"],
    faceAngleOffset: 0,
    visual: { kind: "procedural" }
  },
  {
    key: "slim",
    label: "Slim Brass",
    bodyTopRadius: 0.3,
    bodyBottomRadius: 0.45,
    bodyHeight: 1.02,
    tipHeight: 0.35,
    tipRadius: 0.2,
    stemHeight: 0.4,
    stemRadius: 0.095,
    mass: 0.075,
    colorA: 0xc3b17a,
    colorB: 0x7d6a32,
    stemColor: 0xefe2bc,
    faceOrder: ["Nun", "Gimel", "Hei", "Shin"],
    faceAngleOffset: 0,
    visual: { kind: "procedural" }
  },
  {
    key: "chunky",
    label: "Chunky Ceramic",
    bodyTopRadius: 0.4,
    bodyBottomRadius: 0.57,
    bodyHeight: 0.86,
    tipHeight: 0.46,
    tipRadius: 0.26,
    stemHeight: 0.3,
    stemRadius: 0.125,
    mass: 0.11,
    colorA: 0x8ca8c8,
    colorB: 0x465f7d,
    stemColor: 0xe8eef7,
    faceOrder: ["Nun", "Gimel", "Hei", "Shin"],
    faceAngleOffset: 0,
    visual: { kind: "procedural" }
  },
  {
    key: "glb-oak",
    label: "GLB Oak (drop file in /public/models)",
    bodyTopRadius: 0.36,
    bodyBottomRadius: 0.5,
    bodyHeight: 0.92,
    tipHeight: 0.42,
    tipRadius: 0.24,
    stemHeight: 0.34,
    stemRadius: 0.11,
    mass: 0.09,
    colorA: 0xa86d37,
    colorB: 0x704322,
    stemColor: 0xd7b58a,
    faceOrder: ["Nun", "Gimel", "Hei", "Shin"],
    faceAngleOffset: 0,
    visual: {
      kind: "gltf",
      assetUrl: "/models/dreidel-oak.glb",
      scale: 1,
      yOffset: 0,
      rotationY: 0
    }
  },
  {
    key: "glb-ceramic",
    label: "GLB Ceramic (drop file in /public/models)",
    bodyTopRadius: 0.4,
    bodyBottomRadius: 0.57,
    bodyHeight: 0.86,
    tipHeight: 0.46,
    tipRadius: 0.26,
    stemHeight: 0.3,
    stemRadius: 0.125,
    mass: 0.11,
    colorA: 0x8ca8c8,
    colorB: 0x465f7d,
    stemColor: 0xe8eef7,
    faceOrder: ["Nun", "Gimel", "Hei", "Shin"],
    faceAngleOffset: 0,
    visual: {
      kind: "gltf",
      assetUrl: "/models/dreidel-ceramic.glb",
      scale: 1,
      yOffset: 0,
      rotationY: 0
    }
  }
];

const letterTextureCache = new Map<string, THREE.Texture>();

function getLabel(value: DreidelValue): string {
  switch (value) {
    case "Nun":
      return "N";
    case "Gimel":
      return "G";
    case "Hei":
      return "H";
    case "Shin":
      return "S";
    default:
      return "?";
  }
}

function getLetterTexture(value: DreidelValue, accent: number): THREE.Texture {
  const key = `${value}-${accent}`;
  const existing = letterTextureCache.get(key);
  if (existing) {
    return existing;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is required to render dreidel letters.");
  }

  context.fillStyle = "#f7f2e5";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "#1b1b1b";
  context.lineWidth = 8;
  context.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  context.fillStyle = `#${accent.toString(16).padStart(6, "0")}`;
  context.font = "700 154px 'Trebuchet MS', 'Segoe UI', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(getLabel(value), canvas.width / 2, canvas.height / 2 + 12);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  letterTextureCache.set(key, texture);
  return texture;
}

function enableShadows(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

function fitAssetToPhysicsBody(root: THREE.Object3D, model: DreidelModelDefinition): void {
  const visual = model.visual;
  const targetHeight = model.bodyHeight + model.tipHeight + model.stemHeight + model.stemRadius * 0.4;

  scratchBox.setFromObject(root);
  scratchBox.getSize(scratchSize);

  if (scratchSize.y > 1e-5) {
    const scaleMultiplier = (visual?.scale ?? 1) * (targetHeight / scratchSize.y);
    root.scale.multiplyScalar(scaleMultiplier);
  }

  scratchBox.setFromObject(root);

  const targetBottomY = -(model.bodyHeight / 2 + model.tipHeight);
  root.position.y += targetBottomY - scratchBox.min.y + (visual?.yOffset ?? 0);
  root.rotation.y += visual?.rotationY ?? 0;
}

export function createProceduralDreidelVisual(model: DreidelModelDefinition): THREE.Group {
  const group = new THREE.Group();
  group.name = `dreidel-${model.key}`;

  const thetaStart = -Math.PI / 4 + model.faceAngleOffset;

  const bodyGeometry = new THREE.CylinderGeometry(
    model.bodyTopRadius,
    model.bodyBottomRadius,
    model.bodyHeight,
    4,
    1,
    false,
    thetaStart
  );
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: model.colorA,
    roughness: 0.42,
    metalness: 0.16
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const accentGeometry = new THREE.CylinderGeometry(
    model.bodyTopRadius * 0.92,
    model.bodyBottomRadius * 0.82,
    model.bodyHeight * 0.4,
    4,
    1,
    false,
    thetaStart
  );
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: model.colorB,
    roughness: 0.46,
    metalness: 0.08
  });
  const accent = new THREE.Mesh(accentGeometry, accentMaterial);
  accent.position.y = model.bodyHeight * 0.07;
  accent.castShadow = true;
  accent.receiveShadow = true;
  group.add(accent);

  const tipGeometry = new THREE.CylinderGeometry(
    0,
    model.tipRadius,
    model.tipHeight,
    4,
    1,
    false,
    thetaStart
  );
  const tipMaterial = new THREE.MeshStandardMaterial({
    color: model.colorB,
    roughness: 0.36,
    metalness: 0.12
  });
  const tip = new THREE.Mesh(tipGeometry, tipMaterial);
  tip.position.y = -(model.bodyHeight + model.tipHeight) / 2;
  tip.castShadow = true;
  tip.receiveShadow = true;
  group.add(tip);

  const stemGeometry = new THREE.CylinderGeometry(model.stemRadius, model.stemRadius, model.stemHeight, 20);
  const stemMaterial = new THREE.MeshStandardMaterial({
    color: model.stemColor,
    roughness: 0.33,
    metalness: 0.2
  });
  const stem = new THREE.Mesh(stemGeometry, stemMaterial);
  stem.position.y = model.bodyHeight / 2 + model.stemHeight / 2;
  stem.castShadow = true;
  stem.receiveShadow = true;
  group.add(stem);

  const knobGeometry = new THREE.SphereGeometry(model.stemRadius * 0.8, 16, 16);
  const knob = new THREE.Mesh(knobGeometry, stemMaterial);
  knob.position.y = model.bodyHeight / 2 + model.stemHeight + model.stemRadius * 0.24;
  knob.castShadow = true;
  knob.receiveShadow = true;
  group.add(knob);

  const faceDistance = (model.bodyTopRadius + model.bodyBottomRadius) * 0.48;
  const faceHeight = model.bodyHeight * 0.28;
  const faceWidth = model.bodyBottomRadius * 0.48;

  model.faceOrder.forEach((value, index) => {
    const angle = model.faceAngleOffset + index * (Math.PI / 2);
    const normal = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));

    const faceGeometry = new THREE.PlaneGeometry(faceWidth, faceHeight);
    const faceMaterial = new THREE.MeshStandardMaterial({
      map: getLetterTexture(value, model.colorB),
      transparent: true,
      roughness: 0.5,
      metalness: 0,
      side: THREE.DoubleSide
    });
    const face = new THREE.Mesh(faceGeometry, faceMaterial);

    face.position.set(
      normal.x * faceDistance,
      model.bodyHeight * 0.06,
      normal.z * faceDistance
    );
    face.lookAt(face.position.clone().add(normal));
    group.add(face);
  });

  return group;
}

export async function loadDreidelVisual(model: DreidelModelDefinition): Promise<THREE.Group> {
  if (model.visual?.kind !== "gltf" || !model.visual.assetUrl) {
    return createProceduralDreidelVisual(model);
  }

  try {
    const gltf = await gltfLoader.loadAsync(model.visual.assetUrl);
    const source = gltf.scene ?? gltf.scenes[0];
    if (!source) {
      return createProceduralDreidelVisual(model);
    }

    const group = new THREE.Group();
    const modelRoot = source.clone(true);
    group.add(modelRoot);

    fitAssetToPhysicsBody(group, model);
    enableShadows(group);

    return group;
  } catch {
    return createProceduralDreidelVisual(model);
  }
}

export function createDreidelBody(model: DreidelModelDefinition, material: CANNON.Material): CANNON.Body {
  const body = new CANNON.Body({
    mass: model.mass,
    material,
    linearDamping: 0.2,
    angularDamping: 0.14,
    allowSleep: true,
    sleepSpeedLimit: 0.1,
    sleepTimeLimit: 0.9
  });

  const coreHalf = model.bodyBottomRadius * 0.57;
  const core = new CANNON.Box(new CANNON.Vec3(coreHalf, model.bodyHeight * 0.5, coreHalf));
  body.addShape(core);

  const crossCore = new CANNON.Box(
    new CANNON.Vec3(coreHalf * 0.92, model.bodyHeight * 0.46, coreHalf * 0.92)
  );
  const crossCoreRotation = new CANNON.Quaternion();
  crossCoreRotation.setFromAxisAngle(
    new CANNON.Vec3(0, 1, 0),
    Math.PI / 4 + model.faceAngleOffset
  );
  body.addShape(crossCore, new CANNON.Vec3(0, 0, 0), crossCoreRotation);

  const tip = new CANNON.Sphere(Math.max(0.03, model.tipRadius * 0.2));
  body.addShape(tip, new CANNON.Vec3(0, -(model.bodyHeight / 2 + model.tipHeight * 0.95), 0));

  const stem = new CANNON.Box(
    new CANNON.Vec3(model.stemRadius * 0.9, model.stemHeight * 0.5, model.stemRadius * 0.9)
  );
  body.addShape(stem, new CANNON.Vec3(0, model.bodyHeight / 2 + model.stemHeight / 2, 0));

  const knob = new CANNON.Sphere(model.stemRadius * 0.6);
  body.addShape(
    knob,
    new CANNON.Vec3(0, model.bodyHeight / 2 + model.stemHeight + model.stemRadius * 0.16, 0)
  );

  body.updateMassProperties();
  body.updateBoundingRadius();
  return body;
}

export function getLocalFaceNormals(
  model: DreidelModelDefinition
): Array<{ value: DreidelValue; normal: CANNON.Vec3 }> {
  return model.faceOrder.map((value, index) => {
    const angle = model.faceAngleOffset + index * (Math.PI / 2);
    return {
      value,
      normal: new CANNON.Vec3(Math.cos(angle), 0, Math.sin(angle))
    };
  });
}

export function getModelByKey(key: string): DreidelModelDefinition | undefined {
  return DREIDEL_MODELS.find((model) => model.key === key);
}
