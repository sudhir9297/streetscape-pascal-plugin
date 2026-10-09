import { useScene } from "@pascal-app/core";

/** Observe host persistence during a viewing gesture, including intermediate writes later reverted. */
export function beginStreetViewMutationCheck() {
	const snapshot = () =>
		JSON.stringify({
			nodes: useScene.getState().nodes,
			roots: useScene.getState().rootNodeIds,
		});
	const baseline = snapshot();
	let previous = baseline;
	const changes: Array<{
		nodes: Array<{ id: string; fields: string[] }>;
		roots: boolean;
		stack: string | undefined;
	}> = [];
	const unsubscribe = useScene.subscribe(() => {
		const next = snapshot();
		if (next !== previous) {
			const before = JSON.parse(previous),
				after = JSON.parse(next);
			const nodes = [
				...new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)]),
			].flatMap((id) => {
				const a = before.nodes[id],
					b = after.nodes[id];
				if (JSON.stringify(a) === JSON.stringify(b)) return [];
				return [
					{
						id,
						fields:
							a && b
								? [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
										(key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]),
									)
								: ["node-existence"],
					},
				];
			});
			changes.push({
				nodes,
				roots: JSON.stringify(before.roots) !== JSON.stringify(after.roots),
				stack: new Error().stack,
			});
		}
		previous = next;
	});
	let finished = false;
	return {
		finish() {
			if (!finished) {
				unsubscribe();
				finished = true;
			}
			return {
				unchanged: snapshot() === baseline && changes.length === 0,
				persistentWrites: changes.length,
				changes,
			};
		},
		assertUnchanged() {
			const result = this.finish();
			if (!result.unchanged)
				throw new Error(
					`Viewing changed persistent scene data (${result.persistentWrites} writes)`,
				);
			return result;
		},
	};
}
