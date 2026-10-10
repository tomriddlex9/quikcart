import { describe, expect, it } from "vitest";
import { buildTreeParticles } from "@/components/marketing/hud/particle-tree";

describe("buildTreeParticles", () => {
  it("builds a dense point cloud in unit space", () => {
    const particles = buildTreeParticles(800);
    expect(particles.length).toBeGreaterThanOrEqual(800);
    for (const p of particles.slice(0, 40)) {
      expect(p.x).toBeGreaterThanOrEqual(-0.05);
      expect(p.x).toBeLessThanOrEqual(1.05);
      expect(p.y).toBeGreaterThanOrEqual(-0.05);
      expect(p.y).toBeLessThanOrEqual(1.1);
    }
  });
});
