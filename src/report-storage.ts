import { gzipSync, gunzipSync, strToU8, strFromU8 } from "fflate";

const FORMAT = "streetscape-report-gzip";
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
	let crc = index;
	for (let bit = 0; bit < 8; bit++)
		crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	return crc >>> 0;
});

/** Lossless storage envelope; small reports retain their original JSON format. */
export function encodeStoredReport(value: unknown): string {
	const json = JSON.stringify(value);
	const bytes = strToU8(json);
	if (bytes.length > MAX_REPORT_BYTES)
		throw Error("Report exceeds decoded byte limit");
	if (bytes.length < 65536) return json;
	const compressed = gzipSync(bytes, { level: 6, mtime: 0 });
	let binary = "";
	for (let offset = 0; offset < compressed.length; offset += 8192)
		binary += String.fromCharCode(
			...compressed.subarray(offset, offset + 8192),
		);
	const envelope = JSON.stringify({
		format: FORMAT,
		version: 1,
		byteLength: bytes.length,
		data: btoa(binary),
	});
	return envelope.length < json.length ? envelope : json;
}

export function decodeStoredReport(value: unknown): unknown {
	const parsed = typeof value === "string" ? JSON.parse(value) : value;
	if (!parsed || typeof parsed !== "object" || parsed.format !== FORMAT)
		return parsed;
	if (
		parsed.version !== 1 ||
		!Number.isSafeInteger(parsed.byteLength) ||
		parsed.byteLength < 0 ||
		parsed.byteLength > MAX_REPORT_BYTES ||
		typeof parsed.data !== "string" ||
		parsed.data.length > MAX_REPORT_BYTES
	)
		throw Error("Invalid compressed report envelope");
	const binary = atob(parsed.data);
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
	if (bytes.length < 18) throw Error("Invalid compressed report");
	const declared = new DataView(bytes.buffer).getUint32(bytes.length - 4, true);
	if (declared !== parsed.byteLength)
		throw Error("Compressed report size mismatch");
	const decoded = gunzipSync(bytes, { out: new Uint8Array(parsed.byteLength) });
	let crc = 0xffffffff;
	for (const byte of decoded)
		crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]!;
	if (
		(crc ^ 0xffffffff) >>> 0 !==
		new DataView(bytes.buffer).getUint32(bytes.length - 8, true)
	)
		throw Error("Compressed report checksum mismatch");
	return JSON.parse(strFromU8(decoded));
}
