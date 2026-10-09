import type { OsmMovementEvidence } from "../source/osm-movement-evidence";
import { decodeStoredReport } from "../report-storage";
import { z } from "zod";
import type { NormalizedOsmSource } from "../source/osm-normalization";
import type { OsmSourceTopology } from "../source/osm-topology";
import type { StreetSectionReport } from "./street-sections";
import type { MappedInventoryReport } from "./mapped-inventory";
import type { TerrainEvidence } from "./terrain-evidence";
import type { RoadNetworkGraph } from "../road-network-topology";
import { validateRoadGraph } from "../road-network-validation";

export const BaselineDiagnosticReport = z
	.strictObject({
		format: z.literal("street-baseline-diagnostics"),
		schemaVersion: z.literal(1),
		stage: z.enum(["preview", "resolved"]),
		status: z.enum(["blocked", "review-required", "ready"]),
		items: z.array(
			z.strictObject({
				id: z.string(),
				category: z.enum([
					"source",
					"section",
					"topology",
					"association",
					"elevation",
					"policy",
				]),
				severity: z.enum(["blocking", "review", "information"]),
				targetId: z.string().nullable(),
				property: z.string().nullable(),
				code: z.string(),
				message: z.string(),
				evidence: z.json(),
			}),
		),
	})
	.superRefine((report, ctx) => {
		const expected = report.items.some((i) => i.severity === "blocking")
			? "blocked"
			: report.items.some((i) => i.severity === "review")
				? "review-required"
				: "ready";
		if (report.status !== expected)
			ctx.addIssue({
				code: "custom",
				message: "Diagnostic status must agree with its items",
			});
		if (new Set(report.items.map((i) => i.id)).size !== report.items.length)
			ctx.addIssue({
				code: "custom",
				message: "Diagnostic IDs must be unique",
			});
	});
