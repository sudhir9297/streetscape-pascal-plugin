"use client";
import { SourceRefreshInspector } from "./source-refresh-inspector";
import { ScenarioEffectiveInspector } from "./scenario-effective-inspector";
import { StreetScenarioInspector } from "./street-scenario-inspector";
import { LaneMovementInspector } from "./lane-movement-inspector";
import { SectionLayoutInspector } from "./section-layout-inspector";
import { BaselineProjectInspection } from "./baseline-project-report";
import { ImageryReferenceReview } from "./imagery-reference-review";
import { getImportOwnerSite } from "./host/imported-baseline-persistence";
import { readStreetProjectView } from "./host/street-project-persistence";
import { BaselineDiagnosticInspection } from "./baseline-diagnostic-report";
import {
	BaselineDiagnosticError,
	parseBaselineDiagnosticReport,
	type BaselineDiagnosticReport,
} from "./domain/baseline-diagnostics";
import { getPreparedBaselineDiagnostics } from "./osm-import";
import { configureOsmStreetDataSource } from "./map-data-source";
import {
	MappedInventoryInspection,
	chooseMappedAssociation,
} from "./mapped-inventory-report";
import { parseMappedInventoryReport } from "./domain/mapped-inventory";
import { StreetSectionInspection } from "./street-section-report";
import {
	parseStreetSectionReport,
	confirmStreetRegionalPolicy,
} from "./domain/street-sections";

import { SourceNormalizationReport } from "./source-normalization-report";
import {
	parseNormalizedOsmSource,
	OsmNormalizationError,
	type NormalizedOsmSource,
} from "./source/osm-normalization";
import { parseTerrainEvidence } from "./domain/terrain-evidence";

import { type AnyNodeId, emitter, useScene } from "@pascal-app/core";
import { getActiveBuildingPose, useEditor } from "@pascal-app/editor";
import { useViewer } from "@pascal-app/viewer";
import { useEffect, useRef, useState, useMemo } from "react";
import "./map-import-panel.css";
import { MapGlobeView } from "./map-globe-view";
import {
	clampMapZoom,
	DEFAULT_MAP_ZOOM,
	GLOBE_FLAT_THRESHOLD_ZOOM,
} from "./map-tiles";
import { type GeocodeResult, searchPlaces } from "./osm-geocode";
import type { GeoPoint } from "./osm-elevation";
import {
	completeOsmStreetImport,
	DEFAULT_IMPORT_RADIUS_M,
	getPreparedOsmStreetImportResult,
	MAX_IMPORT_RADIUS_M,
	MIN_IMPORT_RADIUS_M,
	prepareOsmStreetImport,
	type OsmImportPhase,
	type OsmImportResult,
	type PreparedOsmImport,
} from "./osm-import";
import {
	reviewOsmImport,
	type OsmImportReview,
} from "./osm-import-deduplication";
import {
	getImportedStreetFocus,
	getOsmImportSceneContext,
	placeOsmImport,
	captureOsmImportPreconditions,
} from "./osm-import-placement";
import {
	countOsmPointAssets,
	type OsmPointAssetCounts,
} from "./osm-point-assets";

const SECONDARY_BUTTON_CLASS =
	"map-button cursor-pointer disabled:active:scale-100";
const PRIMARY_BUTTON_CLASS =
	"map-button-primary cursor-pointer disabled:active:scale-100";

const PHASE_LABELS: Record<OsmImportPhase, string> = {
	streets: "Fetching streets and mapped objects",
	building: "Building road network",
};

/** Street-level zoom so a searched place lands in the flat map, not the globe. */
const PLACE_ZOOM = 15;

const MAP_DIALOG_LAYOUT_CSS = `
.streetscape-map-dialog:not([open]){display:none}
.streetscape-map-dialog[open]{display:block;position:fixed;left:50%;top:50%;inset:auto;width:min(1120px,calc(100vw - 2rem));height:min(820px,calc(100dvh - 2rem));margin:0;transform:translate(-50%,-50%);overflow:hidden;box-sizing:border-box}
.streetscape-map-dialog>div{display:flex!important;flex-direction:column!important;height:100%!important;min-height:0!important}
.streetscape-map-dialog header{display:flex!important;align-items:center;gap:12px;flex:0 0 auto}
.streetscape-map-dialog header form{display:flex!important;flex:1 1 auto;min-width:0;gap:10px}
.streetscape-map-dialog .map-workspace{display:grid!important;grid-template-columns:minmax(0,1fr) 300px!important;flex:1 1 auto;min-height:0;overflow:hidden}
.streetscape-map-dialog .map-workspace>div:first-child{display:flex!important;flex-direction:column!important;gap:12px;min-width:0;min-height:0;height:100%}
.streetscape-map-dialog .map-sidebar{display:flex!important;flex-direction:column!important;min-width:0;min-height:0;overflow:hidden}
.streetscape-map-dialog .map-sidebar-content{display:flex;flex-direction:column;gap:20px;flex:1;min-height:0;overflow-y:auto}
.streetscape-map-dialog .map-import-actions{flex-shrink:0;background:var(--background)}
@media(max-width:760px){.streetscape-map-dialog[open]{width:calc(100vw - 24px)!important;height:calc(100dvh - 24px)!important}.streetscape-map-dialog .map-workspace{display:flex!important;flex-direction:column;overflow-y:auto!important}.streetscape-map-dialog .map-workspace>div:first-child{height:360px!important;flex:0 0 360px}.streetscape-map-dialog .map-sidebar{flex:0 0 auto;max-height:none;overflow:visible!important}.streetscape-map-dialog .map-sidebar-content{overflow:visible;flex:0 0 auto}}
`;

