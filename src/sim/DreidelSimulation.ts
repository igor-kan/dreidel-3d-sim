import * as CANNON from "cannon-es";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createDreidelBody,
  createProceduralDreidelVisual,
  DREIDEL_MODELS,
  getModelByKey,
  loadDreidelVisual
} from "./dreidelModels";
import { detectFaceUp } from "./faceDetection";
import type { DreidelModelDefinition, DreidelResult, SpinLaunchInput, SpinOptions } from "./types";

const PHYSICS_FIXED_STEP = 1 / 120;
const MAX_SUB_STEPS = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class DreidelSimulation {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly world = new CANNON.World();
  private readonly clock = new THREE.Clock();

  private readonly tableMaterial = new CANNON.Material("table");
  private readonly dreidelMaterial = new CANNON.Material("dreidel");

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly pointerStart = new THREE.Vector2();
  private readonly pointerDrag = new THREE.Vector2();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly scratchForward = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();
  private readonly scratchWorldDrag = new THREE.Vector3();
  private readonly scratchBodyPosition = new THREE.Vector3();
  private readonly scratchTipPosition = new THREE.Vector3();
  private readonly scratchToTarget = new THREE.Vector3();

  private readonly container: HTMLElement;
  private readonly onSettled?: (result: DreidelResult) => void;

  private model: DreidelModelDefinition = DREIDEL_MODELS[0]!;
  private dreidelBody: CANNON.Body;
  private dreidelMesh: THREE.Group;

  private stopFrameCount = 0;
  private readonly stopFrameThreshold = 50;
  private isSpinning = false;
  private lastResult: DreidelResult | null = null;
  private visualLoadToken = 0;

  private pointerMode: "camera" | "tilt" | "spin" | null = null;
  private activePointerId: number | null = null;
  private pendingTiltX = 0;
  private pendingTiltZ = 0;
  private lastBodyYaw = Math.random() * Math.PI * 2;

  constructor(container: HTMLElement, onSettled?: (result: DreidelResult) => void) {
    this.container = container;
    this.onSettled = onSettled;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(320, container.clientHeight);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    this.camera.position.set(3.8, 2.9, 4.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.touchAction = "none";
    this.container.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.5, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.maxDistance = 10;
    this.controls.minDistance = 2;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.configureScene();
    this.configurePhysicsWorld();

    this.dreidelBody = createDreidelBody(this.model, this.dreidelMaterial);
    this.dreidelMesh = createProceduralDreidelVisual(this.model);
    this.world.addBody(this.dreidelBody);
    this.scene.add(this.dreidelMesh);
    this.reset();
    void this.refreshVisualForCurrentModel();

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown, { passive: false });
    window.addEventListener("pointermove", this.handlePointerMove, { passive: false });
    window.addEventListener("pointerup", this.handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", this.handlePointerCancel);
    window.addEventListener("blur", this.handlePointerCancel);
    window.addEventListener("resize", this.handleResize);

    this.animate();
  }

  public setModel(key: string): void {
    const model = getModelByKey(key);
    if (!model || model.key === this.model.key) {
      return;
    }

    this.world.removeBody(this.dreidelBody);
    this.scene.remove(this.dreidelMesh);

    this.model = model;
    this.dreidelBody = createDreidelBody(this.model, this.dreidelMaterial);
    this.dreidelMesh = createProceduralDreidelVisual(this.model);

    this.world.addBody(this.dreidelBody);
    this.scene.add(this.dreidelMesh);

    this.lastResult = null;
    this.stopFrameCount = 0;
    this.isSpinning = false;
    this.pendingTiltX = 0;
    this.pendingTiltZ = 0;
    this.lastBodyYaw = Math.random() * Math.PI * 2;
    this.reset();
    void this.refreshVisualForCurrentModel();
  }

  public spin(options: SpinOptions, launchInput: SpinLaunchInput = { source: "api" }): void {
    this.lastResult = null;
    this.isSpinning = true;
    this.stopFrameCount = 0;

    const source = launchInput.source;
    const baseTilt = clamp(options.tilt, 0.05, 0.85);

    this.dreidelBody.position.set(
      (Math.random() - 0.5) * 0.75,
      1.72 + Math.random() * 0.28,
      (Math.random() - 0.5) * 0.75
    );

    const requestedTiltX = clamp(launchInput.tiltX ?? 0, -0.75, 0.75);
    const requestedTiltZ = clamp(launchInput.tiltZ ?? 0, -0.75, 0.75);
    const tiltNoise = baseTilt * (0.36 + Math.random() * 0.8);

    const tiltX = requestedTiltX * 0.55 + (Math.random() - 0.5) * tiltNoise;
    const tiltZ = requestedTiltZ * 0.55 + (Math.random() - 0.5) * tiltNoise;

    const yaw = Math.random() * Math.PI * 2;
    this.lastBodyYaw = yaw;
    this.dreidelBody.quaternion.setFromEuler(tiltX, yaw, tiltZ, "XYZ");

    const translationalScatter = source === "admin" ? 0.62 : 0.92;
    this.dreidelBody.velocity.set(
      (Math.random() - 0.5) * translationalScatter,
      0,
      (Math.random() - 0.5) * translationalScatter
    );

    const dragX = clamp(launchInput.dragDirection?.x ?? 0, -1, 1);
    const dragZ = clamp(launchInput.dragDirection?.y ?? 0, -1, 1);

    const axis = new CANNON.Vec3(
      (Math.random() - 0.5) * baseTilt * 0.35 + dragX * 0.42,
      1,
      (Math.random() - 0.5) * baseTilt * 0.35 + dragZ * 0.42
    );
    axis.normalize();

    let launchSpinRate = clamp(options.spinRate, 6, 120);
    if (source === "admin") {
      launchSpinRate += (Math.random() - 0.5) * 1.6;
    } else if (source === "gesture") {
      launchSpinRate = launchSpinRate * (0.88 + Math.random() * 0.28) + (Math.random() - 0.5) * 5;
    } else {
      launchSpinRate = launchSpinRate * (0.9 + Math.random() * 0.24) + (Math.random() - 0.5) * 5.5;
    }
    launchSpinRate = clamp(launchSpinRate, 6, 130);

    this.dreidelBody.angularVelocity.set(
      axis.x * launchSpinRate,
      axis.y * launchSpinRate,
      axis.z * launchSpinRate
    );

    this.dreidelBody.force.set(0, 0, 0);
    this.dreidelBody.torque.set(0, 0, 0);
    this.dreidelBody.wakeUp();

    const nudge = new CANNON.Vec3((Math.random() - 0.5) * 0.09, 0, (Math.random() - 0.5) * 0.09);
    this.dreidelBody.applyImpulse(nudge, this.dreidelBody.position);

    this.pendingTiltX = 0;
    this.pendingTiltZ = 0;
  }

  public reset(): void {
    this.isSpinning = false;
    this.stopFrameCount = 0;

    this.dreidelBody.position.set(0, 1.5, 0);
    this.lastBodyYaw = Math.random() * Math.PI * 2;
    this.pendingTiltX = 0;
    this.pendingTiltZ = 0;
    this.dreidelBody.quaternion.setFromEuler(0.08, this.lastBodyYaw, 0.04, "XYZ");
    this.dreidelBody.velocity.set(0, 0, 0);
    this.dreidelBody.angularVelocity.set(0, 0, 0);
    this.dreidelBody.force.set(0, 0, 0);
    this.dreidelBody.torque.set(0, 0, 0);
    this.dreidelBody.wakeUp();

    this.syncMesh();
  }

  public getLastResult(): DreidelResult | null {
    return this.lastResult;
  }

  private readonly handleResize = (): void => {
    const width = Math.max(320, this.container.clientWidth);
    const height = Math.max(320, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType !== "touch") {
      return;
    }

    this.pointerMode = "camera";
    this.controls.enabled = true;

    if (this.isSpinning) {
      return;
    }

    const target = this.detectInteractionTarget(event);
    if (!target) {
      return;
    }

    this.pointerMode = target === "tip" ? "spin" : "tilt";
    this.activePointerId = event.pointerId;
    this.pointerStart.set(event.clientX, event.clientY);
    this.pointerDrag.set(0, 0);

    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) {
      return;
    }

    if (!this.pointerMode || this.pointerMode === "camera") {
      return;
    }

    this.pointerDrag.set(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);

    if (this.pointerMode === "tilt") {
      this.previewTiltFromDrag();
    }

    event.preventDefault();
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.activePointerId === null || event.pointerId !== this.activePointerId) {
      return;
    }

    if (this.pointerMode === "spin") {
      const dragMagnitude = Math.hypot(this.pointerDrag.x, this.pointerDrag.y);
      if (dragMagnitude >= 14) {
        this.launchFromTipDrag(this.pointerDrag.x, this.pointerDrag.y);
      }
    }

    this.releasePointerControl();
  };

  private readonly handlePointerCancel = (): void => {
    this.releasePointerControl();
  };

  private releasePointerControl(): void {
    if (this.activePointerId !== null && this.renderer.domElement.hasPointerCapture(this.activePointerId)) {
      this.renderer.domElement.releasePointerCapture(this.activePointerId);
    }

    this.pointerMode = null;
    this.activePointerId = null;
    this.pointerDrag.set(0, 0);
    this.controls.enabled = true;
  }

  private launchFromTipDrag(deltaX: number, deltaY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const viewportScale = Math.max(120, Math.min(rect.width, rect.height));
    const normalizedMagnitude = clamp(Math.hypot(deltaX, deltaY) / viewportScale, 0, 1.8);

    this.camera.getWorldDirection(this.scratchForward);
    this.scratchForward.y = 0;
    if (this.scratchForward.lengthSq() < 1e-6) {
      this.scratchForward.set(0, 0, -1);
    }
    this.scratchForward.normalize();

    this.scratchRight.crossVectors(this.scratchForward, this.worldUp);
    if (this.scratchRight.lengthSq() < 1e-6) {
      this.scratchRight.set(1, 0, 0);
    }
    this.scratchRight.normalize();

    this.scratchWorldDrag
      .copy(this.scratchRight)
      .multiplyScalar(deltaX)
      .addScaledVector(this.scratchForward, -deltaY);

    if (this.scratchWorldDrag.lengthSq() < 1e-6) {
      this.scratchWorldDrag.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    }
    this.scratchWorldDrag.normalize();

    const spinRate = 20 + normalizedMagnitude * 46;
    const tilt = 0.14 + normalizedMagnitude * 0.34;

    this.spin(
      {
        spinRate,
        tilt
      },
      {
        source: "gesture",
        tiltX: this.pendingTiltX,
        tiltZ: this.pendingTiltZ,
        dragDirection: {
          x: this.scratchWorldDrag.x,
          y: this.scratchWorldDrag.z
        }
      }
    );
  }

  private previewTiltFromDrag(): void {
    if (this.isSpinning) {
      return;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    const normX = this.pointerDrag.x / Math.max(1, rect.width);
    const normY = this.pointerDrag.y / Math.max(1, rect.height);

    this.pendingTiltX = clamp(-normY * 2.2, -0.6, 0.6);
    this.pendingTiltZ = clamp(normX * 2.2, -0.6, 0.6);

    this.dreidelBody.velocity.set(0, 0, 0);
    this.dreidelBody.angularVelocity.set(0, 0, 0);
    this.dreidelBody.force.set(0, 0, 0);
    this.dreidelBody.torque.set(0, 0, 0);
    this.dreidelBody.quaternion.setFromEuler(this.pendingTiltX, this.lastBodyYaw, this.pendingTiltZ, "XYZ");
    this.syncMesh();
  }

  private detectInteractionTarget(event: PointerEvent): "tip" | "body" | null {
    this.updatePointerNdc(event);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    this.scratchBodyPosition.set(
      this.dreidelBody.position.x,
      this.dreidelBody.position.y,
      this.dreidelBody.position.z
    );

    const tipLocalY = this.model.bodyHeight / 2 + this.model.stemHeight + this.model.stemRadius * 0.16;
    const tipLocal = new CANNON.Vec3(0, tipLocalY, 0);
    const tipWorld = this.dreidelBody.quaternion.vmult(tipLocal).vadd(this.dreidelBody.position);
    this.scratchTipPosition.set(tipWorld.x, tipWorld.y, tipWorld.z);

    const tipRadius = Math.max(0.09, this.model.stemRadius * 1.9);
    if (this.rayHitsSphere(this.scratchTipPosition, tipRadius)) {
      return "tip";
    }

    const bodyRadius = Math.max(this.model.bodyTopRadius, this.model.bodyBottomRadius) * 0.6;
    if (this.rayHitsSphere(this.scratchBodyPosition, bodyRadius)) {
      return "body";
    }

    return null;
  }

  private rayHitsSphere(center: THREE.Vector3, radius: number): boolean {
    this.scratchToTarget.copy(center).sub(this.raycaster.ray.origin);
    if (this.scratchToTarget.dot(this.raycaster.ray.direction) < 0) {
      return false;
    }

    const distanceSq = this.raycaster.ray.distanceSqToPoint(center);
    return distanceSq <= radius * radius;
  }

  private updatePointerNdc(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    this.pointerNdc.set(x * 2 - 1, -(y * 2 - 1));
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color(0xe6ecf4);

    const hemi = new THREE.HemisphereLight(0xf2e6c9, 0x4b5f7c, 1.35);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff6df, 2.2);
    keyLight.position.set(4.5, 8, 3.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.radius = 4;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 30;
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa8c8ff, 0.65);
    fillLight.position.set(-3.5, 4.5, -2.5);
    this.scene.add(fillLight);

    const tableGeometry = new THREE.BoxGeometry(8, 0.5, 8);
    const tableMeshMaterial = new THREE.MeshStandardMaterial({
      color: 0x6c7f96,
      roughness: 0.82,
      metalness: 0.05
    });
    const table = new THREE.Mesh(tableGeometry, tableMeshMaterial);
    table.position.y = -0.25;
    table.receiveShadow = true;
    this.scene.add(table);

    const ringGeometry = new THREE.TorusGeometry(2.4, 0.06, 14, 80);
    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x2e3d51, roughness: 0.4, metalness: 0.45 });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.001;
    ring.receiveShadow = true;
    this.scene.add(ring);
  }

  private configurePhysicsWorld(): void {
    this.world.gravity.set(0, -9.82, 0);
    this.world.allowSleep = true;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    const solver = this.world.solver as CANNON.GSSolver;
    solver.iterations = 20;
    solver.tolerance = 0.001;

    const contact = new CANNON.ContactMaterial(this.dreidelMaterial, this.tableMaterial, {
      friction: 0.44,
      restitution: 0.12,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e8,
      frictionEquationRelaxation: 3
    });
    this.world.addContactMaterial(contact);
    this.world.defaultContactMaterial.friction = 0.36;
    this.world.defaultContactMaterial.restitution = 0.08;

    const floor = new CANNON.Body({ mass: 0, material: this.tableMaterial });
    floor.addShape(new CANNON.Box(new CANNON.Vec3(4, 0.25, 4)));
    floor.position.set(0, -0.25, 0);
    this.world.addBody(floor);

    const wallThickness = 0.08;
    const wallHeight = 1.3;
    const wallExtent = 3.8;

    const northWall = new CANNON.Body({ mass: 0, material: this.tableMaterial });
    northWall.addShape(new CANNON.Box(new CANNON.Vec3(wallExtent, wallHeight, wallThickness)));
    northWall.position.set(0, wallHeight - 0.1, wallExtent + wallThickness);
    this.world.addBody(northWall);

    const southWall = new CANNON.Body({ mass: 0, material: this.tableMaterial });
    southWall.addShape(new CANNON.Box(new CANNON.Vec3(wallExtent, wallHeight, wallThickness)));
    southWall.position.set(0, wallHeight - 0.1, -wallExtent - wallThickness);
    this.world.addBody(southWall);

    const eastWall = new CANNON.Body({ mass: 0, material: this.tableMaterial });
    eastWall.addShape(new CANNON.Box(new CANNON.Vec3(wallThickness, wallHeight, wallExtent)));
    eastWall.position.set(wallExtent + wallThickness, wallHeight - 0.1, 0);
    this.world.addBody(eastWall);

    const westWall = new CANNON.Body({ mass: 0, material: this.tableMaterial });
    westWall.addShape(new CANNON.Box(new CANNON.Vec3(wallThickness, wallHeight, wallExtent)));
    westWall.position.set(-wallExtent - wallThickness, wallHeight - 0.1, 0);
    this.world.addBody(westWall);
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);

    const dt = Math.min(1 / 20, this.clock.getDelta());
    this.world.step(PHYSICS_FIXED_STEP, dt, MAX_SUB_STEPS);

    this.syncMesh();
    this.checkStopCondition();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private async refreshVisualForCurrentModel(): Promise<void> {
    const token = ++this.visualLoadToken;
    const modelAtRequest = this.model;
    const nextVisual = await loadDreidelVisual(modelAtRequest);

    if (token !== this.visualLoadToken || modelAtRequest.key !== this.model.key) {
      this.disposeObject(nextVisual);
      return;
    }

    const previous = this.dreidelMesh;
    nextVisual.position.copy(previous.position);
    nextVisual.quaternion.copy(previous.quaternion);

    this.scene.remove(previous);
    this.dreidelMesh = nextVisual;
    this.scene.add(this.dreidelMesh);

    this.disposeObject(previous);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) {
          material.dispose();
        }
      } else {
        mesh.material.dispose();
      }
    });
  }

  private syncMesh(): void {
    this.dreidelMesh.position.set(
      this.dreidelBody.position.x,
      this.dreidelBody.position.y,
      this.dreidelBody.position.z
    );
    this.dreidelMesh.quaternion.set(
      this.dreidelBody.quaternion.x,
      this.dreidelBody.quaternion.y,
      this.dreidelBody.quaternion.z,
      this.dreidelBody.quaternion.w
    );
  }

  private checkStopCondition(): void {
    if (!this.isSpinning) {
      return;
    }

    const linearSpeed = this.dreidelBody.velocity.length();
    const angularSpeed = this.dreidelBody.angularVelocity.length();

    if (linearSpeed < 0.05 && angularSpeed < 0.4) {
      this.stopFrameCount += 1;
    } else {
      this.stopFrameCount = 0;
    }

    if (this.dreidelBody.sleepState === CANNON.Body.SLEEPING) {
      this.stopFrameCount += 2;
    }

    if (this.stopFrameCount < this.stopFrameThreshold) {
      return;
    }

    const face = detectFaceUp(this.dreidelBody.quaternion, this.model);
    this.lastResult = {
      value: face.value,
      confidence: face.confidence,
      spinRateAtRest: Number(angularSpeed.toFixed(4)),
      linearSpeedAtRest: Number(linearSpeed.toFixed(4)),
      modelKey: this.model.key,
      timestamp: Date.now()
    };

    this.isSpinning = false;
    this.stopFrameCount = 0;
    this.onSettled?.(this.lastResult);
  }
}
