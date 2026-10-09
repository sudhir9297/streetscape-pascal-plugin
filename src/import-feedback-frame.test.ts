import { expect, test } from "bun:test";
import { waitForImportFeedbackFrame } from "./import-feedback-frame";

test("preparation progresses when a requested frame never arrives", async () => {
	const originalFrame = globalThis.requestAnimationFrame;
	const originalCancel = globalThis.cancelAnimationFrame;
	let cancelled: number | undefined;
	globalThis.requestAnimationFrame = () => 19;
	globalThis.cancelAnimationFrame = (id) => { cancelled = id; };
	try {
		await Promise.race([
			waitForImportFeedbackFrame(),
			new Promise((_, reject) => setTimeout(() => reject(Error("Import stalled")), 300)),
		]);
		expect(cancelled).toBe(19);
	} finally {
		globalThis.requestAnimationFrame = originalFrame;
		globalThis.cancelAnimationFrame = originalCancel;
	}
});
