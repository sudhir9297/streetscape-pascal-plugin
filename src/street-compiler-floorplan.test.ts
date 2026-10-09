import { expect, test } from "bun:test";
import { runStep28FloorplanChecks } from "./street-compiler-floorplan-fixture";
test("compiled floorplan preserves footprints, holes, crossings and editing targets", () => {
	const result = runStep28FloorplanChecks();
	expect(result.error).toBeUndefined();
	expect(result.ok).toBe(true);
	expect(result.checks).toHaveLength(8);
});
