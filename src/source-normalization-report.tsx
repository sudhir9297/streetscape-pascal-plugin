"use client";
import type { NormalizedOsmSource } from "./source/osm-normalization";

export function SourceNormalizationReport({
	report,
}: {
	report: NormalizedOsmSource;
}) {
	const rejected = report.features.filter(
		(feature) => feature.disposition === "rejected",
	);
	const diagnostics = report.features.flatMap((feature) => feature.diagnostics);
	const exportReport = () => {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = "streetscape-source-report-v1.json";
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	};
	return (
		<section
			aria-label="OSM source report"
			className="mt-3 rounded-lg border border-border p-3 text-xs"
		>
			<p className="font-medium">OSM source report</p>
			<p className="mt-1 text-muted-foreground">
				{report.features.length - rejected.length} accepted · {rejected.length}{" "}
				rejected · {diagnostics.length} diagnostics
			</p>
			<details className="mt-2">
				<summary className="cursor-pointer">Review source diagnostics</summary>
				<ul className="mt-2 space-y-2">
					{diagnostics.slice(0, 20).map((item, index) => (
						<li key={index}>
							<strong>
								{item.featureId} · {item.field}
							</strong>
							<br />
							{item.message}
							{item.raw !== null && (
								<pre className="mt-1 whitespace-pre-wrap break-all text-[10px]">
									{JSON.stringify(item.raw).slice(0, 500)}
								</pre>
							)}
						</li>
					))}
				</ul>
				{diagnostics.length > 20 && (
					<p className="mt-2">
						Export the source report to inspect all diagnostics.
					</p>
				)}
			</details>
			{rejected.length > 0 && (
				<details className="mt-2">
					<summary className="cursor-pointer">
						Inspect rejected source inputs
					</summary>
					{rejected.slice(0, 10).map((feature) => (
						<details key={feature.featureId} className="mt-2">
							<summary className="cursor-pointer">{feature.featureId}</summary>
							<pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px]">
								{JSON.stringify(feature.raw, null, 2)}
							</pre>
						</details>
					))}
					{rejected.length > 10 && (
						<p className="mt-2">
							Export the source report to inspect all rejected inputs.
						</p>
					)}
				</details>
			)}
			<button
				type="button"
				className="mt-2 cursor-pointer underline"
				onClick={exportReport}
			>
				Export source report
			</button>
		</section>
	);
}
