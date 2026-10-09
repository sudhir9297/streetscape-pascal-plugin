/** Let busy feedback paint without relying on frames from a visible tab. */
export function waitForImportFeedbackFrame(): Promise<void> {
	return new Promise((resolve) => {
		let frame: number | undefined;
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			if (frame !== undefined) cancelAnimationFrame(frame);
			resolve();
		};
		const canPaint = typeof requestAnimationFrame === "function" &&
			(typeof document === "undefined" || document.visibilityState === "visible");
		const deadline = setTimeout(finish, canPaint ? 50 : 0);
		if (canPaint) frame = requestAnimationFrame(() => setTimeout(finish, 0));
	});
}
