/** Source identity remains separate from graph IDs, which editors may remap. */
export type OsmRoadSource = {
	wayId: number;
	nodeIds?: number[];
	span?: { start: number; end: number; coverage: "exact" | "conservative" };
};

export type FeatureIdentityRemap = Record<string, string[]>;

export function osmSpanIdentity(source: OsmRoadSource): string | null {
	if (!source.nodeIds || !source.span || source.span.coverage !== "exact")
		return null;
	const { start, end } = source.span;
	if (
		!Number.isFinite(start) ||
		!Number.isFinite(end) ||
		start < 0 ||
		end <= start ||
		end > source.nodeIds.length - 1
	)
		return null;
	const first = Math.floor(start);
	const last = Math.ceil(end);
	// Include the ordered topology, not coordinates or array position in the response.
	return `osm:way:${source.wayId}:${source.nodeIds.slice(first, last + 1).join(".")}:${start - first}:${end - first}`;
}

/** Never guess identity from proximity when upstream topology has changed. */
export function matchOsmSourceSpan(
	previous: OsmRoadSource,
	candidates: Array<{ id: string; source: OsmRoadSource }>,
): { status: "matched" | "ambiguous" | "missing"; candidateIds: string[] } {
	const key = osmSpanIdentity(previous);
	const exact =
		key === null
			? []
			: candidates.filter(
					(candidate) => osmSpanIdentity(candidate.source) === key,
				);
	if (exact.length === 1)
		return { status: "matched", candidateIds: [exact[0]!.id] };
	const possible =
		exact.length > 1
			? exact
			: candidates.filter(
					({ source }) =>
						source.wayId === previous.wayId ||
						source.nodeIds?.some((id) => previous.nodeIds?.includes(id)),
				);
	return {
		status: possible.length ? "ambiguous" : "missing",
		candidateIds: possible.map((value) => value.id).sort(),
	};
}
