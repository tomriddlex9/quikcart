"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CubeAnimation, CubeCell, CubeDim, CubeMeasure } from "@/lib/layer-cube-types";

// A minimal, dependency-light three.js bar-cube: no @react-three/fiber, just
// a scene/camera/renderer managed imperatively (same pattern as
// components/floor-shader.tsx) so this stays consistent with the rest of the
// console. Always imported with `next/dynamic(..., { ssr: false })` — WebGL
// has no server-side implementation.

const ACCENT = 0xc6f53a; // matches the console's lime accent, no purple
const AMBER = 0xd6a34a;
const GRID_COLOR = 0x2a2f26;

export interface DataCubeSceneProps {
  cells: CubeCell[];
  dimensions: CubeDim[];
  measures: CubeMeasure[];
  heightMeasure: string;
  colorMeasure: string;
  animation: CubeAnimation | null;
  onCellHover?: (cell: CubeCell | null) => void;
  onCellClick?: (cell: CubeCell) => void;
}

function colorForRatio(ratio: number): THREE.Color {
  // 0 -> lime accent, 1 -> amber/red — a small heatmap, no purple hues.
  const clamped = Math.min(1, Math.max(0, ratio));
  const low = new THREE.Color(ACCENT);
  const high = new THREE.Color(0xe0523a);
  return low.clone().lerp(high, clamped);
}