/** Choose a street-level zoom that keeps the complete import circle visible. */
function fitZoomForRadius(centerLat: number, radiusMeters: number): number {
	const earthCircumferenceMeters = 40_075_016.686;
	const targetDiameterPixels = 210;
	const latitudeScale = Math.max(0.15, Math.cos((centerLat * Math.PI) / 180));
	const zoom = Math.log2(
		(earthCircumferenceMeters * latitudeScale * targetDiameterPixels) /
			(512 * 2 * Math.max(1, radiusMeters)),
	);
	return clampMapZoom(zoom);
}

type Status = { kind: "success" | "error" | "info"; message: string };
type BusyState = "search" | "preview" | OsmImportPhase;

function isCancelled(error: unknown, signal: AbortSignal): boolean {
	return (
		signal.aborted ||
		(error instanceof DOMException && error.name === "AbortError")
	);
}

function roadSegmentLabel(count: number): string {
	return `${count} street segment${count === 1 ? "" : "s"}`;
}

function newRoadSegmentLabel(count: number): string {
	return `${count} new street segment${count === 1 ? "" : "s"}`;
}

function mappedObjectLabel(count: number): string {
	return `${count} mapped object${count === 1 ? "" : "s"}`;
}

function importSelectionLabel(segments: number, objects: number): string {
	return `Accept ${[
		segments > 0 ? roadSegmentLabel(segments) : "",
		objects > 0 ? mappedObjectLabel(objects) : "",
	]
		.filter(Boolean)
		.join(" + ")}`;
}

function mappedObjectSummary(counts: OsmPointAssetCounts): string {
	return [
		counts.streetLamps > 0
			? `${counts.streetLamps} lamp${counts.streetLamps === 1 ? "" : "s"}`
			: "",
		counts.trafficSignals > 0
			? `${counts.trafficSignals} traffic signal${counts.trafficSignals === 1 ? "" : "s"}`
			: "",
		counts.roadSigns > 0
			? `${counts.roadSigns} sign${counts.roadSigns === 1 ? "" : "s"}`
			: "",
	]
		.filter(Boolean)
		.join(", ");
}

function fitOpenFloorplanToWidth(viewWidth: number) {
	const floorplan = document.querySelector<SVGSVGElement>(
		'svg[data-pascal-floorplan-2d="true"]',
	);
	if (!floorplan) return;

	const currentWidth = Number(
		floorplan.getAttribute("viewBox")?.split(/\s+/)[2],
	);
	if (!(Number.isFinite(currentWidth) && currentWidth > 0)) return;

	const widthFactor = viewWidth / currentWidth;
	if (!(Number.isFinite(widthFactor) && widthFactor > 0)) return;
	if (Math.abs(widthFactor - 1) < 0.01) return;

	const rect = floorplan.getBoundingClientRect();
	floorplan.dispatchEvent(
		new WheelEvent("wheel", {
			bubbles: true,
			cancelable: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			deltaY: Math.log(widthFactor) / 0.0015,
		}),
	);
}

function focusImportedStreetNetworks(
	result: OsmImportResult,
	ids: AnyNodeId[],
) {
	const editor = useEditor.getState();
	const focus = getImportedStreetFocus(result, getActiveBuildingPose());

	editor.setMode("select");
	useViewer.getState().setSelection({ selectedIds: ids });
	if (!focus) {
		editor.setViewMode("2d");
		return;
	}

	// Let the host camera perform its supported fit animation first. Once it
	// settles, open the floorplan, use its north-up action, and feed its native
	// wheel handler the exact scale required for the imported street bounds.
	emitter.emit("camera-controls:fit-scene", {
		bounds: {
			center: focus.center,
			max: focus.max,
			min: focus.min,
			size: focus.size,
		},
	});
	window.setTimeout(() => {
		useEditor.getState().setViewMode("2d");
		window.setTimeout(() => {
			document
				.querySelector<HTMLButtonElement>(
					'button[aria-label="Align view to north"]',
				)
				?.click();
			window.setTimeout(() => fitOpenFloorplanToWidth(focus.viewWidth), 400);
		}, 50);
	}, 450);
}

type MapImportDialogProps = {
	activeLevelId: AnyNodeId | null;
	onImported: (review: OsmImportReview) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
};

