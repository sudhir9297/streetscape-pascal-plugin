import { useState } from "react";
import { useScene } from "@pascal-app/core";
import { readStreetProjectView } from "./host/street-project-persistence";
import {
	createStreetScenario,
	selectStreetScenario,
	redesignStreetProperty,
	redesignStreetSectionStyle,
} from "./host/street-scenario-command";
export function StreetScenarioInspector() {
	const nodes = useScene((s) => s.nodes);
	const [color, setColor] = useState("#909090");
	const [reason, setReason] = useState("");
	const [name, setName] = useState("");
	const [message, setMessage] = useState("");
	const run = (action: () => unknown) => {
		try {
			action();
			setMessage("Street mode updated.");
		} catch (error) {
			setMessage(String(error));
		}
	};
	return (
		<section
			aria-label="Street design scenarios"
			className="space-y-3 rounded-md border border-border p-3 text-sm [&_label]:block [&_input]:block [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:border-border [&_input]:p-2 [&_select]:block [&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-border [&_select]:p-2 [&_button]:my-2 [&_button]:rounded [&_button]:border [&_button]:border-border [&_button]:px-3 [&_button]:py-2"
		>
			<h3>Baseline and design scenarios</h3>
			{Object.values(nodes)
				.filter((n) => n.type === "site")
				.map((site) => {
					const doc = readStreetProjectView(site);
					if (!doc) return null;
					const project = doc.project;
					return (
						<div key={site.id}>
							<p>
								{project.activeScenarioId
									? `Design: ${project.scenarios[project.activeScenarioId]!.name}`
									: "Accepted baseline"}{" "}
								· accepted{" "}
								{project.baselineRevisions[
									project.activeBaselineRevisionId
								]!.acceptedAt.slice(0, 10)}
							</p>
							<p>
								Baseline edits correct reality. Scenario edits propose changes
								and retain accepted evidence.
							</p>
							<select
								aria-label="Street mode"
								value={project.activeScenarioId ?? ""}
								onChange={(e) =>
									run(() =>
										selectStreetScenario(
											site.id,
											project.revision,
											e.target.value || null,
										),
									)
								}
							>
								<option value="">Accepted baseline</option>
								{Object.values(project.scenarios).map((s) => (
									<option key={s.id} value={s.id}>
										{s.name}
									</option>
								))}
							</select>
							<label>
								Scenario name
								<input
									aria-label="Scenario name"
									value={name}
									onChange={(e) => setName(e.target.value)}
								/>
							</label>
							<button
								onClick={() =>
									run(() =>
										createStreetScenario(site.id, project.revision, name),
									)
								}
							>
								Create design scenario
							</button>
							{project.activeScenarioId && (
								<div>
									<label>
										Design surface color
										<input
											aria-label="Design surface color"
											type="color"
											value={color}
											onChange={(e) => setColor(e.target.value)}
										/>
									</label>
									<label>
										Design reason
										<input
											aria-label="Design reason"
											value={reason}
											onChange={(e) => setReason(e.target.value)}
										/>
									</label>
									{Object.values(
										project.baselineRevisions[project.activeBaselineRevisionId]!
											.propertyEvidence ?? {},
									)
										.filter(
											(p) =>
												p.target.path.at(-1) === "surfaceColor" ||
												p.target.path.at(-1) === "surfaceMaterial",
										)
										.map((p, index) => (
											<div key={p.id}>
												Section {index + 1} surface
												{p.target.path.at(-1) === "surfaceMaterial" ? (
													<select
														aria-label={`Design material ${p.id}`}
														defaultValue=""
														onChange={(e) =>
															run(() =>
																p.target.path[0] === "sections" &&
																typeof p.target.path[1] === "string"
																	? redesignStreetSectionStyle(
																			site.id,
																			project.revision,
																			p.target.featureId,
																			p.target.path[1],
																			{ surfaceMaterial: e.target.value },
																			reason,
																		)
																	: redesignStreetProperty(
																			site.id,
																			project.revision,
																			p.id,
																			e.target.value,
																			reason,
																		),
															)
														}
													>
														<option value="" disabled>
															Select design material
														</option>
														<option>asphalt</option>
														<option>concrete</option>
														<option>paving-stones</option>
													</select>
												) : (
													<button
														onClick={() =>
															run(() =>
																p.target.path[0] === "sections" &&
																typeof p.target.path[1] === "string"
																	? redesignStreetSectionStyle(
																			site.id,
																			project.revision,
																			p.target.featureId,
																			p.target.path[1],
																			{ surfaceColor: color },
																			reason,
																		)
																	: redesignStreetProperty(
																			site.id,
																			project.revision,
																			p.id,
																			color,
																			reason,
																		),
															)
														}
													>
														Apply design surface color
													</button>
												)}
											</div>
										))}
								</div>
							)}
						</div>
					);
				})}
			{message && <p role="status">{message}</p>}
		</section>
	);
}
