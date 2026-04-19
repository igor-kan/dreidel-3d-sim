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
import type { DreidelModelDefinition, DreidelResult, SpinOptions } from "./types";

const PHYSICS_FIXED_STEP = 1 / 120;
const MAX_SUB_STEPS = 6;

export class DreidelSimulation {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly world = new CANNON.World();
  private readonly clock = new THREE.Clock();

  private readonly tableMaterial = new CANNON.Material("table");
  private readonly dreidelMaterial = new CANNON.Material("dreidel");

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
    this.container.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.5, 0);
    this.controls.enableDamping = true;
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
    this.reset();
    void this.refreshVisualForCurrentModel();
  }

  public spin(options: SpinOptions): void {
    this.lastResult = null;
    this.isSpinning = true;
    this.stopFrameCount = 0;

    this.dreidelBody.position.set(
      (Math.random() - 0.5) * 0.7,
      1.75 + Math.random() * 0.2,
      (Math.random() - 0.5) * 0.7
    );

    const tiltX = (Math.random() - 0.5) * options.tilt;
    const tiltZ = (Math.random() - 0.5) * options.tilt;
    const yaw = Math.random() * Math.PI * 2;
    this.dreidelBody.quaternion.setFromEuler(tiltX, yaw, tiltZ, "XYZ");

    this.dreidelBody.velocity.set(
      (Math.random() - 0.5) * 0.8,
      0,
      (Math.random() - 0.5) * 0.8
    );

    const axis = new CANNON.Vec3(
      (Math.random() - 0.5) * options.tilt * 0.35,
      1,
      (Math.random() - 0.5) * options.tilt * 0.35
    );
    axis.normalize();
    this.dreidelBody.angularVelocity.set(
      axis.x * options.spinRate,
      axis.y * options.spinRate,
      axis.z * options.spinRate
    );

    this.dreidelBody.force.set(0, 0, 0);
    this.dreidelBody.torque.set(0, 0, 0);
    this.dreidelBody.wakeUp();

    const nudge = new CANNON.Vec3((Math.random() - 0.5) * 0.06, 0, (Math.random() - 0.5) * 0.06);
    this.dreidelBody.applyImpulse(nudge, this.dreidelBody.position);
  }

  public reset(): void {
    this.isSpinning = false;
    this.stopFrameCount = 0;

    this.dreidelBody.position.set(0, 1.5, 0);
    this.dreidelBody.quaternion.setFromEuler(0.08, Math.random() * Math.PI * 2, 0.04, "XYZ");
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
    const tableMaterial = new THREE.MeshStandardMaterial({
      color: 0x6c7f96,
      roughness: 0.82,
      metalness: 0.05
    });
    const table = new THREE.Mesh(tableGeometry, tableMaterial);
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
