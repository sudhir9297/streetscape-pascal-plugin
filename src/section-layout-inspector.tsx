import { streetSectionDesignId } from "./domain/street-scenario";
import { resolveStreetFeatureData } from "./domain/street-resolution";
import { SectionLayoutEditor } from "./section-layout-editor";
import { useScene } from "@pascal-app/core";
import { readStreetProjectView } from "./host/street-project-persistence";
import { ResolvedStreetRoadData } from "./domain/resolved-street-road";
import { summarizeStreetSectionInterval } from "./domain/street-section-layout";
export function SectionLayoutInspector() {
	const nodes = useScene((state) => state.nodes);
	const sections = Object.values(nodes)
		.filter((node) => node.type === "site")
		.flatMap((site) => {
			const doc = readStreetProjectView(site);
			if (!doc) return [];
			return Object.values(
				doc.project.baselineRevisions[doc.project.activeBaselineRevisionId]!
					.roads,
			).flatMap((road) => {
				const data = ResolvedStreetRoadData.safeParse(
					resolveStreetFeatureData(
						doc.project,
						doc.project.activeBaselineRevisionId,
						"roads",
						road.id,
						doc.project.activeScenarioId,
					),
				);
				return data.success
					? Object.values(data.data.sections)
							.filter((section) => section.layout)
							.map((section) => ({
								...section,
								siteId: site.id,
								roadId: road.id,
								revision: doc.project.revision,
								scenarioId: doc.project.activeScenarioId,
								locked: !!(
									doc.project.activeScenarioId &&
									doc.project.scenarios[doc.project.activeScenarioId]
										?.sectionEdits?.[streetSectionDesignId(road.id, section.id)]
										?.locked
								),
							}))
					: [];
			});
		});
	if (!sections.length) return null;
	return (
		<section aria-label="Ordered section layouts">
			<h3>Ordered section layouts</h3>
			<p>
				Stations and widths are in metres. Bands are separate from traffic
				lanes. Review interval widths and junction joins after corrections.
			</p>
			{sections.map((section) => (
				<article key={`${section.siteId}:${section.roadId}:${section.id}`}>
					<h4>{section.id}</h4>
					{section.layout!.intervals.map((interval) => {
						const summary = summarizeStreetSectionInterval(interval);
						return (
							<div key={interval.id}>
								<p>
									{interval.start}–{interval.end} m · {summary.trafficLaneCount}{" "}
									traffic lanes · total width {summary.totalWidth.toFixed(2)} m
								</p>
								<p>
									Traffic:{" "}
									{interval.lanes
										.map(
											(lane) =>
												`${lane.id}: ${lane.direction} ${lane.use} ${lane.width} m`,
										)
										.join("; ")}
								</p>
								<p>
									Left:{" "}
									{interval.leftBands
										.map((band) => `${band.kind} ${band.width} m`)
										.join("; ")}
								</p>
								<p>
									Right:{" "}
									{interval.rightBands
										.map((band) => `${band.kind} ${band.width} m`)
										.join("; ")}
								</p>
							</div>
						);
					})}
					<SectionLayoutEditor
						key={`${section.siteId}:${section.roadId}:${section.id}:${section.scenarioId}`}
						scenarioId={section.scenarioId}
						locked={section.locked}
						siteId={section.siteId}
						roadId={section.roadId}
						sectionId={section.id}
						revision={section.revision}
						layout={section.layout!}
					/>
				</article>
			))}
		</section>
	);
}
