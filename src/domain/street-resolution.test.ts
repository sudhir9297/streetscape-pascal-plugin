import { describe, expect, test } from "bun:test";
import { RoadNetworkNode } from "../schema";
import {
	createLegacyStreetProject,
	readResolvedCurrentRoad,
} from "../street-project-compatibility";
import {
	parseStreetProject,
	serializeStreetProject,
	type StreetProject,
} from "./street-project";
import {
	acceptStreetBaselineCorrection,
	resolveStreetFeatureData,
	resolveStreetProperty,
	setStreetScenarioOverride,
} from "./street-resolution";

const DATE = "2026-10-08T10:00:00Z";
function project(): StreetProject {
	const road = RoadNetworkNode.parse({
		id: "road-network_evidence",
		graphNodes: {
			a: { id: "a", position: [0, 0, 0] },
			b: { id: "b", position: [20, 0, 0] },
		},
		edges: {
			ab: {
				id: "ab",
				startNodeId: "a",
				endNodeId: "b",
				styleId: "local-street",
			},
		},
	});
	const value = createLegacyStreetProject({
		id: "evidence",
		name: "Evidence street",
		baselineRevisionId: "b1",
		acceptedAt: DATE,
		roads: [road],
	});
	value.sourceReferences.osm = {
		id: "osm",
		provider: "openstreetmap",
		acquiredAt: DATE,
		contentIdentity: null,
		snapshot: {
			status: "embedded",
			format: "overpass-json",
			data: {
				elements: [{ id: 10, type: "way", tags: { "sidewalk:width": "1.5" } }],
			},
		},
	};
	value.observations = {
		survey: {
			id: "survey",
			description: "Measured clear sidewalk width",
			observedAt: DATE,
			sourceReferenceId: null,
			sourceFeatureId: null,
			referenceUri: null,
		},
	};
	const baseline = value.baselineRevisions.b1!;
	baseline.sourceReferenceIds = ["osm"];
	baseline.propertyEvidence = {
		width: {
			id: "width",
			target: {
				category: "roads",
				featureId: road.id,
				path: ["stylePresets", "local-street", "sidewalkWidth"],
			},
			units: "metres",
			claims: {
				raw: {
					id: "raw",
					value: "1.5",
					origin: {
						kind: "source",
						sourceReferenceId: "osm",
						sourceFeatureId: "way/10",
					},
				},
				interpreted: {
					id: "interpreted",
					value: 1.5,
					origin: {
						kind: "inferred",
						ruleId: "osm-width",
						ruleVersion: "1",
						basisClaimIds: ["raw"],
						observationIds: [],
					},
				},
			},
			rejectedClaims: [],
			accepted: { kind: "claim", claimId: "interpreted" },
		},
	};
	value.scenarios.design = {
		id: "design",
		name: "Wider sidewalk",
		baselineRevisionId: "b1",
	};
	return parseStreetProject(value);
}
function corrected() {
	return acceptStreetBaselineCorrection(project(), {
		baselineRevisionId: "b1",
		nextBaselineRevisionId: "b2",
		propertyId: "width",
		correction: {
			kind: "correction",
			value: 1.8,
			reason: "Survey measures usable width",
			acceptedAt: DATE,
			observationIds: ["survey"],
			supersedesClaimId: "interpreted",
		},
		rejectClaim: {
			claimId: "interpreted",
			reason: "Mapped width is out of date",
		},
	});
}

