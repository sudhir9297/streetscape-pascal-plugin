import { TerrainSource, type TerrainCoverage } from "./domain/terrain-evidence";
import { getElevationTileUrl } from "./map-data-source";

import type { GeoPoint, GeoBoundingBox } from "./domain/site-frame";
export type { GeoPoint, GeoBoundingBox } from "./domain/site-frame";

export const TERRAIN_TILE_ZOOM = 15;
const TERRAIN_TILE_SIZE = 256;
export const DEFAULT_TERRAIN_SOURCE = TerrainSource.parse({
	provider: "mapzen-aws",
	dataset: "terrain-tiles",
	encoding: "terrarium-rgb",
	units: "metres",
	verticalReference: { kind: "unknown" },
});

export type TerrainTile = {
	width: number;
	height: number;
	elevations: Float32Array;
};

export type TerrainTileLoader = (
	zoom: number,
	x: number,
	y: number,
	signal?: AbortSignal,
) => Promise<TerrainTile | null>;

export function terrariumTileUrl(zoom: number, x: number, y: number): string {
	return getElevationTileUrl(zoom, x, y);
}

/** Continuous slippy-map tile coordinates (integer part = tile index). */
export function latLonToTileFraction(
	point: GeoPoint,
	zoom: number,
): { x: number; y: number } {
	const scale = 2 ** zoom;
	const latRad = (point.lat * Math.PI) / 180;
	return {
		x: ((point.lon + 180) / 360) * scale,
		y:
			((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
			scale,
	};
}

/** Terrarium RGB encoding: elevation = (R * 256 + G + B / 256) - 32768. */
export function decodeTerrariumPixels(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
): Float32Array {
	const elevations = new Float32Array(width * height);
	for (let index = 0; index < width * height; index++) {
		const offset = index * 4;
		elevations[index] =
			rgba[offset + 3] === 0
				? NaN
				: rgba[offset]! * 256 +
					rgba[offset + 1]! +
					rgba[offset + 2]! / 256 -
					32768;
	}
	return elevations;
}

async function fetchTerrariumTile(
	zoom: number,
	x: number,
	y: number,
	signal?: AbortSignal,
): Promise<TerrainTile | null> {
	try {
		const response = await fetch(terrariumTileUrl(zoom, x, y), { signal });
		if (!response.ok) return null;
		const bitmap = await createImageBitmap(await response.blob());
		const canvas =
			typeof OffscreenCanvas !== "undefined"
				? new OffscreenCanvas(bitmap.width, bitmap.height)
				: Object.assign(document.createElement("canvas"), {
						width: bitmap.width,
						height: bitmap.height,
					});
		const context = canvas.getContext("2d") as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!context) {
			bitmap.close();
			return null;
		}
		context.drawImage(bitmap, 0, 0);
		const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
		bitmap.close();
		return {
			width: image.width,
			height: image.height,
			elevations: decodeTerrariumPixels(image.data, image.width, image.height),
		};
	} catch (error) {
		if (signal?.aborted) throw error;
		return null;
	}
}

/**
 * Samples ground elevation from Mapzen/AWS terrarium DEM tiles. Prefetch the
 * covering tile set once, then sample synchronously with bilinear filtering.
 * Sampling is clamped within each tile; at 600 m scale the seam error between
 * adjacent tiles is negligible.
 */
export class TerrainSampler {
	private tiles = new Map<string, TerrainTile | null>();
	private captures = new Map<string, TerrainCoverage["tiles"][number]>();
	readonly source: import("./domain/terrain-evidence").TerrainSource;
	failedTiles = 0;

	constructor(
		private zoom: number = TERRAIN_TILE_ZOOM,
		private loadTile: TerrainTileLoader = fetchTerrariumTile,
		private options: {
			source?: import("./domain/terrain-evidence").TerrainSource;
			now?: () => string;
			tileUrl?: (zoom: number, x: number, y: number) => string | null;
		} = {},
	) {
		this.source = TerrainSource.parse(
			options.source ??
				(loadTile === fetchTerrariumTile
					? DEFAULT_TERRAIN_SOURCE
					: {
							provider: "injected",
							dataset: "unspecified",
							encoding: "decoded-grid",
							units: "metres",
							verticalReference: { kind: "unknown" },
						}),
		);
	}

	getCoverage(requestedBounds: GeoBoundingBox): TerrainCoverage {
		return {
			requestedBounds: { ...requestedBounds },
			tiles: structuredClone([...this.captures.values()]),
		};
	}

	get successfulTiles(): number {
		return [...this.tiles.values()].filter((tile) => tile !== null).length;
	}

	hasElevationAt(point: GeoPoint): boolean {
		const fraction = latLonToTileFraction(point, this.zoom);
		return this.sampleElevationAt(point) !== null;
	}

	async prefetch(bbox: GeoBoundingBox, signal?: AbortSignal): Promise<void> {
		signal?.throwIfAborted();
		const min = latLonToTileFraction(
			{ lat: bbox.north, lon: bbox.west },
			this.zoom,
		);
		const max = latLonToTileFraction(
			{ lat: bbox.south, lon: bbox.east },
			this.zoom,
		);
		const jobs: Promise<void>[] = [];
		for (let x = Math.floor(min.x); x <= Math.floor(max.x); x++) {
			for (let y = Math.floor(min.y); y <= Math.floor(max.y); y++) {
				const key = `${x}/${y}`;
				if (this.tiles.has(key)) continue;
				jobs.push(
					(async () => {
						const captureUrl = this.options.tileUrl
							? this.options.tileUrl(this.zoom, x, y)
							: this.loadTile === fetchTerrariumTile
								? terrariumTileUrl(this.zoom, x, y)
								: null;
						let tile: TerrainTile | null = null,
							reason: TerrainCoverage["tiles"][number]["reason"] = null;
						try {
							tile = await this.loadTile(this.zoom, x, y, signal);
						} catch (error) {
							signal?.throwIfAborted();
							reason = "loader-error";
						}
						signal?.throwIfAborted();
						if (
							tile &&
							(!Number.isSafeInteger(tile.width) ||
								!Number.isSafeInteger(tile.height) ||
								tile.width < 1 ||
								tile.height < 1 ||
								tile.elevations.length !== tile.width * tile.height)
						) {
							tile = null;
							reason = "invalid";
						}
						const valid = tile
							? tile.elevations.reduce(
									(sum, value) => sum + (Number.isFinite(value) ? 1 : 0),
									0,
								)
							: 0;
						if (tile && valid === 0) {
							tile = null;
							reason = "invalid";
						}
						this.tiles.set(key, tile);
						if (!tile) this.failedTiles++;
						const bounds = tileBounds(this.zoom, x, y);
						this.captures.set(key, {
							zoom: this.zoom,
							x,
							y,
							bounds,
							url: captureUrl,
							acquiredAt: (
								this.options.now ?? (() => new Date().toISOString())
							)(),
							status: tile
								? valid === tile.elevations.length
									? "available"
									: "partial"
								: "unavailable",
							reason: tile ? null : (reason ?? "missing"),
						});
					})(),
				);
			}
		}
		await Promise.all(jobs);
		signal?.throwIfAborted();
	}

	/** Legacy flat fallback; use sampleElevationAt when availability matters. */
	elevationAt(point: GeoPoint): number {
		return this.sampleElevationAt(point) ?? 0;
	}

	/** Measured metres, including zero; null means unavailable. */
	sampleElevationAt(point: GeoPoint): number | null {
		const fraction = latLonToTileFraction(point, this.zoom);
		const tileX = Math.floor(fraction.x);
		const tileY = Math.floor(fraction.y);
		const tile = this.tiles.get(`${tileX}/${tileY}`);
		if (!tile) return null;
		const pixelX = (fraction.x - tileX) * tile.width - 0.5;
		const pixelY = (fraction.y - tileY) * tile.height - 0.5;
		const x0 = Math.max(0, Math.min(tile.width - 1, Math.floor(pixelX)));
		const y0 = Math.max(0, Math.min(tile.height - 1, Math.floor(pixelY)));
		const x1 = Math.min(tile.width - 1, x0 + 1);
		const y1 = Math.min(tile.height - 1, y0 + 1);
		const fx = Math.max(0, Math.min(1, pixelX - x0));
		const fy = Math.max(0, Math.min(1, pixelY - y0));
		const at = (x: number, y: number) => tile.elevations[y * tile.width + x]!;
		const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
		const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
		const value = top * (1 - fy) + bottom * fy;
		return Number.isFinite(value) ? value : null;
	}
}

export { TERRAIN_TILE_SIZE };

export function tileBounds(zoom: number, x: number, y: number): GeoBoundingBox {
	const scale = 2 ** zoom;
	const latitude = (row: number) =>
		(Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / scale))) * 180) / Math.PI;
	return {
		west: (x / scale) * 360 - 180,
		east: ((x + 1) / scale) * 360 - 180,
		north: latitude(y),
		south: latitude(y + 1),
	};
}
