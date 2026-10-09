import {
	parseStreetProject,
	StreetSourceReference,
	type StreetProject,
} from "../domain/street-project";
import {
	OSM_SOURCE_SNAPSHOT_FORMAT,
	parseOsmSourceSnapshot,
	type OsmSourceSnapshot,
} from "./osm-source-snapshot";

/** Add evidence under a new identity; never rewrite a captured reference in place. */
export async function attachOsmSourceSnapshot(
	input: StreetProject,
	sourceReferenceId: string,
	snapshot: OsmSourceSnapshot,
): Promise<StreetProject> {
	const project = parseStreetProject(input);
	if (Object.hasOwn(project.sourceReferences, sourceReferenceId))
		throw Error(
			"Source reference already exists; use a new reference for a new capture",
		);
	const verified = await parseOsmSourceSnapshot(snapshot);
	project.sourceReferences[sourceReferenceId] = StreetSourceReference.parse({
		id: sourceReferenceId,
		provider: "openstreetmap",
		acquiredAt: verified.acquiredAt,
		contentIdentity: verified.contentIdentity,
		snapshot: {
			status: "embedded",
			format: OSM_SOURCE_SNAPSHOT_FORMAT,
			data: JSON.parse(JSON.stringify(verified)),
		},
	});
	project.revision++;
	return parseStreetProject(project);
}
/** Verify embedded recognized snapshots; external/unavailable evidence remains explicit. */
export async function verifyStreetProjectSnapshots(input: StreetProject) {
	const project = parseStreetProject(input);
	const snapshots: Record<string, OsmSourceSnapshot> = {};
	for (const [id, source] of Object.entries(project.sourceReferences)) {
		if (
			source.snapshot.status !== "embedded" ||
			source.snapshot.format !== OSM_SOURCE_SNAPSHOT_FORMAT
		)
			continue;
		const snapshot = await parseOsmSourceSnapshot(source.snapshot.data);
		if (
			source.provider !== snapshot.provider ||
			source.contentIdentity !== snapshot.contentIdentity ||
			source.acquiredAt !== snapshot.acquiredAt
		)
			throw Error(`Source reference does not match its snapshot: ${id}`);
		snapshots[id] = snapshot;
	}
	return { project, snapshots };
}