function MapImportDialog({
	activeLevelId,
	onImported,
	onOpenChange,
	open,
}: MapImportDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const importActionRef = useRef<HTMLDivElement>(null);
	const activeRequestRef = useRef<AbortController | null>(null);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<GeocodeResult[]>([]);
	const [center, setCenter] = useState<GeoPoint>({ lat: 20, lon: 0 });
	const [zoom, setZoom] = useState(DEFAULT_MAP_ZOOM);
	const [radius, setRadius] = useState(DEFAULT_IMPORT_RADIUS_M);
	const [dataSource, setDataSource] = useState<"overpass" | "osm-api">(
		"osm-api",
	);
	useEffect(() => configureOsmStreetDataSource(dataSource), [dataSource]);
	const [sourceReport, setSourceReport] = useState<NormalizedOsmSource | null>(
		null,
	);
	const [failedBaselineDiagnostics, setFailedBaselineDiagnostics] =
		useState<BaselineDiagnosticReport | null>(null);
	const [loadedBaseline, setLoadedBaseline] = useState<OsmImportResult | null>(
		null,
	);
	const acceptancePreconditions = useRef<ReturnType<
		typeof captureOsmImportPreconditions
	> | null>(null);
	const [prepared, setPrepared] = useState<PreparedOsmImport | null>(null);
	const baselineDiagnostics = useMemo(
		() =>
			loadedBaseline?.baselineDiagnostics ??
			(prepared
				? getPreparedBaselineDiagnostics(prepared)
				: failedBaselineDiagnostics),
		[loadedBaseline, prepared, failedBaselineDiagnostics],
	);
	const [review, setReview] = useState<OsmImportReview | null>(null);
	const [busy, setBusy] = useState<BusyState | null>(null);
	const [locating, setLocating] = useState(false);
	const [resolveBaseline, setResolveBaseline] = useState(true);
	const [status, setStatus] = useState<Status | null>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open) {
			activeRequestRef.current?.abort();
			if (dialog.open) dialog.close();
		}
	}, [open]);

	useEffect(() => () => activeRequestRef.current?.abort(), []);
	useEffect(() => {
		if (prepared && !busy && open)
			importActionRef.current?.scrollIntoView({ block: "nearest" });
	}, [prepared, busy, open]);

	const close = () => {
		activeRequestRef.current?.abort();
		setLoadedBaseline(null);
		acceptancePreconditions.current = null;
		onOpenChange(false);
	};

	const cancelRequest = () => {
		if (!activeRequestRef.current) return;
		activeRequestRef.current.abort();
		setStatus({ kind: "info", message: "Request cancelled." });
	};

	const recenter = (next: GeoPoint) => {
		setCenter(next);
		setLoadedBaseline(null);
		setPrepared(null);
		setSourceReport(null);
		setFailedBaselineDiagnostics(null);
		setReview(null);
		setStatus(null);
	};

	const changeRadius = (next: number) => {
		setRadius(next);
		setZoom(fitZoomForRadius(center.lat, next));
		setLoadedBaseline(null);
		setPrepared(null);
		setSourceReport(null);
		setFailedBaselineDiagnostics(null);
		setReview(null);
		setStatus(null);
	};

	const selectPlace = (place: GeocodeResult, keepResults = false) => {
		const nextCenter = { lat: place.lat, lon: place.lon };
		recenter(nextCenter);
		setZoom(Math.max(fitZoomForRadius(nextCenter.lat, radius), PLACE_ZOOM - 1));
		if (!keepResults) setResults([]);
		setQuery(place.label);
	};

	const useMyLocation = () => {
		if (!navigator.geolocation || busy || locating) return;
		setLocating(true);
		setStatus(null);
		navigator.geolocation.getCurrentPosition(
			(position) => {
				const nextCenter = {
					lat: position.coords.latitude,
					lon: position.coords.longitude,
				};
				recenter(nextCenter);
				setResults([]);
				setQuery("");
				setZoom(fitZoomForRadius(nextCenter.lat, radius));
				setLocating(false);
			},
			(error) => {
				setLocating(false);
				setStatus({
					kind: "error",
					message:
						error.code === error.PERMISSION_DENIED
							? "Location access was denied. Allow it in your browser settings to use this option."
							: "Your current location could not be determined.",
				});
			},
			{ enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
		);
	};

	const runSearch = async () => {
		if (!query.trim() || busy) return;
		const controller = new AbortController();
		activeRequestRef.current = controller;
		setBusy("search");
		setStatus(null);
		try {
			const places = await searchPlaces(query, { signal: controller.signal });
			if (activeRequestRef.current !== controller) return;
			setResults(places);
			const first = places[0];
			if (first) selectPlace(first, true);
			else
				setStatus({ kind: "error", message: "No places matched that search." });
		} catch (error) {
			if (activeRequestRef.current !== controller) return;
			setResults([]);
			setStatus(
				isCancelled(error, controller.signal)
					? { kind: "info", message: "Request cancelled." }
					: {
							kind: "error",
							message:
								error instanceof Error ? error.message : "Place search failed.",
						},
			);
		} finally {
			if (activeRequestRef.current === controller) {
				activeRequestRef.current = null;
				setBusy(null);
			}
		}
	};

	const runImport = async () => {
		if (
			!activeLevelId ||
			!prepared ||
			baselineDiagnostics?.status === "blocked" ||
			prepared.regionalPolicy.status !== "confirmed" ||
			busy
		)
			return;
		const controller = new AbortController();
		activeRequestRef.current = controller;
		setStatus(null);
		try {
			const expected = captureOsmImportPreconditions(activeLevelId);
			const result = await completeOsmStreetImport(prepared, {
				onPhase: setBusy,
				signal: controller.signal,
			});
			if (activeRequestRef.current !== controller) return;
			controller.signal.throwIfAborted();
			const finalReview = reviewOsmImport(
				result,
				getOsmImportSceneContext(activeLevelId),
			);
			if (
				finalReview.result.graphs.length === 0 &&
				finalReview.result.assets.length === 0
			) {
				setLoadedBaseline(null);
				setPrepared(null);
				setReview(null);
				setStatus({
					kind: "info",
					message:
						"Nothing was imported because every street and mapped object is already in this level.",
				});
				return;
			}
			acceptancePreconditions.current = expected;
			setLoadedBaseline(result);
			setReview(finalReview);
			setStatus({
				kind: "success",
				message:
					"Baseline ready for review. No roads have been added. Review source coverage and selected streets, then accept into the project.",
			});
		} catch (error) {
			if (activeRequestRef.current !== controller) return;
			setStatus(
				isCancelled(error, controller.signal)
					? { kind: "info", message: "Request cancelled." }
					: {
							kind: "error",
							message:
								error instanceof Error
									? error.message
									: "Street import failed.",
						},
			);
		} finally {
			if (activeRequestRef.current === controller) {
				activeRequestRef.current = null;
				setBusy(null);
			}
		}
	};

	const acceptBaseline = () => {
		if (
			!activeLevelId ||
			!loadedBaseline ||
			!acceptancePreconditions.current ||
			baselineDiagnostics?.status === "blocked" ||
			busy
		)
			return;
		try {
			const finalReview = reviewOsmImport(
				loadedBaseline,
				getOsmImportSceneContext(activeLevelId),
			);
			const ids = placeOsmImport(
				finalReview.result,
				activeLevelId,
				finalReview.origin,
				{ resolveBaseline, expected: acceptancePreconditions.current },
			);
			setLoadedBaseline(null);
			setPrepared(null);
			setReview(null);
			acceptancePreconditions.current = null;
			onImported(finalReview);
			onOpenChange(false);
			focusImportedStreetNetworks(finalReview.result, ids);
		} catch (error) {
			setStatus({
				kind: "error",
				message:
					error instanceof Error
						? error.message
						: "Baseline acceptance failed.",
			});
		}
	};

	const runPreview = async () => {
		if (busy) return;
		const controller = new AbortController();
		activeRequestRef.current = controller;
		setBusy("preview");
		setStatus(null);
		setSourceReport(null);
		setFailedBaselineDiagnostics(null);
		try {
			const next = await prepareOsmStreetImport(center, radius, {
				signal: controller.signal,
			});
			if (activeRequestRef.current !== controller) return;
			const nextReview = reviewOsmImport(
				getPreparedOsmStreetImportResult(next),
				activeLevelId
					? getOsmImportSceneContext(activeLevelId)
					: { featureSourceIds: new Set(), networks: [] },
			);
			setPrepared(next);
			setSourceReport(next.normalization);
			setReview(nextReview);
			const overlapNote =
				nextReview.duplicateSegments > 0
					? ` ${roadSegmentLabel(nextReview.duplicateSegments)} already in the editor will be skipped.`
					: "";
			const trimNote =
				nextReview.trimmedSegments > 0
					? ` ${roadSegmentLabel(nextReview.trimmedSegments)} will be trimmed where they overlap.`
					: "";
			const assetCounts = countOsmPointAssets(nextReview.result.assets);
			const assetSummary = mappedObjectSummary(assetCounts);
			const assetNote = assetSummary ? ` Also found ${assetSummary}.` : "";
			const duplicateAssetNote =
				nextReview.duplicateAssets > 0
					? ` ${mappedObjectLabel(nextReview.duplicateAssets)} already present will be skipped.`
					: "";
			setStatus({
				kind:
					nextReview.newSegments > 0 || nextReview.newAssets > 0
						? "success"
						: "info",
				message:
					nextReview.newSegments > 0 || nextReview.newAssets > 0
						? `Preview ready: ${newRoadSegmentLabel(nextReview.newSegments)} from ${next.preview.wayCount} mapped way${next.preview.wayCount === 1 ? "" : "s"}.${assetNote}${overlapNote}${trimNote}${duplicateAssetNote}`
						: `All ${roadSegmentLabel(nextReview.incomingSegments)} and ${mappedObjectLabel(nextReview.incomingAssets)} are already in this level. Nothing new to import.`,
			});
		} catch (error) {
			if (activeRequestRef.current !== controller) return;
			setLoadedBaseline(null);
			setPrepared(null);
			setFailedBaselineDiagnostics(
				error instanceof BaselineDiagnosticError ? error.report : null,
			);
			setSourceReport(
				error instanceof OsmNormalizationError ? error.normalization : null,
			);
			setReview(null);
			setStatus(
				isCancelled(error, controller.signal)
					? { kind: "info", message: "Request cancelled." }
					: {
							kind: "error",
							message:
								error instanceof Error
									? error.message
									: "Street preview failed.",
						},
			);
		} finally {
			if (activeRequestRef.current === controller) {
				activeRequestRef.current = null;
				setBusy(null);
			}
		}
	};

	const importing = busy !== null && busy !== "search" && busy !== "preview";
	const modeLabel = zoom < GLOBE_FLAT_THRESHOLD_ZOOM ? "Globe" : "Map";

	return (
		<dialog
			aria-label="Import streets from map"
			className="streetscape-map-dialog m-auto h-[min(820px,calc(100dvh-2rem))] w-[min(1120px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/60"
			style={{
				height: "min(820px, calc(100dvh - 2rem))",
				width: "min(1120px, calc(100vw - 2rem))",
				left: "50%",
				margin: 0,
				position: "fixed",
				top: "50%",
				transform: "translate(-50%, -50%)",
			}}
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
			onClose={() => onOpenChange(false)}
			ref={dialogRef}
		>
			<style dangerouslySetInnerHTML={{ __html: MAP_DIALOG_LAYOUT_CSS }} />
			<div className="flex h-full min-h-0 flex-col" style={{ height: "100%" }}>
				<header className="flex items-center gap-3 border-border border-b px-5 py-3">
					<form
						className="flex min-w-0 flex-1 gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void runSearch();
						}}
					>
						<input
							autoFocus
							className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
							disabled={busy !== null}
							onChange={(event) => setQuery(event.target.value)}
							aria-label="Search a place or paste latitude, longitude"
							placeholder="Search a place or paste latitude, longitude"
							type="search"
							value={query}
						/>
						<button
							className={SECONDARY_BUTTON_CLASS}
							disabled={!query.trim() || busy !== null}
							type="submit"
						>
							{busy === "search" ? "Searching…" : "Search"}
						</button>
					</form>
					<button
						aria-label="Close map import"
						className="map-close grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground text-xl leading-none transition-[background-color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40"
						onClick={close}
						type="button"
					>
						<span aria-hidden>×</span>
					</button>
				</header>

				<nav
					aria-label="Street import progress"
					className="border-b px-5 py-2 text-xs"
				>
					<ol className="map-progress">
						{[
							"Select area",
							"Load sources",
							"Review baseline",
							"Accept into project",
						].map((label, index) => (
							<li
								key={label}
								aria-current={
									index === (loadedBaseline ? 3 : prepared ? 2 : busy === "preview" ? 1 : 0)
										? "step"
										: undefined
								}
							>
								{index + 1}. {label}
							</li>
						))}
					</ol>
				</nav>

				<div
					className="map-workspace grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_300px] md:overflow-hidden"
					style={{
						gridTemplateColumns: "minmax(0, 1fr) 300px",
						overflow: "hidden",
					}}
				>
					<div
						className="flex min-w-0 min-h-[320px] flex-col gap-3 border-border p-4 md:min-h-0 md:border-r"
						style={{ minHeight: 0, height: "100%" }}
					>
						{results.length > 1 && (
							<div className="grid max-h-28 gap-1 overflow-y-auto rounded-md border border-border bg-background p-1">
								{results.map((result, index) => (
									<button
										className="cursor-pointer truncate rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
										key={`${result.lat}:${result.lon}:${index}`}
										onClick={() => selectPlace(result)}
										title={result.label}
										type="button"
									>
										{result.label}
									</button>
								))}
							</div>
						)}

						<MapGlobeView
							center={center}
							className="min-h-[280px] flex-1"
							disabled={busy !== null}
							onCenterChange={recenter}
							onZoomChange={setZoom}
							radiusMeters={radius}
							streetPreview={prepared?.preview}
							style={{ minHeight: 320, height: "100%", flex: 1 }}
							zoom={zoom}
						/>
					</div>

					<aside className="map-sidebar flex min-w-0 min-h-0 flex-col gap-5 overflow-hidden p-5">
						<div className="map-sidebar-content">
							<section>
								<p className="font-medium text-sm">Selected location</p>
								<p className="mt-1 font-mono text-muted-foreground text-xs">
									{center.lat.toFixed(5)}, {center.lon.toFixed(5)}
								</p>
								<p className="mt-1 text-muted-foreground text-xs">
									{modeLabel} view
								</p>
							</section>
							<button
								className={`${SECONDARY_BUTTON_CLASS} w-full`}
								disabled={
									busy !== null ||
									locating ||
									typeof navigator === "undefined" ||
									!navigator.geolocation
								}
								onClick={useMyLocation}
								type="button"
							>
								{locating ? "Finding your location…" : "Use my location"}
							</button>

							<div className="grid grid-cols-2 gap-2">
								<button
									aria-label="Zoom out"
									className={SECONDARY_BUTTON_CLASS}
									disabled={busy !== null}
									onClick={() => setZoom(clampMapZoom(zoom - 1))}
									type="button"
								>
									− Zoom out
								</button>
								<button
									aria-label="Zoom in"
									className={SECONDARY_BUTTON_CLASS}
									disabled={busy !== null}
									onClick={() => setZoom(clampMapZoom(zoom + 1))}
									type="button"
								>
									+ Zoom in
								</button>
							</div>
							<button
								className={`${SECONDARY_BUTTON_CLASS} w-full`}
								disabled={busy !== null}
								onClick={() => setZoom(fitZoomForRadius(center.lat, radius))}
								type="button"
							>
								Fit import radius
							</button>

							<div
								className={`map-radius-control ${busy ? "pointer-events-none opacity-50" : ""}`}
							>
								<div className="map-radius-heading">
									<label htmlFor="streetscape-import-radius">
										Import radius
									</label>
									<output htmlFor="streetscape-import-radius">
										{radius} m
									</output>
								</div>
								<input
									aria-label="Import radius"
									id="streetscape-import-radius"
									disabled={busy !== null}
									max={MAX_IMPORT_RADIUS_M}
									min={MIN_IMPORT_RADIUS_M}
									onChange={(event) => changeRadius(Number(event.target.value))}
									step={25}
									type="range"
									value={radius}
								/>
								<div className="map-radius-scale" aria-hidden="true">
									<span>{MIN_IMPORT_RADIUS_M} m</span>
									<span>{MAX_IMPORT_RADIUS_M} m</span>
								</div>
							</div>

							<label className="mt-3 block text-xs">
								Street data source
								<select
									aria-label="Street data source"
									className="mt-1 w-full rounded border bg-background p-2"
									disabled={busy !== null}
									value={dataSource}
									onChange={(e) => {
										const source = e.target.value as "overpass" | "osm-api";
										configureOsmStreetDataSource(source);
										setDataSource(source);
										setLoadedBaseline(null);
										setPrepared(null);
										setReview(null);
										setSourceReport(null);
										setFailedBaselineDiagnostics(null);
									}}
								>
									<option value="osm-api">
										OpenStreetMap API (small area)
									</option>
									<option value="overpass">
										Overpass (filtered street data)
									</option>
								</select>
							</label>
							<p className="text-xs text-muted-foreground">
								If one service is unavailable, select the other and preview
								again. The map and place search work independently.
							</p>
							{sourceReport && (
								<SourceNormalizationReport report={sourceReport} />
							)}
							{baselineDiagnostics && (
								<BaselineDiagnosticInspection report={baselineDiagnostics} />
							)}
							{prepared && (
								<MappedInventoryInspection
									report={prepared.inventoryReport}
									onChoose={(id, candidate) => {
										const next = chooseMappedAssociation(
											prepared.inventoryReport,
											prepared.associationChoices ?? {},
											id,
											candidate,
										);
										setLoadedBaseline(null);
										setPrepared({
											...prepared,
											associationChoices: next.choices,
											inventoryReport: next.report,
										});
									}}
								/>
							)}
							{prepared && (
								<StreetSectionInspection report={prepared.sectionReport} />
							)}
							{loadedBaseline && (
								<section
									aria-label="Baseline source coverage"
									className="map-card rounded border p-3 text-xs"
								>
									<h3>Review baseline before acceptance</h3>
									<p>
										Selected area: {center.lat.toFixed(5)},{" "}
										{center.lon.toFixed(5)} · {radius} m radius.
									</p>
									<p>
										OSM: {prepared?.preview.wayCount ?? 0} mapped ways,{" "}
										{review?.newSegments ?? 0} selected street segments,{" "}
										{review?.newAssets ?? 0} mapped objects.
									</p>
									<p>
										Elevation:{" "}
										{loadedBaseline.terrainEvidence?.samples.filter(
											(sample) => sample.elevationMeters !== null,
										).length ?? 0}{" "}
										of {loadedBaseline.terrainEvidence?.samples.length ?? 0}{" "}
										samples available. Missing coverage remains an estimate.
									</p>
									<p>
										No streets have been placed. Acceptance adds this baseline
										in one undoable change.
									</p>
								</section>
							)}
							{prepared && review && (
								<section
									className="map-card rounded-lg border border-border bg-muted/35 p-3"
									aria-label="Import data summary"
								>
									<p className="font-medium text-sm">Import summary</p>
									<div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
										<div className="flex justify-between gap-2">
											<span className="text-muted-foreground">Mapped ways</span>
											<span className="font-medium">
												{prepared.preview.wayCount}
											</span>
										</div>
										<div className="flex justify-between gap-2">
											<span className="text-muted-foreground">
												Street segments
											</span>
											<span className="font-medium">
												{review.newSegments} new
											</span>
										</div>
										<div className="flex justify-between gap-2">
											<span className="text-muted-foreground">
												Mapped objects
											</span>
											<span className="font-medium">
												{review.newAssets} new
											</span>
										</div>
										<div className="flex justify-between gap-2">
											<span className="text-muted-foreground">
												Import radius
											</span>
											<span className="font-medium">{radius} m</span>
										</div>
									</div>
									{(review.duplicateSegments > 0 ||
										review.duplicateAssets > 0 ||
										review.trimmedSegments > 0) && (
										<p className="mt-2 border-border border-t pt-2 text-muted-foreground text-[11px] leading-relaxed">
											{review.duplicateSegments > 0 &&
												`${review.duplicateSegments} duplicate segment${review.duplicateSegments === 1 ? "" : "s"} skipped. `}
											{review.duplicateAssets > 0 &&
												`${review.duplicateAssets} duplicate object${review.duplicateAssets === 1 ? "" : "s"} skipped. `}
											{review.trimmedSegments > 0 &&
												`${review.trimmedSegments} segment${review.trimmedSegments === 1 ? "" : "s"} clipped to the import boundary.`}
										</p>
									)}
								</section>
							)}

							<div className="map-card rounded-lg border border-border bg-muted/35 p-3 text-muted-foreground text-xs leading-relaxed">
								Solid streets and colored objects will be imported inside the
								selected area. Dashed streets provide surrounding junction
								context and will not be placed. Yellow, red, and blue dots
								preview lamps, traffic signals, and signs. The first import sets
								this level's map origin; later areas line up with it. Available
								terrain and mapped elevations shape the imported road profiles.
							</div>

							{!activeLevelId && (
								<p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-700 text-xs dark:text-amber-300">
									Open a level before importing streets.
								</p>
							)}

							{status && (
								<p
									className={`rounded-lg border p-3 text-xs leading-relaxed ${
										status.kind === "error"
											? "border-destructive/30 bg-destructive/10 text-destructive"
											: status.kind === "success"
												? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
												: "border-border bg-muted/50 text-muted-foreground"
									}`}
									role="status"
								>
									{status.message}
								</p>
							)}
						</div>
						<div
							ref={importActionRef}
							className="map-import-actions border-border border-t pt-4"
						>
							<label className="mb-3 flex gap-2 text-xs">
								<input
									type="checkbox"
									aria-label="Keep inspectable baseline"
									checked={resolveBaseline}
									disabled={busy !== null}
									onChange={(event) => setResolveBaseline(event.target.checked)}
								/>
								Keep an inspectable baseline
							</label>
							{prepared && (
								<section
									aria-label="Import driving side"
									className="mb-3 rounded border border-border p-3 text-xs"
								>
									<p className="font-medium">
										{prepared.regionalPolicy.status === "confirmed"
											? `Driving side confirmed: ${prepared.regionalPolicy.id === "left-driving" ? "left" : "right"}.`
											: "Choose the driving side to enable import."}
									</p>
									<div className="mt-2 flex gap-2">
										{(["left-driving", "right-driving"] as const).map((id) => (
											<button
												key={id}
												type="button"
												disabled={busy !== null}
												aria-pressed={
													prepared.regionalPolicy.status === "confirmed" &&
													prepared.regionalPolicy.id === id
												}
												className="rounded border p-2"
												onClick={() => {
													const policy = confirmStreetRegionalPolicy(
														prepared.regionalPolicy,
														id,
													);
													setLoadedBaseline(null);
													setPrepared({
														...prepared,
														regionalPolicy: policy,
														sectionReport: {
															...prepared.sectionReport,
															policy,
														},
													});
												}}
											>
												{id === "left-driving" ? "Drive on left" : "Drive on right"}
											</button>
										))}
									</div>
								</section>
							)}
							<button
								className={`${PRIMARY_BUTTON_CLASS} w-full`}
								disabled={
									!busy &&
									prepared !== null &&
									(baselineDiagnostics?.status === "blocked" ||
										prepared.regionalPolicy.status !== "confirmed" ||
										!activeLevelId ||
										(review?.newSegments === 0 && review.newAssets === 0))
								}
								onClick={() =>
									busy
										? cancelRequest()
										: prepared
											? loadedBaseline
												? acceptBaseline()
												: void runImport()
											: void runPreview()
								}
								type="button"
							>
								{busy === "search"
									? "Cancel search"
									: busy === "preview"
										? "Cancel · Fetching street preview…"
										: importing
											? `Cancel · ${PHASE_LABELS[busy as OsmImportPhase]}…`
											: prepared
												? review?.newSegments === 0 && review.newAssets === 0
													? "Nothing new to import"
													: loadedBaseline
														? importSelectionLabel(
																review?.newSegments ??
																	prepared.preview.segmentCount,
																review?.newAssets ?? 0,
															)
														: "Load baseline for review"
												: "Preview streets and objects"}
							</button>
							<p className="mt-2 text-center text-[11px] text-muted-foreground">
								One import creates one undoable editor change.
							</p>
						</div>
					</aside>
				</div>
			</div>
		</dialog>
	);
}