describe("evidence and design semantics", () => {
	test("shows source claim, accepted correction and proposed value independently after round trip", () => {
		let value = corrected();
		value.scenarios.proposal = {
			id: "proposal",
			name: "Proposal",
			baselineRevisionId: "b2",
		};
		value = setStreetScenarioOverride(value, "proposal", "width", {
			value: 2.4,
			reason: "Improve walking space",
			authoredAt: DATE,
		});
		const resolved = resolveStreetProperty(
			parseStreetProject(serializeStreetProject(value)),
			"b2",
			"width",
			"proposal",
		);
		expect(resolved.claims.raw!.value).toBe("1.5");
		expect(resolved.claims.interpreted!.origin).toMatchObject({
			ruleId: "osm-width",
			ruleVersion: "1",
			basisClaimIds: ["raw"],
		});
		expect(resolved.rejectedClaims).toEqual([
			{ claimId: "interpreted", reason: "Mapped width is out of date" },
		]);
		expect(resolved.accepted.value).toBe(1.8);
		expect(resolved.design!.value).toBe(2.4);
		expect(resolved.effectiveValue).toBe(2.4);
		expect(resolveStreetProperty(value, "b2", "width").effectiveValue).toBe(
			1.8,
		);
		expect(
			readResolvedCurrentRoad(value, "b2", "road-network_evidence")
				.stylePresets["local-street"]!.sidewalkWidth,
		).toBe(1.8);
		expect(
			readResolvedCurrentRoad(value, "b2", "road-network_evidence", "proposal")
				.stylePresets["local-street"]!.sidewalkWidth,
		).toBe(2.4);
	});
	test("acceptance preserves historical baselines, source snapshots and scenario baseline ownership", () => {
		const original = project(),
			before = serializeStreetProject(original);
		const value = acceptStreetBaselineCorrection(original, {
			baselineRevisionId: "b1",
			nextBaselineRevisionId: "b2",
			propertyId: "width",
			correction: {
				kind: "correction",
				value: 1.8,
				reason: "Measurement",
				acceptedAt: DATE,
				observationIds: ["survey"],
				supersedesClaimId: null,
			},
		});
		expect(serializeStreetProject(original)).toBe(before);
		expect(value.baselineRevisions.b1).toEqual(original.baselineRevisions.b1);
		expect(value.sourceReferences).toEqual(original.sourceReferences);
		expect(value.baselineRevisions.b2!.parentRevisionId).toBe("b1");
		expect(value.scenarios.design!.baselineRevisionId).toBe("b1");
		expect(value.activeScenarioId).toBeNull();
		expect(value.revision).toBe(original.revision + 1);
		expect(() => resolveStreetProperty(value, "b2", "width", "design")).toThrow(
			"Scenario must reference",
		);
	});
	test("scenario writes and removal leave accepted reconstruction unchanged, including zero and null", () => {
		const original = project(),
			before = JSON.stringify(original.baselineRevisions);
		let value = setStreetScenarioOverride(original, "design", "width", {
			value: 0,
			reason: "Remove sidewalk in proposal",
			authoredAt: DATE,
		});
		expect(JSON.stringify(value.baselineRevisions)).toBe(before);
		expect(original.scenarios.design!.overrides).toBeUndefined();
		expect(
			resolveStreetProperty(value, "b1", "width", "design").effectiveValue,
		).toBe(0);
		value = setStreetScenarioOverride(value, "design", "width", {
			value: null,
			reason: "Unspecified design value",
			authoredAt: DATE,
		});
		expect(
			resolveStreetProperty(value, "b1", "width", "design").effectiveValue,
		).toBeNull();
		value = setStreetScenarioOverride(value, "design", "width", null);
		expect(
			resolveStreetProperty(value, "b1", "width", "design").effectiveValue,
		).toBe(1.5);
	});
	test("materializes detached payloads and validates incompatible designs at the host boundary", () => {
		const original = project(),
			before = serializeStreetProject(original);
		const data = resolveStreetFeatureData(
			original,
			"b1",
			"roads",
			"road-network_evidence",
		);
		data.name = "mutated";
		expect(serializeStreetProject(original)).toBe(before);
		const value = setStreetScenarioOverride(original, "design", "width", {
			value: 100,
			reason: "Impossible proposal",
			authoredAt: DATE,
		});
		expect(() =>
			readResolvedCurrentRoad(value, "b1", "road-network_evidence", "design"),
		).toThrow();
	});
	test("rejects dangling sources, observations, claims, scenarios and inference cycles", () => {
		const invalid = (edit: (value: StreetProject) => void, message: string) => {
			const value = project();
			edit(value);
			expect(() => parseStreetProject(value)).toThrow(message);
		};
		invalid((v) => {
			v.baselineRevisions.b1!.propertyEvidence!.width!.claims.raw!.origin = {
				kind: "source",
				sourceReferenceId: "missing",
				sourceFeatureId: null,
			};
		}, "Claim source");
		invalid((v) => {
			v.baselineRevisions.b1!.propertyEvidence!.width!.claims.raw!.origin = {
				kind: "observed",
				observationIds: ["missing"],
			};
		}, "Unknown observation");
		invalid((v) => {
			v.observations!.survey!.sourceReferenceId = "missing";
		}, "Observation source");
		invalid((v) => {
			v.baselineRevisions.b1!.propertyEvidence!.width!.accepted = {
				kind: "claim",
				claimId: "missing",
			};
		}, "Accepted claim");
		invalid((v) => {
			v.baselineRevisions.b1!.propertyEvidence!.width!.rejectedClaims = [
				{ claimId: "interpreted", reason: "Rejected" },
			];
		}, "rejected claim cannot");
		invalid((v) => {
			v.baselineRevisions.b1!.propertyEvidence!.width!.claims
				.interpreted!.origin = {
				kind: "inferred",
				ruleId: "r",
				ruleVersion: "1",
				basisClaimIds: ["interpreted"],
				observationIds: [],
			};
		}, "cycle");
		invalid((v) => {
			v.scenarios.design!.overrides = {
				missing: { value: 1, reason: "Design", authoredAt: DATE },
			};
		}, "requires a property");
	});
	test("rejects missing, overlapping and unsafe property targets", () => {
		const value = project();
		value.baselineRevisions.b1!.propertyEvidence!.width!.target.path = [
			"missing",
		];
		expect(() => parseStreetProject(value)).toThrow("existing data property");
		const unsafe = project();
		unsafe.baselineRevisions.b1!.propertyEvidence!.width!.target.path = [
			"__proto__",
			"polluted",
		];
		expect(() => parseStreetProject(unsafe)).toThrow("Unsafe property path");
		const overlap = project(),
			width = overlap.baselineRevisions.b1!.propertyEvidence!.width!;
		overlap.baselineRevisions.b1!.propertyEvidence!.other = {
			...structuredClone(width),
			id: "other",
			target: { ...width.target, path: ["stylePresets", "local-street"] },
		};
		expect(() => parseStreetProject(overlap)).toThrow("must not overlap");
		const records = overlap.baselineRevisions.b1!.propertyEvidence!;
		overlap.baselineRevisions.b1!.propertyEvidence = {
			other: records.other!,
			width: records.width!,
		};
		expect(() => parseStreetProject(overlap)).toThrow("must not overlap");
		records.other!.target.path = ["stylePresets", "local-street", "shoulderWidth"];
		expect(() => parseStreetProject(overlap)).not.toThrow();
	});
	test("preserves old documents and resolves properties without inventing missing evidence", () => {
		const value = project();
		delete value.observations;
		delete value.baselineRevisions.b1!.propertyEvidence;
		expect(parseStreetProject(serializeStreetProject(value))).toEqual(value);
		expect(() => resolveStreetProperty(value, "b1", "width")).toThrow(
			"Unknown baseline property",
		);
	});
	test("invalid corrections fail without changing the caller document", () => {
		const value = project(),
			before = serializeStreetProject(value);
		expect(() =>
			acceptStreetBaselineCorrection(value, {
				baselineRevisionId: "b1",
				nextBaselineRevisionId: "b2",
				propertyId: "width",
				correction: {
					kind: "correction",
					value: 1.8,
					reason: "",
					acceptedAt: DATE,
					observationIds: [],
					supersedesClaimId: null,
				},
			}),
		).toThrow();
		expect(serializeStreetProject(value)).toBe(before);
	});
});

