import { useState } from "react";
import { useScene } from "@pascal-app/core";
import { readStreetProjectView } from "./host/street-project-persistence";
import { ResolvedStreetRoadData } from "./domain/resolved-street-road";
import {
	streetSectionDesignId,
	streetInventoryItemId,
	streetInventoryTargetId,
	type StreetInventoryTarget,
} from "./domain/street-scenario";
import {
	lockStreetScenarioSection,
	redesignStreetSectionStyle,
	suppressStreetScenarioInventory,
} from "./host/street-scenario-command";
export function ScenarioEffectiveInspector() {
	const nodes = useScene((s) => s.nodes),
		[reason, setReason] = useState(""),
		[message, setMessage] = useState("");
	const run = (fn: () => unknown) => {
		try {
			fn();
			setMessage("Scenario updated. Accepted baseline retained.");
		} catch (error) {
			setMessage(String(error));
		}
	};
	return (
		<section
			aria-label="Scenario locks and inventory"
			className="space-y-3 rounded-md border border-border p-3 text-sm [&_label]:block [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:border-border [&_input]:p-2 [&_button]:my-2 [&_button]:rounded [&_button]:border [&_button]:border-border [&_button]:px-2 [&_button]:py-1"
		>
			<h3>Scenario locks and inventory</h3>
			{Object.values(nodes)
				.filter((n) => n.type === "site")
				.map((site) => {
					const doc = readStreetProjectView(site);
					if (!doc?.project.activeScenarioId) return null;
					const scenario = doc.project.scenarios[doc.project.activeScenarioId]!,
						baseline =
							doc.project.baselineRevisions[scenario.baselineRevisionId]!;
					const inventories: Array<{
						target: StreetInventoryTarget;
						label: string;
					}> = Object.values(baseline.features).map((feature, index) => ({
						target: { category: "features", featureId: feature.id },
						label: `Asset ${index + 1} (${feature.kind})`,
					}));
					const toggle = (target: StreetInventoryTarget) => {
						const suppressed =
							!!scenario.inventorySuppressions?.[
								streetInventoryTargetId(target)
							];
						return (
							<button
								key={streetInventoryTargetId(target)}
								onClick={() =>
									run(() =>
										suppressStreetScenarioInventory(
											site.id,
											doc.project.revision,
											target,
											!suppressed,
											reason,
										),
									)
								}
							>
								{suppressed ? "Restore" : "Suppress"}{" "}
								{
									inventories.find(
										(i) =>
											streetInventoryTargetId(i.target) ===
											streetInventoryTargetId(target),
									)!.label
								}
							</button>
						);
					};
					return (
						<div key={site.id}>
							<p>
								Locks pin the current design values. Suppression removes
								inventory from this scenario's compilation while retaining its
								source evidence.
							</p>
							<label>
								Change reason
								<input
									aria-label="Scenario effective change reason"
									value={reason}
									onChange={(e) => setReason(e.target.value)}
								/>
							</label>
							{Object.values(baseline.roads).map((road, roadIndex) => {
								const data = ResolvedStreetRoadData.safeParse(road.data);
								if (!data.success) return null;
								for (const category of [
									"surfaces",
									"crossings",
									"laneConnectivity",
									"attachments",
								] as const) {
									const items =
										category === "attachments"
											? Object.values(data.data.attachments)
											: data.data.inventory[category];
									items.forEach((item, index) =>
										inventories.push({
											target: {
												category,
												roadId: road.id,
												itemId: streetInventoryItemId(category, item),
											},
											label: `Road ${roadIndex + 1} ${category} ${index + 1}`,
										}),
									);
								}
								return (
									<div key={road.id}>
										{Object.values(data.data.sections).map((section, index) => {
											const locked =
												!!scenario.sectionEdits?.[
													streetSectionDesignId(road.id, section.id)
												]?.locked;
											return (
												<div key={section.id}>
													<p>
														Road {roadIndex + 1}, section {index + 1} ·{" "}
														{locked ? "locked" : "editable"}
													</p>
													<button
														onClick={() =>
															run(() =>
																lockStreetScenarioSection(
																	site.id,
																	doc.project.revision,
																	road.id,
																	section.id,
																	!locked,
																	reason,
																),
															)
														}
													>
														{locked ? "Unlock" : "Lock"} section {index + 1}
													</button>
													<label>
														Design pavement
														<select
															aria-label={`Scenario pavement road ${roadIndex + 1} section ${index + 1}`}
															disabled={locked}
															value={String(
																(
																	scenario.sectionEdits?.[
																		streetSectionDesignId(road.id, section.id)
																	]?.style?.value as
																		Record<string, unknown> | undefined
																)?.surfaceMaterial ?? "",
															)}
															onChange={(e) =>
																run(() =>
																	redesignStreetSectionStyle(
																		site.id,
																		doc.project.revision,
																		road.id,
																		section.id,
																		{ surfaceMaterial: e.target.value },
																		reason,
																	),
																)
															}
														>
															<option value="" disabled>
																Inherited baseline material
															</option>
															<option value="asphalt">Asphalt</option>
															<option value="concrete">Concrete</option>
															<option value="paving-stones">
																Paving stones
															</option>
														</select>
													</label>
												</div>
											);
										})}
									</div>
								);
							})}
							<details>
								<summary>Scenario inventory ({inventories.length})</summary>
								{inventories.map((i) => toggle(i.target))}
							</details>
						</div>
					);
				})}
			{message && <p role="status">{message}</p>}
		</section>
	);
}
