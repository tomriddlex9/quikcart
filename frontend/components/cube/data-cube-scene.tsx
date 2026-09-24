"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CubeCell, CubeState } from "@/lib/layer-cube-types";

const SPACING = 1.5;
const CLUSTER_GAP = 2.4;
const MAX_HEIGHT = 3.2;
const MIN_HEIGHT = 0.15;
const COLD_COLOR = new THREE.Color("#2dd4bf");
const HOT_COLOR = new THREE.Color("#f59e0b");
const HOVER_COLOR = new THREE.Color("#e5e7eb");

interface CellLayout {
  cell: CubeCell;
  x: number;
  z: number;
}

type AnimationKind = NonNullable<CubeState["animation"]>["kind"];

interface CellMeshEntry {
  mesh: THREE.Mesh;
  cell: CubeCell;
  targetHeight: number;
  targetColor: THREE.Color;
  animStart: number;
  animDuration: number;
  animKind: AnimationKind;
}

function layoutCells(state: CubeState): CellLayout[] {
  const dims = state.dimensions;
  const d0 = dims[0];
  const d1 = dims[1];
  const d2 = dims[2];
  const clusterWidth = (d0?.members.length ?? 1) * SPACING;

  return state.cells.map((cell) => {
    const i0 = d0 ? Math.max(0, d0.members.indexOf(cell.coords[d0.name])) : 0;
    const i1 = d1 ? Math.max(0, d1.members.indexOf(cell.coords[d1.name])) : 0;
    const i2 = d2 ? Math.max(0, d2.members.indexOf(cell.coords[d2.name])) : 0;
    const clusterOffsetX = d2 ? i2 * (clusterWidth + CLUSTER_GAP) : 0;
    return {
      cell,
      x: clusterOffsetX + i0 * SPACING,
      z: i1 * SPACING,
    };
  });
}

