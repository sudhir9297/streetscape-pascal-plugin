import { z } from "zod";
import {
	parseStreetProject,
	type StreetProject,
} from "../domain/street-project";
import { ResolvedStreetRoadData } from "../domain/resolved-street-road";
import {
	matchOsmSourceSpan,
	type OsmRoadSource,
} from "../domain/source-identity";
import {
	normalizeOsmAcquisition,
	type NormalizedOsmFeature,
} from "./osm-normalization";
import {
	canonicalSourceJson,
	createOsmSourceSnapshot,
	parseOsmSourceSnapshot,
	OSM_SOURCE_SNAPSHOT_FORMAT,
	type OsmSourceSnapshot,
} from "./osm-source-snapshot";
import {
	acquireOsmData,
	parseOsmAcquisition,
	type OsmAcquisitionOptions,
} from "./osm-acquisition";
const Id = z.string().min(1);
export const StreetSourceRefreshDiff = z.strictObject({
	format: z.literal("street-source-refresh-diff"),
	schemaVersion: z.literal(1),
	projectId: Id,
	projectRevision: z.number().int().nonnegative(),
	baselineRevisionId: Id,
	sourceReferenceId: Id,
	previousContentIdentity: Id,
	incomingContentIdentity: Id,
	previousIntegrityIdentity: Id,
	incomingIntegrityIdentity: Id,
	coverageComparable: z.boolean(),
	features: z.array(
		z.strictObject({
			sourceFeatureId: Id,
			kind: Id,
			status: z.enum([
				"added",
				"removed",
				"changed",
				"unchanged",
				"ambiguous",
				"unobserved",
			]),
			changedFields: z.array(Id),
			metadataChanged: z.boolean(),
			previous: z.json().nullable(),
			incoming: z.json().nullable(),
			acceptedTargets: z.array(Id),
		}),
	),
	spans: z.array(
		z.strictObject({
			roadId: Id,
			edgeId: Id,
			status: z.enum([
				"matched",
				"ambiguous",
				"missing",
				"unobserved",
				"unlocated",
			]),
			candidateIds: z.array(Id),
			acceptedSource: z.json().nullable(),
		}),
	),
	diagnostics: z.array(z.string()),
});
export type StreetSourceRefreshDiff = z.infer<typeof StreetSourceRefreshDiff>;
const metadataKeys = new Set([
	"version",
	"timestamp",
	"changeset",
	"uid",
	"user",
]);
const semantic = (feature: NormalizedOsmFeature) => ({
	kind: feature.kind,
	disposition: feature.disposition,
	tags: feature.raw.tags ?? {},
	geometry: feature.geometry,
	nodes: feature.raw.nodes ?? null,
	members: feature.raw.members ?? null,
});
const metadata = (feature: NormalizedOsmFeature) =>
	Object.fromEntries(
		Object.entries(feature.raw).filter(([key]) => metadataKeys.has(key)),
	);
