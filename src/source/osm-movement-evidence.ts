import type {
	NormalizedOsmSource,
	NormalizedOsmFeature,
} from "./osm-normalization";

export type MovementDiagnostic = {
	featureId: string;
	code: string;
	message: string;
};
export type MovementConstraint = {
	featureId: string;
	kind: "no" | "only" | "connectivity";
	fromWayId: number;
	toWayId: number;
	viaNodeId: number;
	fromDirection: "forward" | "reverse";
	toDirection: "forward" | "reverse";
	lanes: Array<{ from: number; to: number; requiresLaneChange: boolean }>;
};
export type OsmMovementEvidence = {
	format: "osm-movement-evidence";
	schemaVersion: 1;
	mode: "motor_vehicle";
	constraints: MovementConstraint[];
	diagnostics: MovementDiagnostic[];
	roads: Array<{
		featureId: string;
		wayId: number;
		direction: string | null;
		access: Record<string, string>;
		turnLanes: Record<string, string[][]>;
	}>;
};
const tagsOf = (f: NormalizedOsmFeature) =>
	(f.raw.tags ?? {}) as Record<string, string>;

/** Source-based legal evidence only. Does not infer a lane graph or create host connections. */
export function resolveOsmMovementEvidence(
	source: NormalizedOsmSource,
	selectedWayIds?: ReadonlySet<number>,
	selectedViaNodeIds?: ReadonlySet<number>,
): OsmMovementEvidence {
	const report: OsmMovementEvidence = {
		format: "osm-movement-evidence",
		schemaVersion: 1,
		mode: "motor_vehicle",
		constraints: [],
		diagnostics: [],
		roads: [],
	};
	const warn = (f: NormalizedOsmFeature, code: string, message: string) =>
		report.diagnostics.push({ featureId: f.featureId, code, message });
	const ways = new Map(
		source.features
			.filter((f) => f.kind === "road" && f.disposition === "accepted")
			.map((f) => [f.id, f]),
	);
	for (const f of ways.values()) {
		const tags = tagsOf(f),
			access: Record<string, string> = {},
			turnLanes: Record<string, string[][]> = {};
		for (const [key, value] of Object.entries(tags)) {
			if (/^(access|vehicle|motor_vehicle|motorcar)(:.*)?$/.test(key)) {
				access[key] = value;
				if (
					key.includes("conditional") ||
					![
						"yes",
						"no",
						"private",
						"destination",
						"permissive",
						"designated",
					].includes(value)
				)
					warn(
						f,
						"unsupported-access",
						`${key}=${value} is retained for review; no unconditional permission is assumed.`,
					);
			}
			if (/^turn:lanes(?::(forward|backward|both_ways))?$/.test(key)) {
				const lanes = value.split("|").map((l) => l.split(";"));
				turnLanes[key] = lanes;
				if (
					lanes
						.flat()
						.some(
							(v) =>
								![
									"",
									"none",
									"left",
									"slight_left",
									"sharp_left",
									"through",
									"right",
									"slight_right",
									"sharp_right",
									"reverse",
									"merge_to_left",
									"merge_to_right",
								].includes(v),
						)
				)
					warn(
						f,
						"unsupported-turn-lanes",
						`${key} contains unsupported turn indications.`,
					);
				const count = f.road?.laneCounts[key.replace("turn:", "")];
				if (count != null && count !== lanes.length)
					warn(
						f,
						"lane-count-conflict",
						`${key} disagrees with the directional lane count.`,
					);
			}
			if (
				key.startsWith("oneway:") ||
				(key.startsWith("turn:") && key.includes("conditional"))
			)
				warn(
					f,
					"unsupported-directional-condition",
					`${key} is retained but is not enforced.`,
				);
		}
		report.roads.push({
			featureId: f.featureId,
			wayId: f.id,
			direction: f.road!.direction,
			access,
			turnLanes,
		});
	}
	const directionAt = (
		f: NormalizedOsmFeature,
		node: number,
		incoming: boolean,
	): "forward" | "reverse" | null => {
		if (f.geometry?.kind !== "way") return null;
		const points = f.geometry.points;
		// Interior/loop endpoints have multiple possible approaches and require lane-graph resolution.
		if (points.filter((p) => p.nodeId === node).length !== 1) return null;
		const direction =
			points.at(-1)!.nodeId === node
				? incoming
					? "forward"
					: "reverse"
				: points[0]!.nodeId === node
					? incoming
						? "reverse"
						: "forward"
					: null;
		return direction &&
			(f.road!.direction === "both" || f.road!.direction === direction)
			? direction
			: null;
	};
	for (const f of source.features) {
		const tags = tagsOf(f);
		if (
			f.sourceType !== "relation" ||
			!(tags.type === "connectivity" || tags.type?.startsWith("restriction"))
		)
			continue;
		const members = f.geometry?.kind === "relation" ? f.geometry.members : [];
		const from = members.filter((m) => m.role === "from" && m.type === "way"),
			to = members.filter((m) => m.role === "to" && m.type === "way"),
			via = members.filter((m) => m.role === "via");
		if (
			(tags.type !== "restriction" && tags.type !== "connectivity") ||
			Object.keys(tags).some(
				(k) =>
					k.includes("conditional") ||
					k.startsWith("restriction:") ||
					["day_on", "day_off", "hour_on", "hour_off"].includes(k) ||
					k.startsWith("if:"),
			) ||
			tags.except !== undefined
		) {
			warn(
				f,
				"unsupported-restriction-scope",
				"Conditional, mode-specific or excepted relation retained; not enforced.",
			);
			continue;
		}
		if (via.some((m) => m.type === "way")) {
			warn(
				f,
				"unsupported-via-way",
				"Ordered via-way members retained in normalized source; path restrictions are not enforced.",
			);
			continue;
		}
		if (
			f.disposition !== "accepted" ||
			from.length !== 1 ||
			to.length !== 1 ||
			via.length !== 1 ||
			via[0]!.type !== "node" ||
			members.length !== 3
		) {
			warn(
				f,
				"unsupported-relation-members",
				"Expected one from way, one via node and one to way.",
			);
			continue;
		}
		const a = ways.get(from[0]!.ref),
			b = ways.get(to[0]!.ref),
			node = via[0]!.ref;
		if (!a || !b) {
			warn(
				f,
				"missing-member-topology",
				"Supporting road topology is unavailable.",
			);
			continue;
		}
		const ad = directionAt(a, node, true),
			bd = directionAt(b, node, false);
		if (!ad || !bd) {
			warn(
				f,
				"invalid-relation-direction",
				"Relation does not identify a unique legal directed endpoint approach.",
			);
			continue;
		}
		const ap =
			a.geometry?.kind === "way"
				? a.geometry.points.find((p) => p.nodeId === node)
				: null;
		const bp =
			b.geometry?.kind === "way"
				? b.geometry.points.find((p) => p.nodeId === node)
				: null;
		if (!ap || !bp || ap.lat !== bp.lat || ap.lon !== bp.lon) {
			warn(
				f,
				"conflicting-via-coordinates",
				"Shared via identity has inconsistent source coordinates; no constraint is projected.",
			);
			continue;
		}
		if (
			a.road!.layer !== b.road!.layer ||
			a.road!.bridge !== b.road!.bridge ||
			a.road!.tunnel !== b.road!.tunnel
		) {
			warn(
				f,
				"incompatible-structure",
				"Relation approaches have incompatible structure evidence.",
			);
			continue;
		}
		if (
			selectedWayIds &&
			(!selectedWayIds.has(a.id) ||
				!selectedWayIds.has(b.id) ||
				(selectedViaNodeIds !== undefined && !selectedViaNodeIds.has(node)))
		) {
			warn(
				f,
				"outside-selected-scope",
				"Relation retained as context; both approaches and the via junction must be selected before projection.",
			);
			continue;
		}
		let kind: MovementConstraint["kind"];
		const lanes: MovementConstraint["lanes"] = [];
		if (tags.type === "restriction") {
			if (
				![
					"no_left_turn",
					"no_right_turn",
					"no_straight_on",
					"no_u_turn",
					"only_left_turn",
					"only_right_turn",
					"only_straight_on",
					"only_u_turn",
				].includes(tags.restriction ?? "")
			) {
				warn(
					f,
					"unsupported-restriction-value",
					"Restriction value is not supported.",
				);
				continue;
			}
			kind = tags.restriction!.startsWith("only_") ? "only" : "no";
		} else {
			kind = "connectivity";
			let valid = true;
			const seen = new Set<number>();
			for (const entry of (tags.connectivity ?? "").split("|")) {
				const match = entry.match(
					/^([1-9]\d*):([1-9]\d*|\([1-9]\d*\))(,([1-9]\d*|\([1-9]\d*\)))*$/,
				);
				if (!match) {
					valid = false;
					break;
				}
				const fromLane = Number(match[1]);
				if (seen.has(fromLane)) {
					valid = false;
					break;
				}
				seen.add(fromLane);
				for (const target of entry.split(":")[1]!.split(","))
					lanes.push({
						from: fromLane,
						to: Number(target.replace(/[()]/g, "")),
						requiresLaneChange: target.startsWith("("),
					});
			}
			const count = (w: NormalizedOsmFeature, d: string) =>
				w.road!.laneCounts[
					d === "forward" ? "lanes:forward" : "lanes:backward"
				] ?? (w.road!.direction !== "both" ? w.road!.laneCounts.lanes : null);
			const ac = count(a, ad),
				bc = count(b, bd);
			if (
				!valid ||
				lanes.some(
					(l) => (ac != null && l.from > ac) || (bc != null && l.to > bc),
				)
			) {
				warn(
					f,
					"malformed-connectivity",
					"Lane mapping is malformed, duplicated, unsupported or exceeds known directional lane counts.",
				);
				continue;
			}
		}
		report.constraints.push({
			featureId: f.featureId,
			kind,
			fromWayId: a.id,
			toWayId: b.id,
			viaNodeId: node,
			fromDirection: ad,
			toDirection: bd,
			lanes,
		});
	}
	return report;
}

