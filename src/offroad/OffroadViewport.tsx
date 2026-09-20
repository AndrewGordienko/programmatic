import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Random } from "../engine/random";
import { compile } from "./program";
import { DT, initialState, observe, step } from "./simulator";
import { heightAt, wrap } from "./terrain";
import {
  ANGLES,
  RAYS,
  SCAN_RANGE,
  type Program,
  type Rock,
  type Terrain,
  type Truck,
} from "./types";
type Props = {
  program: Program;
  terrain: Terrain;
  playing: boolean;
  speed: number;
  camera: "chase" | "overhead" | "onboard";
  sensors: boolean;
  reset: number;
  obstacle: number;
  manual: boolean;
  onFrame: (s: Truck) => void;
};
const mat = (color: string) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
function box(x: number, y: number, z: number, color: string) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function truck() {
  const car = new THREE.Group();
  const body = box(2, 0.56, 4.8, "#ecece3");
  body.position.y = 0.94;
  car.add(body);
  const trim = box(2.08, 0.18, 4.55, "#475958");
  trim.position.y = 0.61;
  car.add(trim);
  const hood = box(1.94, 0.25, 1.6, "#ebede5");
  hood.position.set(0, 1.34, 1.38);
  car.add(hood);
  const cabin = box(1.77, 0.7, 1.8, "#647a86");
  cabin.position.set(0, 1.56, 0.08);
  car.add(cabin);
  const roof = box(1.88, 0.16, 1.9, "#f5f5eb");
  roof.position.set(0, 1.97, 0.04);
  car.add(roof);
  const bed = box(1.66, 0.12, 1.18, "#566663");
  bed.position.set(0, 1.2, -1.61);
  car.add(bed);
  for (const x of [-0.93, 0.93]) {
    const rail = box(0.14, 0.4, 1.4, "#dadfd7");
    rail.position.set(x, 1.38, -1.5);
    car.add(rail);
  }
  const bumper = box(2.07, 0.2, 0.16, "#414f4e");
  bumper.position.set(0, 0.73, 2.49);
  car.add(bumper);
  const grill = box(1.16, 0.29, 0.08, "#2f4446");
  grill.position.set(0, 1.05, 2.44);
  car.add(grill);
  for (const x of [-0.79, 0.79]) {
    const light = box(0.34, 0.19, 0.09, "#fff6cf");
    light.position.set(x, 1.14, 2.44);
    car.add(light);
    const tail = box(0.18, 0.28, 0.1, "#bb6a51");
    tail.position.set(x, 1.07, -2.43);
    car.add(tail);
  }
  const wheels: THREE.Group[] = [];
  for (const z of [1.65, -1.65])
    for (const x of [-1.02, 1.02]) {
      const w = new THREE.Group();
      w.position.set(x, 0.51, z);
      const tyre = new THREE.Mesh(
        new THREE.CylinderGeometry(0.51, 0.51, 0.38, 14),
        mat("#283b3a"),
      );
      tyre.rotation.z = Math.PI / 2;
      tyre.castShadow = true;
      w.add(tyre);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.39, 8),
        mat("#b0b9ab"),
      );
      hub.rotation.z = Math.PI / 2;
      w.add(hub);
      car.add(w);
      wheels.push(w);
    }
  return { car, wheels };
}
function rockMesh(r: Rock, t: Terrain, index: number) {
  const g = new THREE.Group();
  g.position.set(r.x, heightAt(t, r.x, r.z), r.z);
  if (t.kind === "woodland" && index % 3 === 2) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(r.radius * 0.7, r.radius, 5, 7),
      mat("#8d806a"),
    );
    trunk.position.y = 2.5;
    trunk.castShadow = true;
    g.add(trunk);
    for (let j = 0; j < 3; j++) {
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(r.radius * 2.3 - j * 0.25, 4.5, 7),
        mat(j % 2 ? "#648678" : "#78907a"),
      );
      crown.position.y = 4 + j * 1.8;
      crown.castShadow = true;
      g.add(crown);
    }
  } else {
    const m = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      mat(t.kind === "quarry" ? "#a69f8d" : "#8b9688"),
    );
    m.scale.set(r.radius, r.height * 0.65, r.radius);
    m.position.y = r.height * 0.4;
    m.rotation.y = index * 1.37;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