/** Verify rectangular response coverage; absence in a partial/different extent is not deletion. */
function covers(snapshot: OsmSourceSnapshot) {
	const b = snapshot.acquisition.bbox,
		rects = snapshot.acquisition.responses.map((r) => r.bbox);
	const xs = [
		...new Set([
			b.west,
			b.east,
			...rects.flatMap((r) => [
				Math.max(b.west, Math.min(b.east, r.west)),
				Math.max(b.west, Math.min(b.east, r.east)),
			]),
		]),
	].sort((a, b) => a - b);
	const ys = [
		...new Set([
			b.south,
			b.north,
			...rects.flatMap((r) => [
				Math.max(b.south, Math.min(b.north, r.south)),
				Math.max(b.south, Math.min(b.north, r.north)),
			]),
		]),
	].sort((a, b) => a - b);
	return xs
		.slice(1)
		.every((x, i) =>
			ys
				.slice(1)
				.every((y, j) =>
					rects.some(
						(r) =>
							(xs[i]! + x) / 2 >= r.west &&
							(xs[i]! + x) / 2 <= r.east &&
							(ys[j]! + y) / 2 >= r.south &&
							(ys[j]! + y) / 2 <= r.north,
					),
				),
		);
}
function roadSources(
	project: StreetProject,
	baselineId: string,
	sourceId: string,
) {
	const baseline = project.baselineRevisions[baselineId]!;
	return Object.values(baseline.roads)
		.filter((r) => r.sourceReferenceIds.includes(sourceId))
		.flatMap((road) => {
			const parsed = ResolvedStreetRoadData.safeParse(road.data);
			const lines = parsed.success
				? parsed.data.referenceLines
				: (road.data.edges as Record<
						string,
						{ id: string; osmSource?: OsmRoadSource }
					>);
			return Object.values(lines ?? {}).map((edge) => ({
				roadId: road.id,
				edgeId: edge.id,
				source: edge.osmSource as OsmRoadSource | undefined,
			}));
		});
}
function spanCandidates(
	source: OsmRoadSource,
	features: NormalizedOsmFeature[],
) {
	const candidates: Array<{ id: string; source: OsmRoadSource }> = [];
	for (const feature of features) {
		if (
			feature.kind !== "road" ||
			feature.disposition !== "accepted" ||
			feature.geometry?.kind !== "way"
		)
			continue;
		const nodes = feature.geometry.points.map((p) => p.nodeId);
		for (let i = 0; i < nodes.length - 1; i++)
			candidates.push({
				id: `${feature.featureId}~span~${i}~${i + 1}`,
				source: {
					wayId: feature.id,
					nodeIds: nodes,
					span: { start: i, end: i + 1, coverage: "exact" },
				},
			});
		if (source.nodeIds && source.span?.coverage === "exact") {
			const first = Math.floor(source.span.start),
				last = Math.ceil(source.span.end),
				sequence = source.nodeIds.slice(first, last + 1);
			for (let i = 0; i <= nodes.length - sequence.length; i++) {
				if (
					sequence.length < 2 ||
					!sequence.every((id, j) => nodes[i + j] === id)
				)
					continue;
				const start = i + source.span.start - first,
					end = i + source.span.end - first;
				const id = `${feature.featureId}~span~${start}~${end}`;
				if (!candidates.some((c) => c.id === id))
					candidates.push({
						id,
						source: {
							wayId: feature.id,
							nodeIds: nodes,
							span: { start, end, coverage: "exact" },
						},
					});
			}
		}
	}
	return candidates;
}
/** Pure comparison after integrity verification. No acquisition or scene writes. */
export async function generateStreetSourceRefreshDiff(
	input: StreetProject,
	baselineId: string,
	sourceId: string,
	incomingInput: unknown,
) {
	const project = parseStreetProject(input),
		baseline = project.baselineRevisions[baselineId];
	const reference = project.sourceReferences[sourceId];
	if (!baseline?.sourceReferenceIds.includes(sourceId))
		throw Error("Select a source belonging to the accepted baseline");
	if (
		reference?.snapshot.status !== "embedded" ||
		reference.snapshot.format !== OSM_SOURCE_SNAPSHOT_FORMAT
	)
		throw Error(
			"The retained source snapshot is unavailable; acquire and retain a baseline snapshot before comparing refreshes",
		);
	const previous = await parseOsmSourceSnapshot(reference.snapshot.data);
	if (
		reference.contentIdentity !== previous.contentIdentity ||
		reference.acquiredAt !== previous.acquiredAt ||
		reference.provider !== previous.provider
	)
		throw Error("Retained source reference does not match its snapshot");
	const incoming = await parseOsmSourceSnapshot(incomingInput);
	const oldSource = normalizeOsmAcquisition(
			parseOsmAcquisition(previous.acquisition),
		),
		newSource = normalizeOsmAcquisition(
			parseOsmAcquisition(incoming.acquisition),
		);
	const oldMap = new Map(oldSource.features.map((f) => [f.featureId, f])),
		newMap = new Map(newSource.features.map((f) => [f.featureId, f]));
	const queries = (s: OsmSourceSnapshot) =>
		[
			...new Set(
				s.acquisition.responses.flatMap((r) =>
					r.capture ? [r.capture.query] : [],
				),
			),
		].sort();
	const queriesComparable =
		canonicalSourceJson(queries(previous)) ===
		canonicalSourceJson(queries(incoming));
	const coverageComparable =
		queriesComparable &&
		canonicalSourceJson(previous.acquisition.bbox) ===
			canonicalSourceJson(incoming.acquisition.bbox) &&
		covers(previous) &&
		covers(incoming);
	const sources = roadSources(project, baselineId, sourceId);
	const diagnostics: string[] = [];
	if (!coverageComparable)
		diagnostics.push(
			"Capture extents/response coverage differ. Missing features are unobserved, not confirmed removals.",
		);
	if (
		previous.completeness.capture.status !== "complete" ||
		incoming.completeness.capture.status !== "complete"
	)
		diagnostics.push(
			"Capture metadata is incomplete; source absence is not proof of a change on the ground.",
		);
	if (!queriesComparable)
		diagnostics.push(
			"Acquisition queries differ; review changes in source selection before merging.",
		);
	const features = [...new Set([...oldMap.keys(), ...newMap.keys()])]
		.sort()
		.map((id) => {
			const old = oldMap.get(id),
				next = newMap.get(id);
			const changedFields =
				old && next
					? Object.keys(semantic(old)).filter(
							(key) =>
								canonicalSourceJson(
									(semantic(old) as Record<string, unknown>)[key],
								) !==
								canonicalSourceJson(
									(semantic(next) as Record<string, unknown>)[key],
								),
						)
					: [];
			const ambiguous = [old, next].some((f) =>
				f?.diagnostics.some(
					(d) => d.severity === "error" || d.code === "source-conflict",
				),
			);
			const status = ambiguous
				? "ambiguous"
				: !old
					? "added"
					: !next
						? coverageComparable
							? "removed"
							: "unobserved"
						: changedFields.length
							? "changed"
							: "unchanged";
			const acceptedTargets = [
				...sources
					.filter(
						(s) =>
							s.source?.wayId === Number(id.split("~").at(-1)) &&
							id.startsWith("osm~way~"),
					)
					.map((s) => JSON.stringify(["roads", s.roadId, s.edgeId])),
				...Object.values(baseline.features)
					.filter(
						(f) =>
							f.sourceReferenceIds.includes(sourceId) &&
							(f.sourceFeatureId === id ||
								f.sourceFeatureId ===
									`${id.split("~")[1]}/${id.split("~")[2]}`),
					)
					.map((f) => JSON.stringify(["features", f.id])),
				...Object.values(baseline.propertyEvidence ?? {})
					.filter((p) =>
						Object.values(p.claims).some(
							(c) =>
								c.origin.kind === "source" &&
								c.origin.sourceReferenceId === sourceId &&
								(c.origin.sourceFeatureId === id ||
									c.origin.sourceFeatureId ===
										`${id.split("~")[1]}/${id.split("~")[2]}`),
						),
					)
					.map((p) => JSON.stringify(["properties", p.id])),
			];
			return {
				sourceFeatureId: id,
				kind: (next ?? old)!.kind,
				status,
				changedFields,
				metadataChanged:
					!!old &&
					!!next &&
					canonicalSourceJson(metadata(old)) !==
						canonicalSourceJson(metadata(next)),
				previous: old
					? JSON.parse(JSON.stringify({ raw: old.raw, variants: old.variants }))
					: null,
				incoming: next
					? JSON.parse(
							JSON.stringify({ raw: next.raw, variants: next.variants }),
						)
					: null,
				acceptedTargets: [...new Set(acceptedTargets)].sort(),
			};
		});
	const spans = sources.map((s) => {
		if (!s.source)
			return {
				roadId: s.roadId,
				edgeId: s.edgeId,
				status: "unlocated",
				candidateIds: [],
				acceptedSource: null,
			};
		const rawCandidate = newMap.get(`osm~way~${s.source.wayId}`);
		if (
			rawCandidate &&
			(rawCandidate.kind !== "road" ||
				rawCandidate.disposition !== "accepted" ||
				rawCandidate.diagnostics.some((d) => d.code === "source-conflict"))
		)
			return {
				roadId: s.roadId,
				edgeId: s.edgeId,
				status: "ambiguous",
				candidateIds: [rawCandidate.featureId],
				acceptedSource: JSON.parse(JSON.stringify(s.source)),
			};
		const match = matchOsmSourceSpan(
			s.source,
			spanCandidates(s.source, newSource.features),
		);
		return {
			roadId: s.roadId,
			edgeId: s.edgeId,
			status:
				match.status === "missing" && !coverageComparable
					? "unobserved"
					: match.status,
			candidateIds: match.candidateIds,
			acceptedSource: JSON.parse(JSON.stringify(s.source)),
		};
	});
	for (const f of [...oldSource.features, ...newSource.features])
		for (const d of f.diagnostics)
			if (d.severity === "error" || d.code === "source-conflict")
				diagnostics.push(`${f.featureId}: ${d.message}`);
	const diff = StreetSourceRefreshDiff.parse({
		format: "street-source-refresh-diff",
		schemaVersion: 1,
		projectId: project.id,
		projectRevision: project.revision,
		baselineRevisionId: baselineId,
		sourceReferenceId: sourceId,
		previousContentIdentity: previous.contentIdentity,
		incomingContentIdentity: incoming.contentIdentity,
		previousIntegrityIdentity: previous.integrityIdentity,
		incomingIntegrityIdentity: incoming.integrityIdentity,
		coverageComparable,
		features,
		spans,
		diagnostics: [...new Set(diagnostics)].sort(),
	});
	return { diff, incomingSnapshot: incoming };
}
/** Explicit action, using the retained requested bounds and a fresh acquisition client. */
export async function acquireStreetSourceRefresh(
	input: StreetProject,
	baselineId: string,
	sourceId: string,
	options: OsmAcquisitionOptions = {},
) {
	const project = parseStreetProject(input),
		reference = project.sourceReferences[sourceId];
	if (
		!project.baselineRevisions[baselineId]?.sourceReferenceIds.includes(
			sourceId,
		) ||
		reference?.snapshot.status !== "embedded" ||
		reference.snapshot.format !== OSM_SOURCE_SNAPSHOT_FORMAT
	)
		throw Error("An embedded baseline snapshot is required for refresh");
	const old = await parseOsmSourceSnapshot(reference.snapshot.data);
	// Supplying the transport creates a fresh client rather than reusing import cache.
	const acquisition = await acquireOsmData(old.acquisition.bbox, {
		...options,
		fetch: options.fetch ?? globalThis.fetch,
	});
	options.signal?.throwIfAborted();
	const snapshot = await createOsmSourceSnapshot(acquisition);
	return generateStreetSourceRefreshDiff(
		project,
		baselineId,
		sourceId,
		snapshot,
	);
}
