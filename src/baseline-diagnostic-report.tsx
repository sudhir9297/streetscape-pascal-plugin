"use client";
import { useState } from "react";
import type { BaselineDiagnosticReport } from "./domain/baseline-diagnostics";
export function BaselineDiagnosticInspection({
	report,
}: {
	report: BaselineDiagnosticReport;
}) {
	const blocking = report.items.filter((i) => i.severity === "blocking"),
		review = report.items.filter((i) => i.severity === "review");
	const [category, setCategory] = useState("all");
	const matching = report.items.filter(
		(item) => category === "all" || item.category === category,
	);
	return (
		<section
			aria-label="Baseline diagnostic report"
			className="mt-3 rounded-lg border border-border p-3 text-xs"
		>
			<p className="font-medium">Baseline diagnostic report</p>
			<p>
				{blocking.length} blocking errors · {review.length} review items ·{" "}
				{report.stage}
			</p>
			<p>
				{blocking.length
					? "Acceptance is blocked until the errors are resolved."
					: review.length
						? "Import is available with reviewable uncertainty. Estimates remain estimates until corrected."
						: "No unresolved baseline diagnostics."}
			</p>
			{blocking.map((item) => (
				<p className="mt-2 text-destructive" key={item.id}>
					{item.message}
				</p>
			))}
			<label>
				Inspect quality category
				<select
					aria-label="Quality category"
					value={category}
					onChange={(event) => setCategory(event.target.value)}
					className="mt-2 w-full rounded border p-2"
				>
					<option value="all">All quality issues</option>
					<option value="section">Dimensions and estimates</option>
					<option value="association">Mapped surface associations</option>
					<option value="elevation">Elevation gaps</option>
					<option value="source">Source inputs</option>
					<option value="topology">Road topology</option>
					<option value="policy">Regional policy</option>
				</select>
			</label>
			<p>{matching.length} matching diagnostics</p>
			<details className="mt-2">
				<summary>Review baseline values and problems</summary>
				{matching.slice(0, 100).map((item) => (
					<details key={item.id} className="mt-2">
						<summary>
							{item.severity} · {item.category} · {item.targetId ?? "Area"} ·{" "}
							{item.property ?? item.code}
						</summary>
						<p>{item.message}</p>
						<pre className="max-h-40 overflow-auto whitespace-pre-wrap">
							{JSON.stringify(item.evidence, null, 2)}
						</pre>
					</details>
				))}
			</details>
			<p className="mt-1">
				Showing up to 100 entries; export includes the complete report.
			</p>
			<button
				type="button"
				className="mt-2 rounded border p-1"
				onClick={() => {
					const url = URL.createObjectURL(
						new Blob([JSON.stringify(report, null, 2)], {
							type: "application/json",
						}),
					);
					const a = document.createElement("a");
					a.href = url;
					a.download = "streetscape-baseline-diagnostics-v1.json";
					a.click();
					setTimeout(() => URL.revokeObjectURL(url), 0);
				}}
			>
				Export baseline diagnostics
			</button>
		</section>
	);
}
