import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Random } from "../engine/random";
import { compileDriveProgram } from "./program";
import {
  DT,
  initialDriveState,
  observeDrive,
  RAY_ANGLES,
  stepDrive,
} from "./simulator";
import { pointAt, wrap } from "./world";
import { interpolateDrivePose } from "./render";
import type { DriveProgram, DriveState, DrivingWorld, Obstacle } from "./types";

export type CameraMode = "follow" | "driver" | "overview";
type Props = {
  program: DriveProgram;
  world: DrivingWorld;
  playing: boolean;
  speed: number;
  camera: CameraMode;
  sensors: boolean;
  manual: boolean;
  reset: number;
  obstacle: number;
  onFrame: (s: DriveState) => void;
};

function material(color: string, roughness = 0.8) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}
function box(w: number, h: number, d: number, color: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
function strip(
  points: DrivingWorld["points"],
  left: number,
  right: number,
  color: string,
  y: number,
) {
  const positions: number[] = [],
    indices: number[] = [];
  points.forEach((p, i) => {
    const nx = Math.cos(p.heading),
      nz = -Math.sin(p.heading);
    positions.push(
      p.x + nx * left,
      y,
      p.z + nz * left,
      p.x + nx * right,
      y,
      p.z + nz * right,
    );
    if (i) {
      const k = i * 2;
      indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const m = material(color);
  m.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}
function makeCar() {
  const group = new THREE.Group();
  const base = box(1.82, 0.55, 4.1, "#4969e8");
  base.position.y = 0.6;
  group.add(base);
  const hood = box(1.71, 0.17, 1.15, "#6482f6");
  hood.position.set(0, 0.9, 1.25);
  group.add(hood);
  const cabin = box(1.5, 0.6, 1.9, "#9db3e9");
  cabin.position.set(0, 1.15, -0.25);
  group.add(cabin);
  const glass = box(1.35, 0.43, 1.83, "#344760");
  glass.position.set(0, 1.15, -0.23);
  group.add(glass);
  const roof = box(1.43, 0.13, 1.36, "#eef3ff");
  roof.position.set(0, 1.5, -0.35);
  group.add(roof);
  const scanner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.15, 12),
    material("#384864"),
  );
  scanner.position.set(0, 1.64, -0.3);
  group.add(scanner);
  for (const x of [-0.6, 0.6]) {
    const light = box(0.38, 0.13, 0.06, "#faf9dc");
    light.position.set(x, 0.72, 2.09);
    group.add(light);
    const tail = box(0.35, 0.13, 0.06, "#dc656d");
    tail.position.set(x, 0.73, -2.09);
    group.add(tail);
    const mirror = box(0.18, 0.12, 0.25, "#eff2fa");
    mirror.position.set(x < 0 ? -1 : 1, 1.13, 0.35);
    group.add(mirror);
  }
  const wheels: THREE.Group[] = [];
  for (const z of [1.3, -1.3])
    for (const x of [-0.93, 0.93]) {
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.35, z);
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.24, 16),
        material("#253044"),
      );
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      wheel.add(tire);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.19, 0.19, 0.25, 8),
        material("#a1afc8"),
      );
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      group.add(wheel);
      wheels.push(wheel);
    }
  return { group, wheels };
}
function obstacleMesh(o: Obstacle) {
  const group = new THREE.Group();
  group.position.set(o.x, 0, o.z);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(o.radius * 0.9, o.radius, 0.9, 8),
    material("#e1a575"),
  );
  base.position.y = 0.45;
  base.castShadow = true;
  group.add(base);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(o.radius * 0.95, o.radius * 0.96, 0.19, 8),
    material("#fbf3df"),
  );
  band.position.y = 0.54;
  group.add(band);
  const top = new THREE.Mesh(
    new THREE.ConeGeometry(o.radius * 0.65, 0.45, 8),
    material("#d89968"),
  );
  top.position.y = 1.05;
  top.castShadow = true;
  group.add(top);
  return group;
}

