"use client";
import type { StreetProject } from "./domain/street-project";
import { useMemo, useState } from "react";
import { resolveStreetProperties } from "./domain/street-resolution";
export function BaselineProjectInspection({
	project,
}: {
	project: StreetProject;
}) {
	const baseline = project.baselineRevisions[project.activeBaselineRevisionId]!;
	const [query, setQuery] = useState("");
	const properties = useMemo(
		() =>
			resolveStreetProperties(project, baseline.id, project.activeScenarioId),
		[project, baseline.id],
	);
	const visibleProperties = properties.filter((property) =>
		property.target.path
			.join(" / ")
			.toLowerCase()
			.includes(query.toLowerCase()),
	);
	const originLabels: Record<string, string> = {
		source: "OSM / source value",
		inferred: "Estimate",
		observed: "Observed value",
		correction: "Accepted correction",
		authored: "Authored value",
		"legacy-authored": "Legacy authored value",
	};
	const originLabel = (kind: string) => originLabels[kind] ?? kind;
	const resolutionFor = (target: {
		featureId: string;
		path: (string | number)[];
	}) => {
		const sections = baseline.roads[target.featureId]?.data.sections as
			| Record<
					string,
					{
						values: Record<
							string,
							{ reason?: string; rawClaims?: Record<string, string> }
						>;
					}
			  >
			| undefined;
		const section = sections?.[String(target.path[1])];
		const property =
			target.path[3] === "leftSide" && target.path[4] === "sidewalkWidth"
				? "leftSidewalkWidth"
				: target.path[3] === "rightSide" && target.path[4] === "sidewalkWidth"
					? "rightSidewalkWidth"
					: String(target.path.at(-1));
		return section?.values[property];
	};

	return (
		<section
			aria-label="Baseline document"
			className="mt-3 rounded border border-border p-3 text-xs"
		>
			<p className="font-medium">Baseline document</p>
			<p>
				{Object.keys(baseline.roads).length} road components ·{" "}
				{Object.keys(baseline.features).length} inventory items ·{" "}
				{properties.length} value records
			</p>
			<p>
				Source snapshots and value origins are retained independently of the
				scene.
			</p>
			<details className="mt-2">
				<summary>Inspect baseline roads and values</summary>
				{Object.values(baseline.roads)
					.slice(0, 20)
					.map((road) => (
						<details key={road.id} className="mt-2">
							<summary>
								{road.origin} · {road.id}
							</summary>
							<pre className="max-h-48 overflow-auto whitespace-pre-wrap">
								{JSON.stringify(road.data, null, 2)}
							</pre>
						</details>
					))}
				<label>
					Find a property
					<input
						aria-label="Find baseline property"
						className="mt-2 w-full rounded border p-2"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</label>
				<p>
					{
						properties.filter(
							(property) => property.accepted.origin.kind === "inferred",
						).length
					}{" "}
					estimated properties. Select a property to inspect its evidence.
				</p>
				{visibleProperties.slice(0, 100).map((resolved) => (
					<details
						key={resolved.propertyId}
						className="mt-2 rounded border p-2"
					>
						<summary>
							{resolved.target.path.slice(-2).join(" / ")}:{" "}
							{JSON.stringify(resolved.effectiveValue)} {resolved.units ?? ""} ·{" "}
							{originLabel(resolved.accepted.origin.kind)}
							{resolved.design ? " · Scenario override" : ""}
						</summary>
						<p>Property: {resolved.target.path.join(" / ")}</p>
						<p>
							Resolution:{" "}
							{resolutionFor(resolved.target)?.reason ??
								"The accepted value follows the retained claim or explicit correction shown below."}
						</p>
						{resolutionFor(resolved.target)?.rawClaims && (
							<pre className="whitespace-pre-wrap">
								{JSON.stringify(resolutionFor(resolved.target)?.rawClaims)}
							</pre>
						)}
						<p>
							Accepted baseline: {JSON.stringify(resolved.accepted.value)} ·{" "}
							{originLabel(resolved.accepted.origin.kind)}
						</p>
						{resolved.accepted.origin.kind === "correction" && (
							<p>
								{resolved.accepted.origin.reason} · accepted{" "}
								{resolved.accepted.origin.acceptedAt}
							</p>
						)}
						{Object.values(resolved.claims).map((claim) => (
							<div key={claim.id}>
								<p>
									{originLabel(claim.origin.kind)}:{" "}
									{JSON.stringify(claim.value)}
								</p>
								<pre className="max-h-32 overflow-auto whitespace-pre-wrap">
									{JSON.stringify(claim.origin, null, 2)}
								</pre>
							</div>
						))}
						{resolved.rejectedClaims.map((rejection) => (
							<p key={rejection.claimId}>Rejected claim: {rejection.reason}</p>
						))}
						{("observationIds" in resolved.accepted.origin
							? resolved.accepted.origin.observationIds
							: []
						).map((id) => (
							<p key={id}>
								Observation: {project.observations?.[id]?.description ?? id}
							</p>
						))}
						{resolved.design && (
							<p>Scenario explanation: {resolved.design.reason}</p>
						)}
					</details>
				))}
			</details>
			<p>
				Inspector shows up to 20 roads and 100 matching properties; search or
				export the complete document.
			</p>
			<button
				type="button"
				className="mt-2 rounded border p-2"
				onClick={() => {
					const url = URL.createObjectURL(
						new Blob([JSON.stringify(project, null, 2)], {
							type: "application/json",
						}),
					);
					const link = document.createElement("a");
					link.href = url;
					link.download = "streetscape-baseline-v1.json";
					link.click();
					setTimeout(() => URL.revokeObjectURL(url), 0);
				}}
			>
				Export baseline document
			</button>
		</section>
	);
}