test("saved evidence example preserves three independent values", async () => {
	const input = await Bun.file(
		new URL(
			"../../docs/fixtures/street-project-v1.evidence.json",
			import.meta.url,
		),
	).json();
	const value = parseStreetProject(input);
	const resolved = resolveStreetProperty(
		value,
		"baseline-corrected",
		"sidewalk-width",
		"walking-proposal",
	);
	expect(resolved.claims.osm!.value).toBe(1.5);
	expect(resolved.accepted.value).toBe(1.8);
	expect(resolved.design!.value).toBe(2.4);
	expect(parseStreetProject(serializeStreetProject(value))).toEqual(value);
});

test("array paths preserve typed indices and claims can be observed, authored or legacy", () => {
	const value = project();
	const property = value.baselineRevisions.b1!.propertyEvidence!.width!;
	property.target.path = ["graphNodes", "a", "position", 1];
	property.units = "metres";
	property.claims = {
		survey: {
			id: "survey",
			value: 0,
			origin: { kind: "observed", observationIds: ["survey"] },
		},
		authored: {
			id: "authored",
			value: 2,
			origin: { kind: "authored", reason: "Existing manual measurement" },
		},
		legacy: { id: "legacy", value: 3, origin: { kind: "legacy-authored" } },
	};
	property.accepted = { kind: "claim", claimId: "survey" };
	const resolved = resolveStreetProperty(value, "b1", "width");
	expect(resolved.accepted.origin).toEqual({
		kind: "observed",
		observationIds: ["survey"],
	});
	expect(
		readResolvedCurrentRoad(value, "b1", "road-network_evidence").graphNodes.a!
			.position[1],
	).toBe(0);
	property.target.path = ["graphNodes", "a", "position", "1"];
	expect(() => parseStreetProject(value)).toThrow("existing data property");
});