export function MapImportSection() {
	const activeLevelId = useViewer(
		(state) => state.selection.levelId,
	) as AnyNodeId | null;
	const [open, setOpen] = useState(false);
	const [importSuccess, setImportSuccess] = useState<string | null>(null);
	const nodes = useScene((state) => state.nodes);
	const terrainReport = useMemo(() => {
		const candidate = Object.values(nodes)
			.reverse()
			.find(
				(node) =>
					node.parentId === activeLevelId &&
					node.metadata &&
					typeof node.metadata === "object" &&
					"osmTerrainEvidence" in node.metadata,
			);
		const metadata = candidate?.metadata;
		try {
			return parseTerrainEvidence(
				metadata &&
					typeof metadata === "object" &&
					"osmTerrainEvidence" in metadata
					? metadata.osmTerrainEvidence
					: null,
			);
		} catch {
			return null;
		}
	}, [nodes, activeLevelId]);
	const savedSourceReport = useMemo(() => {
		const candidate = Object.values(nodes)
			.reverse()
			.find(
				(node) =>
					node.parentId === activeLevelId &&
					node.metadata &&
					typeof node.metadata === "object" &&
					"osmNormalizationReport" in node.metadata,
			);
		try {
			return parseNormalizedOsmSource(
				candidate?.metadata &&
					typeof candidate.metadata === "object" &&
					"osmNormalizationReport" in candidate.metadata
					? candidate.metadata.osmNormalizationReport
					: null,
			);
		} catch {
			return null;
		}
	}, [nodes, activeLevelId]);
	const reportMessages = [
		...new Set(terrainReport?.diagnostics.map((item) => item.message) ?? []),
	];

	const savedSectionReport = useMemo(() => {
		const candidate = Object.values(nodes)
			.reverse()
			.find(
				(n) =>
					n.parentId === activeLevelId &&
					n.metadata &&
					typeof n.metadata === "object" &&
					"osmSectionReport" in n.metadata,
			);
		try {
			return parseStreetSectionReport(candidate?.metadata?.osmSectionReport);
		} catch {
			return null;
		}
	}, [nodes, activeLevelId]);

	const savedInventoryReport = useMemo(() => {
		const candidate = Object.values(nodes)
			.reverse()
			.find(
				(n) =>
					n.parentId === activeLevelId &&
					n.metadata &&
					typeof n.metadata === "object" &&
					"osmInventoryReport" in n.metadata,
			);
		try {
			return parseMappedInventoryReport(
				candidate?.metadata?.osmInventoryReport,
			);
		} catch {
			return null;
		}
	}, [nodes, activeLevelId]);

	const savedBaselineDiagnostics = useMemo(() => {
		const candidate = Object.values(nodes)
			.reverse()
			.find(
				(n) =>
					n.parentId === activeLevelId &&
					n.metadata &&
					typeof n.metadata === "object" &&
					"osmBaselineDiagnostics" in n.metadata,
			);
		try {
			return parseBaselineDiagnosticReport(
				candidate?.metadata?.osmBaselineDiagnostics,
			);
		} catch {
			return null;
		}
	}, [nodes, activeLevelId]);

	const savedProject = useMemo(() => {
		if (!activeLevelId) return null;
		try {
			const state = useScene.getState(),
				siteId = getImportOwnerSite(state, activeLevelId);
			return (
				readStreetProjectView(state.nodes[siteId as AnyNodeId])?.project ??
				null
			);
		} catch {
			return null;
		}
	}, [nodes, activeLevelId]);

	return (
		<>
			<button
				className="w-full cursor-pointer rounded-lg border border-sidebar-border bg-sidebar px-3 py-2.5 font-medium text-sidebar-foreground text-xs transition-[background-color,transform] duration-150 hover:bg-sidebar-accent active:scale-[0.98]"
				onClick={() => setOpen(true)}
				type="button"
			>
				Open map workspace
			</button>

			{importSuccess && (
				<p
					role="status"
					className="mt-3 rounded border border-emerald-500/30 p-3 text-xs"
				>
					{importSuccess}
				</p>
			)}
			{savedProject && <BaselineProjectInspection project={savedProject} />}
			{savedBaselineDiagnostics && (
				<BaselineDiagnosticInspection report={savedBaselineDiagnostics} />
			)}
			{savedInventoryReport && (
				<MappedInventoryInspection report={savedInventoryReport} />
			)}
			{savedSectionReport && (
				<StreetSectionInspection report={savedSectionReport} />
			)}
			<StreetScenarioInspector />
 <ScenarioEffectiveInspector />
 <SourceRefreshInspector />
 <SectionLayoutInspector />
			<LaneMovementInspector />
			{savedSourceReport && (
				<SourceNormalizationReport report={savedSourceReport} />
			)}
			{terrainReport && (
				<section
					className="mt-3 rounded-lg border border-sidebar-border p-3 text-xs"
					aria-label="Terrain and elevation evidence"
				>
					<p className="font-medium">Terrain and elevation evidence</p>
					<p className="mt-1 text-muted-foreground">
						{
							terrainReport.samples.filter(
								(sample) => sample.elevationMeters !== null,
							).length
						}{" "}
						available ground samples ·{" "}
						{
							terrainReport.samples.filter(
								(sample) => sample.elevationMeters === null,
							).length
						}{" "}
						unavailable
					</p>
					<p className="mt-1 text-muted-foreground">
						Vertical reference:{" "}
						{terrainReport.source?.verticalReference.kind === "datum"
							? terrainReport.source.verticalReference.datumId
							: "unknown"}
					</p>
					<details className="mt-2">
						<summary className="cursor-pointer">
							{terrainReport.diagnostics.length} elevation diagnostics
						</summary>
						{reportMessages.length ? (
							<ul className="mt-2 space-y-1">
								{reportMessages.slice(0, 20).map((message) => (
									<li key={message}>{message}</li>
								))}
							</ul>
						) : (
							<p className="mt-2">No elevation fallback diagnostics.</p>
						)}
						{reportMessages.length > 20 && (
							<p className="mt-2">
								More diagnostics are retained in road graph data.
							</p>
						)}
					</details>
				</section>
			)}
			<ImageryReferenceReview />
			<MapImportDialog
				activeLevelId={activeLevelId}
				onImported={(review) =>
					setImportSuccess(
						`Added ${roadSegmentLabel(review.newSegments)} and ${mappedObjectLabel(review.newAssets)} to this level. Use 2D or 3D to inspect them; Undo removes the import.`,
					)
				}
				onOpenChange={setOpen}
				open={open}
			/>
		</>
	);
}