export default function DrivingViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    live = useRef(props);
  const state = useRef<DriveState>(initialDriveState(props.world));
  const commands = useRef({
    reset: props.reset,
    obstacle: props.obstacle,
    program: props.program.id,
  });
  const [error, setError] = useState("");
  live.current = props;
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setError(
        "WebGL is unavailable in this browser. Enable hardware acceleration to view the driving simulator.",
      );
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor("#e9eef1");
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute(
      "aria-label",
      "Live 3D self-driving vehicle simulation",
    );
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e9eef1");
    scene.fog = new THREE.Fog("#e9eef1", 90, 250);
    const camera = new THREE.PerspectiveCamera(49, 1, 0.1, 1400);
    const ambient = new THREE.HemisphereLight("#f5f8ff", "#a7b4a0", 2.4);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight("#fff7e8", 2.4);
    sun.position.set(-65, 100, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 180;
    sun.shadow.camera.bottom = -180;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    sun.target.position.set(0, 0, 130);
    scene.add(sun.target);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      material("#dee6d8"),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.06, 130);
    ground.receiveShadow = true;
    scene.add(ground);
    const world = structuredClone(props.world);
    const half = world.width / 2;
    scene.add(strip(world.points, -half - 1.2, half + 1.2, "#c9cec5", 0));
    scene.add(strip(world.points, -half, half, "#697785", 0.015));
    scene.add(strip(world.points, -half + 0.2, -half + 0.33, "#e7ece6", 0.035));
    scene.add(strip(world.points, half - 0.33, half - 0.2, "#e7ece6", 0.035));
    for (let s = 8; s < world.length; s += 9) {
      const p = pointAt(world, s),
        mark = box(0.1, 0.025, 3.1, "#b3c2c8");
      mark.position.set(p.x, 0.045, p.z);
      mark.rotation.y = p.heading;
      scene.add(mark);
    }
    const rng = new Random(world.seed + 222);
    for (let i = 0; i < 100; i++) {
      const p = pointAt(world, rng.next() * world.length),
        side = rng.next() < 0.5 ? -1 : 1,
        offset = (12 + rng.next() * 65) * side;
      const tree = new THREE.Group();
      tree.position.set(
        p.x + Math.cos(p.heading) * offset,
        0,
        p.z - Math.sin(p.heading) * offset,
      );
      const height = 3 + rng.next() * 5;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.24, height * 0.4, 5),
        material("#9c9d88"),
      );
      trunk.position.y = height * 0.2;
      tree.add(trunk);
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(1.7 + rng.next(), height, 6),
        material(rng.next() < 0.5 ? "#a0b6a0" : "#b1c3a7"),
      );
      crown.position.y = height * 0.65;
      crown.castShadow = true;
      tree.add(crown);
      scene.add(tree);
    }
    for (let s = 10; s < world.length; s += 15) {
      const p = pointAt(world, s);
      for (const side of [-1, 1]) {
        const post = box(0.11, 0.9, 0.11, "#f5f4e8");
        post.position.set(
          p.x + Math.cos(p.heading) * (half + 0.8) * side,
          0.45,
          p.z - Math.sin(p.heading) * (half + 0.8) * side,
        );
        scene.add(post);
      }
    }
    const finish = pointAt(world, world.length - 4);
    const gate = new THREE.Group();
    gate.position.set(finish.x, 0, finish.z);
    gate.rotation.y = finish.heading;
    for (const x of [-half + 0.5, half - 0.5]) {
      const leg = box(0.18, 4, 0.18, "#a6b3c4");
      leg.position.set(x, 2, 0);
      gate.add(leg);
    }
    const top = box(world.width - 0.8, 0.5, 0.15, "#f1f4fa");
    top.position.set(0, 4, 0);
    gate.add(top);
    const flagCanvas = document.createElement("canvas");
    flagCanvas.width = 512;
    flagCanvas.height = 64;
    const ctx = flagCanvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#edf2fc";
      ctx.fillRect(0, 0, 512, 64);
      ctx.fillStyle = "#7384b1";
      ctx.font = "25px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("F I N I S H", 256, 43);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(world.width - 1, 0.5),
        new THREE.MeshBasicMaterial({
          map: new THREE.CanvasTexture(flagCanvas),
          side: THREE.DoubleSide,
        }),
      );
      sign.position.set(0, 4, -0.081);
      sign.rotation.y = Math.PI;
      gate.add(sign);
    }
    scene.add(gate);
    const obstacleGroup = new THREE.Group();
    world.obstacles.forEach((o) => obstacleGroup.add(obstacleMesh(o)));
    scene.add(obstacleGroup);
    const { group: car, wheels } = makeCar();
    scene.add(car);
    const sensorPositions = new Float32Array(5 * 6),
      sensorGeometry = new THREE.BufferGeometry();
    sensorGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(sensorPositions, 3),
    );
    const sensors = new THREE.LineSegments(
      sensorGeometry,
      new THREE.LineBasicMaterial({
        color: "#62bfb5",
        transparent: true,
        opacity: 0.43,
      }),
    );
    sensors.frustumCulled = false;
    scene.add(sensors);
    const trailPositions = new Float32Array(1200 * 3),
      trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(trailPositions, 3),
    );
    trailGeometry.setDrawRange(0, 0);
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({
        color: "#a9c1fa",
        transparent: true,
        opacity: 0.8,
      }),
    );
    trail.frustumCulled = false;
    scene.add(trail);
    let trailLength = 0,
      accumulator = 0,
      previousTime = 0,
      lastPublish = 0,
      animation = 0,
      finishTime = 0;
    let policy = compileDriveProgram(props.program),
      policyId = props.program.id;
    let cameraReady = false;
    state.current = initialDriveState(world);
    let previousPhysics = state.current;
    let cameraHeading = state.current.heading;
    let lastCameraMode = props.camera;
    const target = new THREE.Vector3();
    const position = new THREE.Vector3();
    const smoothTarget = new THREE.Vector3();
    const drivingFog = scene.fog;
    commands.current = {
      reset: props.reset,
      obstacle: props.obstacle,
      program: props.program.id,
    };
    const keys = new Set<string>();
    const down = (event: KeyboardEvent) => {
      if (
        !live.current.manual ||
        (event.target instanceof HTMLElement &&
          /INPUT|SELECT|TEXTAREA/.test(event.target.tagName))
      )
        return;
      const key = event.key.toLowerCase();
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
        ].includes(key)
      ) {
        keys.add(key);
        event.preventDefault();
      }
    };
    const up = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
    const blur = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height));
      camera.aspect = Math.max(1, width) / Math.max(1, height);
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    const reset = () => {
      state.current = initialDriveState(world);
      previousPhysics = state.current;
      cameraHeading = state.current.heading;
      accumulator = 0;
      trailLength = 0;
      trailGeometry.setDrawRange(0, 0);
      finishTime = 0;
      cameraReady = false;
    };
    const render = (now: number) => {
      const current = live.current;
      const elapsed = previousTime
        ? Math.min(0.08, (now - previousTime) / 1000)
        : 0;
      previousTime = now;
      if (policyId !== current.program.id) {
        policy = compileDriveProgram(current.program);
        policyId = current.program.id;
      }
      if (commands.current.reset !== current.reset) {
        commands.current.reset = current.reset;
        reset();
      }
      if (commands.current.obstacle !== current.obstacle) {
        commands.current.obstacle = current.obstacle;
        const s = state.current,
          o: Obstacle = {
            x: s.x + Math.sin(s.heading) * 22,
            z: s.z + Math.cos(s.heading) * 22,
            radius: 0.9,
            kind: "barrier",
            s: s.progress + 22,
          };
        world.obstacles.push(o);
        obstacleGroup.add(obstacleMesh(o));
      }
      if (current.playing && state.current.status === "driving") {
        accumulator += elapsed * current.speed;
        let ticks = 0;
        while (accumulator >= DT && ticks < 10) {
          const observed = observeDrive(state.current, world);
          const controls = current.manual
            ? {
                steering:
                  (Number(keys.has("d") || keys.has("arrowright")) -
                    Number(keys.has("a") || keys.has("arrowleft"))) *
                  0.85,
                throttle: Number(keys.has("w") || keys.has("arrowup")),
                brake: Number(keys.has("s") || keys.has("arrowdown")),
              }
            : policy(observed);
          previousPhysics = state.current;
          state.current = stepDrive(state.current, controls, world);
          state.current.sensors = observed;
          if (trailLength < 1200) {
            trailPositions[trailLength * 3] = state.current.x;
            trailPositions[trailLength * 3 + 1] = 0.075;
            trailPositions[trailLength * 3 + 2] = state.current.z;
            trailLength++;
            trailGeometry.setDrawRange(0, trailLength);
            trailGeometry.attributes.position.needsUpdate = true;
          }
          accumulator -= DT;
          ticks++;
          if (state.current.status !== "driving") break;
        }
      } else if (
        current.playing &&
        state.current.status === "finished" &&
        !current.manual
      ) {
        finishTime += elapsed;
        if (finishTime > 3) reset();
      }
      if (current.playing && state.current.status !== "driving")
        accumulator = Math.min(DT, accumulator + elapsed * current.speed);
      const s = {
        ...state.current,
        ...interpolateDrivePose(
          previousPhysics,
          state.current,
          accumulator / DT,
        ),
      };
      car.position.set(s.x, 0, s.z);
      car.rotation.y = s.heading;
      wheels[0].rotation.y = s.steer;
      wheels[1].rotation.y = s.steer;
      const ranges = observeDrive(s, world).slice(5, 10);
      RAY_ANGLES.forEach((angle, i) => {
        const x = s.x + Math.sin(s.heading) * 2,
          z = s.z + Math.cos(s.heading) * 2;
        sensorPositions[i * 6] = x;
        sensorPositions[i * 6 + 1] = 0.7;
        sensorPositions[i * 6 + 2] = z;
        sensorPositions[i * 6 + 3] =
          x + Math.sin(s.heading + angle) * ranges[i] * 35;
        sensorPositions[i * 6 + 4] = 0.1;
        sensorPositions[i * 6 + 5] =
          z + Math.cos(s.heading + angle) * ranges[i] * 35;
      });
      sensorGeometry.attributes.position.needsUpdate = true;
      sensors.visible = current.sensors;
      trail.visible = current.sensors;
      const smoothing = 1 - Math.exp(-6 * elapsed);
      cameraHeading = wrap(
        cameraHeading + wrap(s.heading - cameraHeading) * smoothing,
      );
      if (current.camera !== lastCameraMode) cameraReady = false;
      lastCameraMode = current.camera;
      if (current.camera === "overview") {
        scene.fog = null;
        position.set(120, 230, 65);
        target.set(0, 0, 135);
      } else if (current.camera === "driver") {
        scene.fog = drivingFog;
        position.set(
          s.x + Math.sin(s.heading) * 0.45,
          1.85,
          s.z + Math.cos(s.heading) * 0.45,
        );
        target.set(
          s.x + Math.sin(s.heading) * 35,
          1.6,
          s.z + Math.cos(s.heading) * 35,
        );
      } else {
        scene.fog = drivingFog;
        position.set(
          s.x - Math.sin(cameraHeading) * 15 + Math.cos(cameraHeading) * 7,
          10.5,
          s.z - Math.cos(cameraHeading) * 15 - Math.sin(cameraHeading) * 7,
        );
        target.set(
          s.x + Math.sin(cameraHeading) * 10,
          0.2,
          s.z + Math.cos(cameraHeading) * 10,
        );
      }
      if (!cameraReady || current.camera === "driver") {
        camera.position.copy(position);
        smoothTarget.copy(target);
      } else {
        camera.position.lerp(position, smoothing);
        smoothTarget.lerp(target, smoothing);
      }
      camera.lookAt(smoothTarget);
      cameraReady = true;
      renderer.render(scene, camera);
      if (now - lastPublish > 90) {
        current.onFrame({
          ...state.current,
          sensors: [...state.current.sensors],
        });
        lastPublish = now;
      }
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animation);
      resize.disconnect();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((m) => {
            if ("map" in m && m.map instanceof THREE.Texture) m.map.dispose();
            m.dispose();
          });
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [props.world]);
  return (
    <div className="driving-webgl" ref={host}>
      {error && <div className="webgl-error">{error}</div>}
    </div>
  );
}
