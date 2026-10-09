import {
	captureGeneratedItemAcceptance,
	generatedSourceDuplicateCandidates,
} from "../generated-item-acceptance";
import {
	GeneratedItemHistory,
	type GeneratedItemAcceptance,
} from "../domain/generated-item-history";
import { readCurrentRoad } from "../street-project-compatibility";
import {
	parseStreetProject,
	type StreetProject,
	type StreetBaselineRevision,
} from "../domain/street-project";
import { canonicalSourceJson } from "./osm-source-snapshot";
import { verifyStreetProjectSnapshots } from "./osm-snapshot-project";
import { generateStreetSourceRefreshDiff } from "./street-source-refresh";
import { hasStreetPropertyPath } from "../domain/street-evidence";
import { streetInventoryItemId } from "../domain/street-scenario";

export type StreetMergeChoice =
	| "keep-current"
	| "use-incoming"
	| "keep-distinct"
	| `link-existing~${string}`
	| `suppress-source~${string}`;
export type StreetMergeConflict = {
	id: string;
	path: string[];
	reason: string;
	current: unknown;
	incoming: unknown;
	choices: StreetMergeChoice[];
};
export type StreetSourceMergeReview = {
	format: "street-source-merge-review";
	currentIdentity: string;
	originalIdentity: string;
	incomingIdentity: string;
	original: StreetProject;
	incoming: StreetProject;
	current: StreetProject;
	sourceReferenceId: string;
};
const same = (a: unknown, b: unknown) =>
	canonicalSourceJson(a ?? null) === canonicalSourceJson(b ?? null);