test("rejects invalid evidence references without treating inherited names as claims", () => {
	const value = project();
	value.baselineRevisions.b1!.propertyEvidence!.width!.accepted = {
		kind: "claim",
		claimId: "toString",
	};
	expect(() => parseStreetProject(value)).toThrow(
		"Accepted claim does not exist",
	);
	const proposal = project();
	proposal.scenarios.design!.overrides = {
		toString: { value: 1, reason: "Proposal", authoredAt: DATE },
	};
	expect(() => parseStreetProject(proposal)).toThrow("requires a property");
	expect(() =>
		setStreetScenarioOverride(project(), "design", "toString", {
			value: 1,
			reason: "Proposal",
			authoredAt: DATE,
		}),
	).toThrow("Unknown baseline property");
});

import { setStreetScenarioPropertyLock } from "./street-scenario-edits";
import { convertStreetProjectRoads } from "../street-project-compatibility";
test("legacy property locks migrate to exact section evidence identities",()=>{
 const legacy=setStreetScenarioPropertyLock(project(),"design","width",true,"Pin accepted width");
 const original=RoadNetworkNode.parse(legacy.baselineRevisions.b1!.roads["road-network_evidence"]!.data);
 const extended=RoadNetworkNode.parse({...original,graphNodes:{...original.graphNodes,c:{id:"c",position:[40,0,0]}},edges:{...original.edges,bc:{id:"bc",startNodeId:"b",endNodeId:"c",styleId:"local-street"}}});
 legacy.baselineRevisions.b1!.roads["road-network_evidence"]!.data=JSON.parse(JSON.stringify(extended));
 const converted=convertStreetProjectRoads(legacy);
 const locks=converted.scenarios.design!.propertyLocks!;
 expect(Object.keys(locks)).not.toContain("width");
 expect(Object.keys(locks)).toHaveLength(2);
 expect(readResolvedCurrentRoad(converted,"b1","road-network_evidence","design").stylePresets[readResolvedCurrentRoad(converted,"b1","road-network_evidence","design").edges.ab!.styleId]!.sidewalkWidth).toBe(1.5);
 expect(project().baselineRevisions.b1!.roads["road-network_evidence"]!.representation).toBe("pascal-road-network-v1");
});