export default function DataCubeScene({
  cells,
  dimensions,
  measures,
  heightMeasure,
  colorMeasure,
  animation,
  onCellHover,
  onCellClick,
}: DataCubeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    raycaster: THREE.Raycaster;
    bars: Map<string, THREE.Mesh>;
    cellsById: Map<string, CubeCell>;
    animEndAt: number;
    animIds: Set<string>;
    frame: number;
  } | null>(null);

  const primaryDim = dimensions[0]?.name;
  const secondaryDim = dimensions[1]?.name;
  const rowMembers = useMemo(
    () => (primaryDim ? Array.from(new Set(cells.map((c) => c.coords[primaryDim]))) : []),
    [cells, primaryDim],
  );
  const colMembers = useMemo(
    () => (secondaryDim ? Array.from(new Set(cells.map((c) => c.coords[secondaryDim]))) : ["_"]),
    [cells, secondaryDim],
  );

  const maxValue = useMemo(
    () => Math.max(1, ...cells.map((c) => c.values[heightMeasure] ?? 0)),
    [cells, heightMeasure],
  );
  const colorRange = useMemo(() => {
    const values = cells.map((c) => c.values[colorMeasure] ?? 0);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    return { min, max: max > min ? max : min + 1 };
  }, [cells, colorMeasure]);

  // ---- one-time scene setup -------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(9, 8, 11);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 30;
    controls.maxPolarAngle = Math.PI / 2.05;

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(6, 10, 4);
    const rim = new THREE.DirectionalLight(ACCENT, 0.25);
    rim.position.set(-6, 4, -6);
    scene.add(ambient, key, rim);

    const grid = new THREE.GridHelper(14, 14, GRID_COLOR, GRID_COLOR);
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const raycaster = new THREE.Raycaster();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const pointer = new THREE.Vector2();
    const handlePointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const state = stateRef.current;
      if (!state) return;
      state.raycaster.setFromCamera(pointer, camera);
      const meshes = Array.from(state.bars.values());
      const hits = state.raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        const cellId = hits[0].object.userData.cellId as string;
        onCellHover?.(state.cellsById.get(cellId) ?? null);
        container.style.cursor = "pointer";
      } else {
        onCellHover?.(null);
        container.style.cursor = "default";
      }
    };
    const handleClick = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const state = stateRef.current;
      if (!state) return;
      state.raycaster.setFromCamera(pointer, camera);
      const meshes = Array.from(state.bars.values());
      const hits = state.raycaster.intersectObjects(meshes, false);
      if (hits.length > 0) {
        const cellId = hits[0].object.userData.cellId as string;
        const cell = state.cellsById.get(cellId);
        if (cell) onCellClick?.(cell);
      }
    };
    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerdown", handleClick);

    stateRef.current = {
      renderer,
      scene,
      camera,
      controls,
      raycaster,
      bars: new Map(),
      cellsById: new Map(),
      animEndAt: 0,
      animIds: new Set(),
      frame: 0,
    };

    let raf = 0;
    const tick = () => {
      const state = stateRef.current;
      if (state) {
        state.controls.update();
        state.frame += 1;
        if (state.animIds.size > 0 && performance.now() < state.animEndAt) {
          const pulse = 1 + Math.sin(state.frame * 0.35) * 0.08;
          for (const id of state.animIds) {
            const mesh = state.bars.get(id);
            if (mesh) mesh.scale.set(pulse, mesh.userData.baseScaleY as number, pulse);
          }
        } else if (state.animIds.size > 0) {
          for (const id of state.animIds) {
            const mesh = state.bars.get(id);
            if (mesh) mesh.scale.set(1, mesh.userData.baseScaleY as number, 1);
          }
          state.animIds.clear();
        }
        state.renderer.render(state.scene, state.camera);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerdown", handleClick);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      stateRef.current = null;
    };
    // Scene is built once; cell/measure updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- rebuild bars whenever cells/measures/layout change ------------------
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const { scene, bars } = state;

    for (const mesh of bars.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    bars.clear();
    state.cellsById.clear();

    const spacing = 1.15;
    const cellSize = 0.82;
    const rows = rowMembers.length || 1;
    const cols = colMembers.length || 1;
    const offsetX = ((rows - 1) * spacing) / 2;
    const offsetZ = ((cols - 1) * spacing) / 2;
    const geometry = new THREE.BoxGeometry(cellSize, 1, cellSize);

    for (const cell of cells) {
      state.cellsById.set(cell.id, cell);
      const rowIdx = primaryDim ? rowMembers.indexOf(cell.coords[primaryDim]) : 0;
      const colIdx = secondaryDim ? colMembers.indexOf(cell.coords[secondaryDim]) : 0;
      if (rowIdx < 0) continue;

      const rawHeight = cell.values[heightMeasure] ?? 0;
      const height = Math.max(0.05, (rawHeight / maxValue) * 5.5);
      const rawColor = cell.values[colorMeasure] ?? 0;
      const ratio = (rawColor - colorRange.min) / (colorRange.max - colorRange.min);
      const color = cell.highlight ? new THREE.Color(0xffffff) : colorForRatio(ratio);

      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness: 0.08,
        emissive: cell.highlight ? new THREE.Color(ACCENT) : new THREE.Color(0x000000),
        emissiveIntensity: cell.highlight ? 0.4 : 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(rowIdx * spacing - offsetX, height / 2, colIdx * spacing - offsetZ);
      mesh.scale.set(1, height, 1);
      mesh.userData.cellId = cell.id;
      mesh.userData.baseScaleY = height;
      scene.add(mesh);
      bars.set(cell.id, mesh);
    }
  }, [cells, rowMembers, colMembers, primaryDim, secondaryDim, heightMeasure, colorMeasure, maxValue, colorRange]);

  // ---- trigger a transient pulse animation on the animated cells -----------
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !animation) return;
    state.animIds = new Set(animation.cell_ids);
    state.animEndAt = performance.now() + animation.duration_ms;
  }, [animation]);

  const legend = colorMeasure === heightMeasure ? undefined : colorMeasure;
  const measureLabel = measures.find((m) => m.name === heightMeasure)?.label ?? heightMeasure;
  const legendLabel = measures.find((m) => m.name === legend)?.label;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
        height = {measureLabel}
        {legendLabel ? ` · color = ${legendLabel}` : ""}
      </div>
    </div>
  );
}