function disposeObject(object: THREE.Object3D) {
  object.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        m.dispose(),
      );
    }
  });
}
export default function OffroadViewport(props: Props) {
  const host = useRef<HTMLDivElement>(null),
    live = useRef(props);
  live.current = props;
  const [error, setError] = useState("");
  useEffect(() => {
    if (!host.current) return;
    const element = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setError(
        "WebGL is unavailable. Enable hardware acceleration to view the terrain.",
      );
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute(
      "aria-label",
      "Live 3D off-road truck on uneven terrain",
    );
    element.appendChild(renderer.domElement);
    const terrain = structuredClone(props.terrain),
      scene = new THREE.Scene();
    scene.background = new THREE.Color("#e8efe9");
    scene.fog = new THREE.Fog("#e8efe9", 90, 190);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
    scene.add(new THREE.HemisphereLight("#eff5ff", "#9ca38a", 2.5));
    const sun = new THREE.DirectionalLight("#fff3dc", 2.8);
    sun.position.set(-40, 80, -15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -65;
    sun.shadow.camera.right = 65;
    sun.shadow.camera.top = 65;
    sun.shadow.camera.bottom = -65;
    sun.shadow.camera.far = 180;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    const geometry = new THREE.PlaneGeometry(
      terrain.size,
      terrain.size,
      terrain.resolution - 1,
      terrain.resolution - 1,
    );
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3),
      rng = new Random(terrain.seed + 50);
    const grass = new THREE.Color(
        terrain.kind === "quarry" ? "#c7bda0" : "#a8bd8f",
      ),
      dark = new THREE.Color("#7f9673"),
      mud = new THREE.Color("#9d9477"),
      stone = new THREE.Color("#babaa6");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i),
        y = heightAt(terrain, x, z);
      pos.setY(i, y);
      const color = grass
        .clone()
        .lerp(dark, Math.min(0.55, Math.max(0, y / 20)));
      for (const p of terrain.patches)
        if (Math.hypot(x - p.x, z - p.z) < p.radius)
          color.lerp(p.surface === "mud" ? mud : stone, 0.65);
      color.multiplyScalar(0.95 + rng.next() * 0.1);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    ground.receiveShadow = true;
    scene.add(ground);
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(terrain.size, 14, terrain.size),
      mat("#b1b49b"),
    );
    skirt.position.y = Math.min(...terrain.heights) - 7.1;
    scene.add(skirt);
    const obstacles = new THREE.Group();
    terrain.rocks.forEach((r, i) => obstacles.add(rockMesh(r, terrain, i)));
    scene.add(obstacles);
    const goalHeight = heightAt(terrain, terrain.goal.x, terrain.goal.z);
    const beacon = new THREE.Group();
    beacon.position.set(terrain.goal.x, goalHeight + 0.12, terrain.goal.z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.5, 4, 48),
      new THREE.MeshBasicMaterial({
        color: "#637fde",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    beacon.add(ring);
    const post = box(0.12, 5, 0.12, "#f2f5f1");
    post.position.y = 2.5;
    beacon.add(post);
    const flag = box(1.7, 0.9, 0.06, "#7587dc");
    flag.position.set(0.85, 4.5, 0);
    beacon.add(flag);
    scene.add(beacon);
    const { car, wheels } = truck();
    scene.add(car);
    const linePositions = new Float32Array(RAYS * 6),
      lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(linePositions, 3),
    );
    const scanLines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: "#d3edc3",
        transparent: true,
        opacity: 0.4,
      }),
    );
    scanLines.frustumCulled = false;
    scene.add(scanLines);
    const trailPoints = new Float32Array(1000 * 3),
      trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(trailPoints, 3),
    );
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({
        color: "#637ddb",
        transparent: true,
        opacity: 0.85,
      }),
    );
    trail.frustumCulled = false;
    scene.add(trail);
    let state = initialState(terrain),
      previous = state,
      policy = compile(props.program),
      policyProgram = props.program,
      lastReset = props.reset,
      lastObstacle = props.obstacle,
      acc = 0,
      last = 0,
      lastPublish = 0,
      animation = 0,
      trailLength = 0,
      heading = state.heading,
      cameraReady = false,
      mode = props.camera;
    const cameraTarget = new THREE.Vector3(),
      desiredTarget = new THREE.Vector3(),
      desiredPosition = new THREE.Vector3();
    const orientation = new THREE.Quaternion(),
      yaw = new THREE.Quaternion(),
      tilt = new THREE.Quaternion(),
      axisY = new THREE.Vector3(0, 1, 0),
      euler = new THREE.Euler();
    const keys = new Set<string>();
    const injected: THREE.Group[] = [];
    const reset = () => {
      state = initialState(terrain);
      previous = state;
      acc = 0;
      trailLength = 0;
      trailGeo.setDrawRange(0, 0);
      cameraReady = false;
      heading = state.heading;
      terrain.rocks = structuredClone(props.terrain.rocks);
      injected.forEach((o) => {
        obstacles.remove(o);
        disposeObject(o);
      });
      injected.length = 0;
    };
    const down = (e: KeyboardEvent) => {
      if (
        !live.current.manual ||
        (e.target instanceof HTMLElement &&
          /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))
      )
        return;
      const key = e.key.toLowerCase();
      if (
        [
          "w",
          "s",
          "a",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
        ].includes(key)
      ) {
        e.preventDefault();
        keys.add(key);
      }
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase()),
      blur = () => keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const resize = new ResizeObserver(() => {
      const r = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, r.width), Math.max(1, r.height));
      camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    const render = (now: number) => {
      const p = live.current,
        elapsed = last ? Math.min(0.08, (now - last) / 1000) : 0;
      last = now;
      if (p.program !== policyProgram) {
        policy = compile(p.program);
        policyProgram = p.program;
      }
      if (p.reset !== lastReset) {
        lastReset = p.reset;
        reset();
      }
      if (p.obstacle !== lastObstacle) {
        lastObstacle = p.obstacle;
        const r = {
          x: state.x + Math.sin(state.heading) * 14,
          z: state.z + Math.cos(state.heading) * 14,
          radius: 1.4,
          height: 2,
        };
        terrain.rocks.push(r);
        const mesh = rockMesh(r, terrain, 0);
        obstacles.add(mesh);
        injected.push(mesh);
      }
      if (p.playing && state.status === "driving") {
        acc += elapsed * p.speed;
        while (acc >= DT) {
          previous = state;
          const scans = observe(state, terrain);
          const c = p.manual
            ? {
                steering:
                  (Number(keys.has("d") || keys.has("arrowright")) -
                    Number(keys.has("a") || keys.has("arrowleft"))) *
                  0.8,
                acceleration:
                  Number(keys.has("w") || keys.has("arrowup")) -
                  Number(keys.has("s") || keys.has("arrowdown")),
              }
            : policy(scans);
          state = step(state, c, terrain);
          state.scans = scans;
          acc -= DT;
          if (trailLength < 1000) {
            trailPoints.set([state.x, state.y + 0.1, state.z], trailLength * 3);
            trailLength++;
            trailGeo.setDrawRange(0, trailLength);
            trailGeo.attributes.position.needsUpdate = true;
          }
          if (state.status !== "driving") break;
        }
      } else if (p.playing && state.status !== "driving")
        acc = Math.min(DT, acc + elapsed * p.speed);
      const t = Math.min(1, acc / DT),
        x = previous.x + (state.x - previous.x) * t,
        z = previous.z + (state.z - previous.z) * t,
        y = previous.y + (state.y - previous.y) * t,
        h = wrap(previous.heading + wrap(state.heading - previous.heading) * t),
        pitch = previous.pitch + (state.pitch - previous.pitch) * t,
        roll = previous.roll + (state.roll - previous.roll) * t;
      car.position.set(x, y + 0.03, z);
      yaw.setFromAxisAngle(axisY, h);
      tilt.setFromEuler(euler.set(-pitch, 0, roll, "XYZ"));
      orientation.copy(yaw).multiply(tilt);
      car.quaternion.copy(orientation);
      wheels[0].rotation.y = wheels[1].rotation.y =
        previous.steer + (state.steer - previous.steer) * t;
      scanLines.visible = p.sensors;
      trail.visible = p.sensors;
      if (p.sensors) {
        const ranges = state.scans?.vectors[1];
        ANGLES.forEach((a, i) => {
          const distance = (ranges?.[i] ?? 1) * SCAN_RANGE,
            ex = x + Math.sin(h + a) * distance,
            ez = z + Math.cos(h + a) * distance;
          linePositions.set(
            [x, y + 1.8, z, ex, heightAt(terrain, ex, ez) + 0.3, ez],
            i * 6,
          );
        });
        lineGeo.attributes.position.needsUpdate = true;
      }
      const smooth = 1 - Math.exp(-5 * elapsed);
      heading = wrap(heading + wrap(h - heading) * smooth);
      if (mode !== p.camera) {
        cameraReady = false;
        mode = p.camera;
      }
      if (p.camera === "overhead") {
        desiredPosition.set(54, 102, -67);
        desiredTarget.set(0, 1, 0);
      } else if (p.camera === "onboard") {
        desiredPosition.set(
          x + Math.sin(h) * 0.7,
          y + 2.3,
          z + Math.cos(h) * 0.7,
        );
        desiredTarget.set(
          x + Math.sin(h) * 28,
          y + 1.5 + Math.sin(pitch) * 12,
          z + Math.cos(h) * 28,
        );
      } else {
        desiredPosition.set(
          x - Math.sin(heading) * 17 + Math.cos(heading) * 7,
          y + 10,
          z - Math.cos(heading) * 17 - Math.sin(heading) * 7,
        );
        desiredPosition.y = Math.max(
          desiredPosition.y,
          heightAt(terrain, desiredPosition.x, desiredPosition.z) + 3,
        );
        desiredTarget.set(
          x + Math.sin(heading) * 9,
          y + 1,
          z + Math.cos(heading) * 9,
        );
      }
      if (!cameraReady || p.camera === "onboard") {
        camera.position.copy(desiredPosition);
        cameraTarget.copy(desiredTarget);
      } else {
        camera.position.lerp(desiredPosition, smooth);
        cameraTarget.lerp(desiredTarget, smooth);
      }
      if (p.camera === "chase")
        camera.position.y = Math.max(
          camera.position.y,
          heightAt(terrain, camera.position.x, camera.position.z) + 2,
        );
      camera.lookAt(cameraTarget);
      cameraReady = true;
      renderer.render(scene, camera);
      if (now - lastPublish > 110) {
        p.onFrame({ ...state });
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
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [props.terrain]);
  return (
    <div className="off-webgl" ref={host}>
      {error && <div className="webgl-error">{error}</div>}
    </div>
  );
}