const object = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);
/** Capture all three inputs. No writes or acquisition; source resolutions must retain verified snapshots. */
export async function prepareStreetSourceMerge(
	currentInput: StreetProject,
	originalInput: StreetProject,
	incomingInput: StreetProject,
	sourceReferenceId: string,
): Promise<StreetSourceMergeReview> {
	const current = parseStreetProject(currentInput),
		original = (await verifyStreetProjectSnapshots(originalInput)).project,
		incoming = (await verifyStreetProjectSnapshots(incomingInput)).project;
	const ref = current.sourceReferences[sourceReferenceId];
	if (
		!ref ||
		!current.baselineRevisions[
			current.activeBaselineRevisionId
		]!.sourceReferenceIds.includes(sourceReferenceId)
	)
		throw Error("Select an accepted source");
	if (
		incoming.baselineRevisions[incoming.activeBaselineRevisionId]!.diagnostics
			?.status === "blocked"
	)
		throw Error("Incoming resolution has blocking diagnostics");
	const source = (p: StreetProject) =>
		p.baselineRevisions[p.activeBaselineRevisionId]!.sourceReferenceIds.map(
			(id) => p.sourceReferences[id]!,
		).filter(
			(s) =>
				s.snapshot.status === "embedded" &&
				s.snapshot.format === "osm-source-snapshot-v1",
		);
	if (!source(original).some((s) => same(s.snapshot, ref.snapshot)))
		throw Error(
			"Original resolution must contain the retained source snapshot",
		);
	if (source(incoming).length !== 1)
		throw Error("Incoming resolution must contain exactly one OSM snapshot");
	const frame = (p: StreetProject) =>
		p.siteFrameId === null ? null : p.siteFrames[p.siteFrameId];
	if (
		!same(frame(current), frame(original)) ||
		!same(frame(current), frame(incoming))
	)
		throw Error("Merge resolutions must use the accepted coordinate frame");
	if (
		Object.values(
			original.baselineRevisions[original.activeBaselineRevisionId]!
				.propertyEvidence ?? {},
		).some((p) => p.accepted.kind === "correction")
	)
		throw Error("Original source resolution must precede accepted corrections");
	return {
		format: "street-source-merge-review",
		currentIdentity: canonicalSourceJson(current),
		originalIdentity: canonicalSourceJson(original),
		incomingIdentity: canonicalSourceJson(incoming),
		current,
		original,
		incoming,
		sourceReferenceId,
	};
}
/** Recompute from immutable inputs for every choice. Unresolved conflicts never produce an acceptable document. */
export async function resolveStreetSourceMerge(
	review: StreetSourceMergeReview,
	choices: Record<string, StreetMergeChoice> = {},
	acceptedAt = new Date().toISOString(),
) {
	const current = parseStreetProject(review.current),
		original = parseStreetProject(review.original),
		incoming = parseStreetProject(review.incoming);
	if (
		review.currentIdentity !== canonicalSourceJson(current) ||
		review.originalIdentity !== canonicalSourceJson(original) ||
		review.incomingIdentity !== canonicalSourceJson(incoming)
	)
		throw Error("Merge review was altered");
	const old = original.baselineRevisions[original.activeBaselineRevisionId]!,
		now = structuredClone(
			current.baselineRevisions[current.activeBaselineRevisionId]!,
		),
		fresh = incoming.baselineRevisions[incoming.activeBaselineRevisionId]!;
	const source = fresh.sourceReferenceIds
		.map((id) => incoming.sourceReferences[id]!)
		.find(
			(s) =>
				s.snapshot.status === "embedded" &&
				s.snapshot.format === "osm-source-snapshot-v1",
		)!;
	if (source.snapshot.status !== "embedded")
		throw Error("Missing incoming snapshot");
	const { diff } = await generateStreetSourceRefreshDiff(
		current,
		now.id,
		review.sourceReferenceId,
		source.snapshot.data,
	);
	const acceptedNodes = Object.fromEntries(
		Object.values(now.features)
			.filter((f) => typeof f.data.id === "string")
			.map((f) => [String(f.data.id), f.data]),
	);
	for (const road of Object.values(now.roads)) {
		const network = readCurrentRoad(road),
			acceptance = captureGeneratedItemAcceptance(
				network,
				structuredClone(network),
				acceptedNodes,
				acceptedNodes,
				now.acceptedAt,
			);
		if (road.representation === "resolved-street-v1") {
			const compatibility = road.data.compatibility as {
				node: Record<string, any>;
			};
			compatibility.node.generatedItemHistory = JSON.parse(
				JSON.stringify(acceptance.network.generatedItemHistory),
			);
		} else
			road.data.generatedItemHistory = JSON.parse(
				JSON.stringify(acceptance.network.generatedItemHistory),
			);
		road.data.attachments = JSON.parse(
			JSON.stringify(acceptance.network.attachments),
		);
		for (const op of acceptance.updates) {
			const feature = Object.values(now.features).find(
				(f) => f.data.id === op.id,
			);
			if (feature)
				feature.data.metadata = JSON.parse(JSON.stringify(op.metadata));
		}
	}
	const histories = (road: any): Record<string, GeneratedItemAcceptance> =>
		GeneratedItemHistory.parse(
			road?.representation === "resolved-street-v1"
				? (road.data.compatibility?.node?.generatedItemHistory ?? {})
				: (road?.data.generatedItemHistory ?? {}),
		);
	const putHistory = (
		road: any,
		history: Record<string, GeneratedItemAcceptance>,
	) => {
		if (road.representation === "resolved-street-v1")
			road.data.compatibility.node.generatedItemHistory = JSON.parse(
				JSON.stringify(history),
			);
		else road.data.generatedItemHistory = JSON.parse(JSON.stringify(history));
	};
	const conflicts: StreetMergeConflict[] = [];
	const conflict = (
		path: string[],
		reason: string,
		a: unknown,
		b: unknown,
		allowed: StreetMergeChoice[] = ["keep-current", "use-incoming"],
	) => {
		const id = JSON.stringify(path);
		conflicts.push({
			id,
			path,
			reason,
			current: a ?? null,
			incoming: b ?? null,
			choices: allowed,
		});
		const choice = choices[id];
		if (choice && !allowed.includes(choice))
			throw Error("Choice would discard protected user work");
		return choice === "use-incoming" ? b : a;
	};
	const merge = (
		a: unknown,
		b: unknown,
		c: unknown,
		path: string[],
	): unknown => {
		if (
			Object.values(now.propertyEvidence ?? {}).some(
				(p) =>
					p.accepted.kind === "correction" &&
					same(path, [
						p.target.category,
						p.target.featureId,
						"data",
						...p.target.path,
					]),
			)
		)
			return b;
		if (same(b, a)) return c;
		if (same(c, a) || same(b, c)) return b;
		if (object(a) && object(b) && object(c)) {
			const out: Record<string, unknown> = {};
			for (const k of new Set([
				...Object.keys(a),
				...Object.keys(b),
				...Object.keys(c),
			])) {
				const v = merge(a[k], b[k], c[k], [...path, k]);
				if (v !== undefined) out[k] = v;
			}
			return out;
		}
		return conflict(
			path,
			"Both source and accepted data changed this value",
			b,
			c,
		);
	};
	const next: StreetBaselineRevision = structuredClone(now);
	next.id = `${now.id}:refresh:${current.revision + 1}`;
	next.parentRevisionId = now.id;
	next.acceptedAt = acceptedAt;
	const scenarios = Object.values(current.scenarios).filter(
		(s) => s.baselineRevisionId === now.id,
	);
	const workFor = (category: "roads" | "features", id: string) => {
		if (category === "roads" && Object.keys(histories(now.roads[id])).length)
			return true;
		const properties = Object.values(now.propertyEvidence ?? {}).filter(
			(p) => p.target.category === category && p.target.featureId === id,
		);
		return (
			properties.some(
				(p) =>
					p.accepted.kind === "correction" ||
					scenarios.some((s) => s.overrides?.[p.id] || s.propertyLocks?.[p.id]),
			) ||
			scenarios.some(
				(s) =>
					Object.values(s.sectionEdits ?? {}).some(
						(e) => category === "roads" && e.roadId === id,
					) ||
					Object.values(s.inventorySuppressions ?? {}).some((x) =>
						x.target.category === "features"
							? category === "features" && x.target.featureId === id
							: category === "roads" && x.target.roadId === id,
					),
			)
		);
	};
	const supportsWork = (
		category: "roads" | "features",
		id: string,
		data: Record<string, unknown>,
	) => {
		if (
			category === "roads" &&
			Object.values(histories(now.roads[id])).some(
				(item) =>
					item.status === "accepted" &&
					item.assetNodeId &&
					!((data.referenceLines ?? data.edges) as Record<string, unknown>)?.[
						item.edgeId
					],
			)
		)
			return false;
		if (
			Object.values(now.propertyEvidence ?? {}).some(
				(p) =>
					p.target.category === category &&
					p.target.featureId === id &&
					((!hasStreetPropertyPath(data, p.target.path) &&
						!(
							p.accepted.kind === "correction" &&
							hasStreetPropertyPath(data, p.target.path.slice(0, -1))
						)) ||
						(fresh.propertyEvidence?.[p.id] &&
							!same(fresh.propertyEvidence[p.id]!.target, p.target))),
			)
		)
			return false;
		if (
			category === "roads" &&
			Object.values(now.propertyEvidence ?? {}).some(
				(p) =>
					p.target.featureId === id &&
					p.accepted.kind === "correction" &&
					p.target.path[0] === "sections" &&
					p.target.path[2] === "layout" &&
					(p.accepted.value as any)?.length !==
						(data.sections as Record<string, any>)?.[String(p.target.path[1])]
							?.interval.end,
			)
		)
			return false;
		return scenarios.every(
			(s) =>
				Object.values(s.sectionEdits ?? {}).every((e) => {
					if (category !== "roads" || e.roadId !== id) return true;
					const section = (data.sections as Record<string, any>)?.[e.sectionId];
					return (
						!!section &&
						(!e.layout ||
							(e.layout.value as any).length === section.interval.end)
					);
				}) &&
				Object.values(s.inventorySuppressions ?? {}).every((x) => {
					const t = x.target;
					if (t.category === "features") return true;
					if (category !== "roads" || t.roadId !== id) return true;
					const items =
						t.category === "attachments"
							? Object.values((data.attachments ?? {}) as object)
							: ((data.inventory as Record<string, unknown[]>)?.[t.category] ??
								[]);
					return items.some(
						(item) => streetInventoryItemId(t.category, item) === t.itemId,
					);
				}),
		);
	};
	for (const category of ["roads", "features"] as const) {
		const result: Record<string, any> = {};
		for (const id of new Set([
			...Object.keys(old[category]),
			...Object.keys(now[category]),
			...Object.keys(fresh[category]),
		])) {
			const a = old[category][id],
				b = now[category][id],
				c = fresh[category][id];
			if (a && !b) continue; // Intentional accepted deletion remains deleted.
			if (
				category === "features" &&
				!b &&
				c &&
				(c as { sourceFeatureId?: string | null }).sourceFeatureId
			) {
				const sourceFeatureId = (c as { sourceFeatureId: string })
					.sourceFeatureId;
				const decisions = Object.values(next.roads).flatMap((road) =>
					Object.values(histories(road)).flatMap((item) =>
						item.sourceDecisions[sourceFeatureId]
							? [item.sourceDecisions[sourceFeatureId]!.decision]
							: [],
					),
				);
				if (decisions.includes("linked") || decisions.includes("suppressed"))
					continue;
				const candidates = decisions.includes("distinct")
					? []
					: Object.values(next.roads).flatMap((road) =>
							generatedSourceDuplicateCandidates(histories(road), {
								id: sourceFeatureId,
								kind: c.data.kind,
								position: c.data.position,
							}).map((candidate) => ({ ...candidate, roadId: road.id })),
						);
				if (candidates.length) {
					const path = ["generated-source-duplicate", id],
						conflictId = JSON.stringify(path);
					const options: StreetMergeChoice[] = [
						"keep-distinct",
						...candidates.map(
							(candidate) =>
								`${candidate.status === "suppressed" ? "suppress-source" : "link-existing"}~${JSON.stringify([candidate.roadId, candidate.generatedItemId])}` as StreetMergeChoice,
						),
					];
					conflict(
						path,
						"New source observation may duplicate an accepted or suppressed generated fixture; choose using the evidence",
						candidates,
						c,
						options,
					);
					const choice = choices[conflictId];
					if (!choice) continue;
					for (const candidate of candidates) {
						if (
							choice !== "keep-distinct" &&
							!choice.endsWith(
								`~${JSON.stringify([candidate.roadId, candidate.generatedItemId])}`,
							)
						)
							continue;
						const road = next.roads[candidate.roadId]!,
							history = histories(road),
							item = history[candidate.generatedItemId]!;
						const decision =
							choice === "keep-distinct"
								? "distinct"
								: candidate.status === "suppressed"
									? "suppressed"
									: "linked";
						item.sourceDecisions[sourceFeatureId] = {
							decision,
							evidence: {
								...candidate.evidence,
								sourceReferenceId: source.id,
								contentIdentity: source.contentIdentity,
								integrityIdentity: diff.incomingIntegrityIdentity,
							},
							decidedAt: acceptedAt,
						};
						item.events.push({
							kind:
								decision === "distinct"
									? "source-distinct"
									: decision === "suppressed"
										? "source-suppressed"
										: "source-linked",
							at: acceptedAt,
							data: candidate.evidence,
						});
						putHistory(road, history);
					}
					if (choice !== "keep-distinct") continue;
				}
			}

			if (b && !b.sourceReferenceIds.includes(review.sourceReferenceId)) {
				result[id] = b;
				continue;
			}
			let value: unknown;
			const unsafe =
				category === "roads"
					? diff.spans.some((s) => s.roadId === id && s.status !== "matched")
					: diff.features.some(
							(f) =>
								f.acceptedTargets.includes(JSON.stringify(["features", id])) &&
								["ambiguous", "unobserved"].includes(f.status),
						);
			const incomingAmbiguous =
				!!c &&
				diff.features.some(
					(f) =>
						f.status === "ambiguous" &&
						(category === "features"
							? (
									c as { sourceFeatureId?: string | null }
								).sourceFeatureId?.replace("/", "~") ===
								f.sourceFeatureId.replace("osm~", "")
							: Object.values(
									(c.data.referenceLines ?? c.data.edges ?? {}) as Record<
										string,
										{ osmSource?: { wayId: number } }
									>,
								).some(
									(line) =>
										`osm~way~${line.osmSource?.wayId}` === f.sourceFeatureId,
								)),
				);
			if (!b && incomingAmbiguous)
				value = conflict(
					[category, id],
					"Incoming source identity is ambiguous",
					undefined,
					c,
				);
			else if (b && (!c || unsafe))
				value = conflict(
					[category, id],
					!c
						? "Source removed or changed this identity"
						: "Source topology match requires an explicit choice",
					b,
					c,
					workFor(category, id) && (!c || !supportsWork(category, id, c.data))
						? ["keep-current"]
						: ["keep-current", "use-incoming"],
				);
			else if (b && c && !supportsWork(category, id, c.data))
				value = conflict(
					[category, id],
					"Incoming data lacks a correction, lock or suppression target",
					b,
					c,
					["keep-current"],
				);
			else if (
				!a &&
				!b &&
				category === "roads" &&
				(Object.keys(old.roads).some((key) => !now.roads[key]) ||
					diff.spans.some(
						(s) => s.status === "ambiguous" || s.status === "missing",
					))
			)
				value = conflict(
					[category, id],
					"New component may replace a removed or split accepted road; no edits are remapped",
					undefined,
					c,
				);
			else if (b && c) {
				value = {
					...c,
					data: merge(a?.data, b.data, c.data, [category, id, "data"]),
				};
			} else value = c ?? b;
			if (value !== undefined && category === "roads" && b) {
				const road = structuredClone(value) as typeof b;
				const history = histories(b);
				if (Object.keys(history).length) {
					putHistory(road, history);
					road.data.attachments = {
						...(road.data.attachments as object),
						...Object.fromEntries(
							Object.entries(
								(b.data.attachments ?? {}) as Record<
									string,
									{ assetNodeId: string }
								>,
							).filter(([, anchor]) =>
								Object.values(history).some(
									(item) =>
										item.status === "accepted" &&
										item.assetNodeId === anchor.assetNodeId,
								),
							),
						),
					};
				}
				result[id] = road;
			} else if (value !== undefined) result[id] = structuredClone(value);
		}
		next[category] = result;
	}
	next.sourceReferenceIds = [
		...new Set([...now.sourceReferenceIds, ...fresh.sourceReferenceIds]),
	];
	next.propertyEvidence = {};
	for (const id of new Set([
		...Object.keys(now.propertyEvidence ?? {}),
		...Object.keys(fresh.propertyEvidence ?? {}),
	])) {
		const b = now.propertyEvidence?.[id],
			c = fresh.propertyEvidence?.[id];
		const target = b?.target ?? c!.target,
			owner = next[target.category][target.featureId];
		if (!owner || !hasStreetPropertyPath(owner.data, target.path)) continue;
		// Retained whole features keep their evidence. Corrections keep their accepted values and ancestry.
		const retained = same(owner, now[target.category][target.featureId]);
		if (b && (retained || b.accepted.kind === "correction")) {
			const claims = structuredClone(b.claims);
			for (const [key, claim] of Object.entries(c?.claims ?? {})) {
				if (claim.origin.kind === "inferred") continue;
				const claimId =
					claims[key] && !same(claims[key], claim)
						? `${key}:refresh:${current.revision + 1}`
						: key;
				if (claims[claimId] && !same(claims[claimId], claim))
					throw Error("Claim identity collision");
				claims[claimId] = { ...claim, id: claimId };
			}
			next.propertyEvidence[id] = { ...b, claims };
		} else if (c) next.propertyEvidence[id] = c;
		else if (b) next.propertyEvidence[id] = b;
	}
	// Source reports are evidence, not a replacement for accepted decisions.
	next.resolutionEvidence = {
		...(now.resolutionEvidence ?? {}),
		refresh: {
			diff: JSON.parse(JSON.stringify(diff)),
			incoming: fresh.resolutionEvidence ?? {},
			choices: JSON.parse(JSON.stringify(choices)),
		},
	};
	const unresolved = conflicts.filter((c) => !choices[c.id]);
	if (unresolved.length) return { conflicts, unresolved, project: null };
	for (const [id, ref] of Object.entries(incoming.sourceReferences)) {
		if (
			current.sourceReferences[id] &&
			!same(current.sourceReferences[id], ref)
		)
			throw Error("Source identity collision");
		current.sourceReferences[id] = ref;
	}
	if (current.baselineRevisions[next.id])
		throw Error("Baseline identity collision");
	current.baselineRevisions[next.id] = next;
	current.activeBaselineRevisionId = next.id;
	current.revision++;
	for (const s of Object.values(current.scenarios))
		if (s.baselineRevisionId === now.id) s.baselineRevisionId = next.id;
	return { conflicts, unresolved, project: parseStreetProject(current) };
}

export function streetMergeChoiceLabel(choice: StreetMergeChoice) {
	if (choice === "keep-current") return "Keep accepted work";
	if (choice === "use-incoming") return "Use incoming source";
	if (choice === "keep-distinct") return "Keep as a distinct observed object";
	return `${choice.startsWith("suppress-source~") ? "Suppress the matched observation" : "Link to the existing accepted fixture"} ${choice.slice(choice.indexOf("~") + 1)}`;
}