function normalizedValue(cells: CubeCell[], measure: string): (cell: CubeCell) => number {
  const values = cells.map((cell) => cell.values[measure] ?? 0);
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 0.0001);
  return (cell: CubeCell) => ((cell.values[measure] ?? 0) - min) / range;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function DataCubeScene({ state, measure }: { state: CubeState; measure: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<CellMeshEntry[]>([]);
  const stateRef = useRef(state);
  const measureRef = useRef(measure);
  const lastAnimationRef = useRef<CubeState["animation"]>(null);
  const rebuildRef = useRef<(() => void) | null>(null);

  stateRef.current = state;
  measureRef.current = measure;

  useEffect(() => {
    const containerEl = containerRef.current;
    const tooltipEl = tooltipRef.current;
    if (!containerEl || !tooltipEl) return;
    const container: HTMLDivElement = containerEl;
    const tooltip: HTMLDivElement = tooltipEl;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#050708");
    scene.fog = new THREE.Fog(0x050708, 14, 34);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(9, 8, 11);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.6;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 4;
    controls.maxDistance = 30;

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(8, 12, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x5eead4, 0.35);
    rim.position.set(-6, 4, -8);
    scene.add(rim);

    const floorGeometry = new THREE.PlaneGeometry(60, 60);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 1 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    scene.add(floor);

    const grid = new THREE.GridHelper(60, 40, 0x1b2530, 0x121821);
    scene.add(grid);

    const cellGroup = new THREE.Group();
    scene.add(cellGroup);

    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    boxGeometry.translate(0, 0.5, 0);

    function rebuildCells() {
      for (const entry of entriesRef.current) {
        cellGroup.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        (entry.mesh.material as THREE.Material).dispose();
      }
      entriesRef.current = [];

      const current = stateRef.current;
      const layout = layoutCells(current);
      const toNormalized = normalizedValue(current.cells, measureRef.current);

      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const item of layout) {
        minX = Math.min(minX, item.x);
        maxX = Math.max(maxX, item.x);
        minZ = Math.min(minZ, item.z);
        maxZ = Math.max(maxZ, item.z);
      }
      const centerX = layout.length > 0 ? (minX + maxX) / 2 : 0;
      const centerZ = layout.length > 0 ? (minZ + maxZ) / 2 : 0;

      for (const item of layout) {
        const norm = toNormalized(item.cell);
        const height = MIN_HEIGHT + norm * MAX_HEIGHT;
        const color = COLD_COLOR.clone().lerp(HOT_COLOR, norm);
        const material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.45,
          metalness: 0.08,
          emissive: color.clone().multiplyScalar(0.12),
        });
        const mesh = new THREE.Mesh(boxGeometry, material);
        mesh.position.set(item.x - centerX, 0, item.z - centerZ);
        mesh.scale.set(0.82, height, 0.82);
        mesh.userData.cellId = item.cell.id;
        cellGroup.add(mesh);
        entriesRef.current.push({
          mesh,
          cell: item.cell,
          targetHeight: height,
          targetColor: color,
          animStart: -1,
          animDuration: 0,
          animKind: "pulse",
        });
      }
    }

    rebuildCells();
    rebuildRef.current = rebuildCells;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered: CellMeshEntry | null = null;

    function onPointerMove(event: PointerEvent) {
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(cellGroup.children, false);
      if (hits.length > 0) {
        const mesh = hits[0].object as THREE.Mesh;
        const entry = entriesRef.current.find((e) => e.mesh === mesh) ?? null;
        hovered = entry;
        if (entry) {
          const measureLabel = measureRef.current;
          const value = entry.cell.values[measureLabel];
          const coordText = Object.entries(entry.cell.coords)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ");
          tooltip.textContent = `${coordText} — ${measureLabel}: ${value}`;
          tooltip.style.left = `${event.clientX - rect.left + 12}px`;
          tooltip.style.top = `${event.clientY - rect.top + 12}px`;
          tooltip.style.opacity = "1";
        }
      } else {
        hovered = null;
        tooltip.style.opacity = "0";
      }
    }
    function onPointerLeave() {
      hovered = null;
      tooltip.style.opacity = "0";
    }

    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);

    function resize() {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();

      for (const entry of entriesRef.current) {
        let scaleY = entry.targetHeight;
        let colorTarget = entry.targetColor;
        if (entry.animStart >= 0) {
          const t = Math.min(1, (now - entry.animStart) / entry.animDuration);
          if (entry.animKind === "pulse") {
            const bump = Math.sin(t * Math.PI) * 0.3;
            scaleY = entry.targetHeight * (1 + bump);
          } else if (entry.animKind === "expand") {
            scaleY = entry.targetHeight * easeOutCubic(t);
          } else if (entry.animKind === "merge") {
            scaleY = entry.targetHeight * easeOutBack(t);
          } else if (entry.animKind === "shrink") {
            const overshoot = 1 + (1 - easeOutCubic(t)) * 0.35;
            scaleY = entry.targetHeight * overshoot;
          } else if (entry.animKind === "recolor") {
            colorTarget = HOVER_COLOR.clone().lerp(entry.targetColor, easeOutCubic(t));
          } else {
            scaleY = entry.targetHeight;
          }
          if (t >= 1) entry.animStart = -1;
        }
        entry.mesh.scale.y = Math.max(0.02, scaleY);
        const material = entry.mesh.material as THREE.MeshStandardMaterial;
        const isHovered = hovered?.mesh === entry.mesh;
        material.color.copy(isHovered ? HOVER_COLOR : colorTarget);
        material.emissive.copy((isHovered ? HOVER_COLOR : colorTarget).clone().multiplyScalar(isHovered ? 0.25 : 0.12));
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      rebuildRef.current = null;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      controls.dispose();
      for (const entry of entriesRef.current) {
        entry.mesh.geometry.dispose();
        (entry.mesh.material as THREE.Material).dispose();
      }
      boxGeometry.dispose();
      floorGeometry.dispose();
      floorMaterial.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // Scene is constructed once; cell rebuilds and re-animation are driven by
    // the effects below via refs so we don't tear down the renderer per update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Rebuild the grid whenever the dataset shape (dims/cells) changes, and
    // (re)apply the requested animation to the affected cells.
    const animation = state.animation;
    const changed = animation !== lastAnimationRef.current;
    lastAnimationRef.current = animation;

    const currentIds = new Set(state.cells.map((c) => c.id));
    const existingIds = new Set(entriesRef.current.map((e) => e.cell.id));
    const sameShape =
      currentIds.size === existingIds.size && [...currentIds].every((id) => existingIds.has(id));

    if (!sameShape) {
      rebuildRef.current?.();
    }
    if (changed && animation) {
      const now = performance.now();
      for (const entry of entriesRef.current) {
        if (animation.cell_ids.includes(entry.cell.id)) {
          entry.animStart = now;
          entry.animDuration = animation.duration_ms;
          entry.animKind = animation.kind;
        }
      }
    }
  }, [state]);

  return (
    <div ref={containerRef} className="relative h-full w-full touch-none">
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-10 rounded-md bg-foreground px-2.5 py-1.5 text-[11px] text-background opacity-0 transition-opacity"
        style={{ left: 0, top: 0 }}
      />
    </div>
  );
}
