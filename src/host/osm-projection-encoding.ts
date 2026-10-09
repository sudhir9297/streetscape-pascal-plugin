/**
 * OSM stores wikipedia links as `language:Article_title`, while Pascal's scene
 * validator treats a `wikipedia` field as a URL. Convert the OSM convention at
 * the ingestion boundary so otherwise valid imports remain persistable.
 */
export function normalizeOsmTags(
	tags: Record<string, string>,
): Record<string, string> {
	const normalized = { ...tags };
	const wikipedia = normalized.wikipedia?.trim();
	if (wikipedia && /^https:\/\//i.test(wikipedia)) {
		normalized.wikipedia = wikipedia;
	} else if (wikipedia) {
		const article = wikipedia.match(/^([a-z]{2,3}(?:-[a-z0-9]+)*):(.+)$/i);
		if (article) {
			normalized.wikipedia = `https://${article[1]!.toLowerCase()}.wikipedia.org/wiki/${encodeURIComponent(article[2]!).replace(/%2F/gi, "/")}`;
		} else {
			delete normalized.wikipedia;
		}
	}
	for (const [key, value] of Object.entries(normalized)) {
		if (/^https?:\/\//i.test(value)) continue;
		// Values such as `US:NY` and `Category:Roads` are OSM identifiers, not URLs.
		if (/^[a-z][a-z0-9+.-]*:/i.test(value))
			normalized[key] = value.replace(":", "%3A");
	}
	return normalized;
}

/** Encode source facts only while constructing an existing host projection. */
export function encodeOsmHostProjection<T>(input: T): T {
	const data = structuredClone(input) as T & {
		edges?: Record<string, { osmSource?: { tags: Record<string, string> } }>;
		osmMappedSurfaces?: Array<{ tags: Record<string, string> }>;
		osmCrossings?: Array<{ tags: Record<string, string> }>;
		osmLaneConnectivity?: Array<{ tags: Record<string, string> }>;
		stylePresets?: Record<
			string,
			{ dimensionSources?: Record<string, { tag?: string }> }
		>;
	};
	for (const edge of Object.values(data.edges ?? {}))
		if (edge.osmSource)
			edge.osmSource.tags = normalizeOsmTags(edge.osmSource.tags);
	for (const feature of [
		...(data.osmMappedSurfaces ?? []),
		...(data.osmCrossings ?? []),
		...(data.osmLaneConnectivity ?? []),
	])
		feature.tags = normalizeOsmTags(feature.tags);
	for (const style of Object.values(data.stylePresets ?? {}))
		for (const source of Object.values(style.dimensionSources ?? {}))
			if (source.tag) source.tag = normalizeOsmTags({ tag: source.tag }).tag;
	return data;
}