/** Legal filter for a directed source movement; uncertainty stays visible in diagnostics. */
export function isSupportedOsmMovementAllowed(
	report: OsmMovementEvidence,
	movement: Omit<MovementConstraint, "featureId" | "kind" | "lanes">,
): boolean {
	for (const [wayId, direction] of [
		[movement.fromWayId, movement.fromDirection],
		[movement.toWayId, movement.toDirection],
	] as const) {
		const road = report.roads.find((r) => r.wayId === wayId);
		if (
			!road ||
			road.direction === null ||
			(road.direction !== "both" && road.direction !== direction)
		)
			return false;
		const access = road.access;
		const value =
			access[`motorcar:${direction === "reverse" ? "backward" : "forward"}`] ??
			access.motorcar ??
			access[
				`motor_vehicle:${direction === "reverse" ? "backward" : "forward"}`
			] ??
			access.motor_vehicle ??
			access[`vehicle:${direction === "reverse" ? "backward" : "forward"}`] ??
			access.vehicle ??
			access[`access:${direction === "reverse" ? "backward" : "forward"}`] ??
			access.access;
		if (value === "no" || value === "private") return false;
	}
	return !report.constraints.some(
		(c) =>
			c.kind !== "connectivity" &&
			c.fromWayId === movement.fromWayId &&
			c.fromDirection === movement.fromDirection &&
			c.viaNodeId === movement.viaNodeId &&
			(c.kind === "no"
				? c.toWayId === movement.toWayId &&
					c.toDirection === movement.toDirection
				: c.toWayId !== movement.toWayId ||
					c.toDirection !== movement.toDirection),
	);
}