export type BaselineDiagnosticReport = z.infer<typeof BaselineDiagnosticReport>;
export class BaselineDiagnosticError extends Error {
	constructor(public readonly report: BaselineDiagnosticReport) {
		super(
			`Imported street data was invalid: ${report.items.find((i) => i.severity === "blocking")?.message ?? "Baseline validation failed"}`,
		);
		this.name = "BaselineDiagnosticError";
	}
}
export type BaselineDiagnosticInputs = {
	normalization?: NormalizedOsmSource;
	movementEvidence?: OsmMovementEvidence;
	sourceTopology?: OsmSourceTopology;
	sectionReport?: StreetSectionReport;
	inventoryReport?: MappedInventoryReport;
	terrainEvidence?: TerrainEvidence;
	graphs?: readonly RoadNetworkGraph[];
};
export function buildBaselineDiagnosticReport(
	input: BaselineDiagnosticInputs,
	stage: "preview" | "resolved" = "resolved",
): BaselineDiagnosticReport {
	const items: BaselineDiagnosticReport["items"] = [];
	const add = (
		category: BaselineDiagnosticReport["items"][number]["category"],
		severity: BaselineDiagnosticReport["items"][number]["severity"],
		targetId: string | null,
		property: string | null,
		code: string,
		message: string,
		evidence: unknown,
	) => {
		const clean =
			evidence === undefined ? null : JSON.parse(JSON.stringify(evidence));
		items.push({
			id: JSON.stringify([
				category,
				targetId,
				property,
				code,
				items.filter(
					(i) =>
						i.category === category &&
						i.targetId === targetId &&
						i.property === property &&
						i.code === code,
				).length,
			]),
			category,
			severity,
			targetId,
			property,
			code,
			message,
			evidence: clean,
		});
	};
	for (const feature of input.normalization?.features ?? []) {
		if (feature.disposition === "rejected")
			add(
				"source",
				feature.kind === "unsupported" ? "information" : "review",
				feature.featureId,
				null,
				"rejected-input",
				"Source input was excluded from generation; its original evidence remains inspectable.",
				feature.raw,
			);
		for (const d of feature.diagnostics)
			add(
				"source",
				feature.kind === "unsupported" ? "information" : "review",
				feature.featureId,
				d.field,
				d.code,
				d.message,
				{ raw: d.raw, sourceSeverity: d.severity },
			);
	}
	for (const d of input.movementEvidence?.diagnostics ?? [])
		add("source", "review", d.featureId, "movement", d.code, d.message, d);
	for (const c of input.movementEvidence?.constraints ?? [])
		add(
			"source",
			"information",
			c.featureId,
			"movement",
			"supported-movement-constraint",
			`Supported ${c.kind} movement evidence: way ${c.fromWayId} → ${c.toWayId} via node ${c.viaNodeId}.`,
			c,
		);
	const sections = input.sectionReport;
	if (sections?.policy.status === "proposed")
		add(
			"policy",
			"blocking",
			null,
			null,
			"policy-unconfirmed",
			"Confirm the proposed regional policy before accepting this import.",
			sections.policy,
		);
	for (const section of sections?.sections ?? []) {
		for (const [property, value] of Object.entries(section.values))
			add(
				"section",
				value.origin === "estimate" ? "review" : "information",
				section.id,
				property,
				value.value === null
					? "unknown-value"
					: value.origin === "estimate"
						? "estimated-value"
						: "resolved-value",
				value.reason,
				value,
			);
		for (const message of section.diagnostics)
			add(
				"section",
				"review",
				section.id,
				null,
				"section-conflict",
				message,
				null,
			);
	}
	for (const d of input.sourceTopology?.diagnostics ?? [])
		add(
			"topology",
			"review",
			`osm~node~${d.nodeId}`,
			null,
			d.code,
			d.message,
			d,
		);
	const graphs = input.graphs ?? [];
	if (graphs.length === 0)
		add(
			"topology",
			"blocking",
			null,
			null,
			"no-accepted-roads",
			"There are no accepted road graphs to import.",
			null,
		);
	for (const graph of graphs)
		for (const d of validateRoadGraph(graph))
			add(
				"topology",
				d.severity === "error" ? "blocking" : "review",
				d.edgeId ?? d.nodeId ?? null,
				null,
				d.code,
				d.message,
				d,
			);
	for (const item of input.inventoryReport?.items ?? []) {
		const unresolved = item.status === "pending" || item.status === "unmatched";
		if (unresolved)
			add(
				"association",
				"review",
				item.id,
				null,
				"association-unresolved",
				"Mapped feature has no accepted corridor association and does not shape the road.",
				item,
			);
		for (const message of item.diagnostics)
			add(
				"association",
				unresolved ? "review" : "information",
				item.id,
				null,
				"association-evidence",
				message,
				{
					basis: item.basis,
					status: item.status,
					candidate: item.selectedCandidateId,
				},
			);
	}
	if (!input.terrainEvidence)
		add(
			"elevation",
			stage === "preview" ? "information" : "review",
			null,
			null,
			"terrain-not-resolved",
			stage === "preview"
				? "Ground coverage will be resolved during import; preview heights are provisional."
				: "Ground coverage evidence is unavailable; elevations remain estimates.",
			null,
		);
	else {
		for (const d of input.terrainEvidence.diagnostics)
			add(
				"elevation",
				"review",
				d.edgeId ?? d.sampleId,
				null,
				d.code,
				d.message,
				d,
			);
		if (input.terrainEvidence.sampling === "disabled")
			add(
				"elevation",
				"review",
				null,
				null,
				"terrain-disabled",
				"Terrain sampling was disabled; generated ground heights are estimates.",
				null,
			);
	}
	items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return BaselineDiagnosticReport.parse({
		format: "street-baseline-diagnostics",
		schemaVersion: 1,
		stage,
		status: items.some((i) => i.severity === "blocking")
			? "blocked"
			: items.some((i) => i.severity === "review")
				? "review-required"
				: "ready",
		items,
	});
}
export function parseBaselineDiagnosticReport(
	value: unknown,
): BaselineDiagnosticReport {
	return BaselineDiagnosticReport.parse(decodeStoredReport(value));
}
