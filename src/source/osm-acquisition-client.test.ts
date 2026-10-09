import { expect, test } from "bun:test";
import { createOsmAcquisitionClient } from "./osm-acquisition";
const bbox = { south: 0, west: 0, north: 1, east: 1 };
const other = { ...bbox, east: 2 };
const request = () => ({ url: "/streets" });
const response = (headers?: HeadersInit) =>
	new Response('{"elements":[]}', { headers });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("shared consumers cancel independently and receive detached cached captures", async () => {
	let calls = 0,
		release!: () => void;
	const client = createOsmAcquisitionClient({
		request,
		fetch: async (_, init) => {
			calls++;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			expect(init?.signal?.aborted).toBe(false);
			return response();
		},
	});
	const controller = new AbortController();
	const first = client.acquire(bbox, { signal: controller.signal });
	const second = client.acquire(bbox);
	controller.abort();
	await expect(first).rejects.toMatchObject({ name: "AbortError" });
	release();
	const captured = await second;
	captured.responses[0]!.payload.elements = ["caller mutation"];
	const reused = await client.acquire(bbox);
	expect(reused.responses[0]!.payload.elements).toEqual([]);
	expect(reused.responses[0]!.capture?.acquiredAt).toBe(
		captured.responses[0]!.capture?.acquiredAt,
	);
	expect(calls).toBe(1);
});
test("expiry, LRU count, byte limit and response cache policy bound reuse", async () => {
	let now = 0,
		calls = 0;
	const client = createOsmAcquisitionClient(
		{
			request,
			fetch: async () => {
				calls++;
				return response();
			},
		},
		{ clock: () => now, ttlMs: 100, maxEntries: 1 },
	);
	await client.acquire(bbox);
	await client.acquire(bbox);
	expect(calls).toBe(1);
	now = 100;
	await client.acquire(bbox);
	expect(calls).toBe(2);
	await client.acquire(other);
	await client.acquire(bbox);
	expect(calls).toBe(4);
	for (const headers of [
		{ "cache-control": "no-store" },
		{ "cache-control": "max-age=0" },
	]) {
		calls = 0;
		const noCache = createOsmAcquisitionClient({
			request,
			fetch: async () => {
				calls++;
				return response(headers);
			},
		});
		await noCache.acquire(bbox);
		await noCache.acquire(bbox);
		expect(calls).toBe(2);
	}
	calls = 0;
	const tiny = createOsmAcquisitionClient(
		{
			request,
			fetch: async () => {
				calls++;
				return response();
			},
		},
		{ maxBytes: 1 },
	);
	await tiny.acquire(bbox);
	await tiny.acquire(bbox);
	expect(calls).toBe(2);
});
test("queued cancellation stops transport and concurrency stays bounded", async () => {
	let calls = 0,
		release!: () => void;
	const client = createOsmAcquisitionClient(
		{
			request,
			fetch: async () => {
				calls++;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return response();
			},
		},
		{ concurrency: 1 },
	);
	const active = client.acquire(bbox);
	const controller = new AbortController();
	const queued = client.acquire(other, { signal: controller.signal });
	controller.abort();
	await expect(queued).rejects.toMatchObject({ name: "AbortError" });
	release();
	await active;
	await tick();
	expect(calls).toBe(1);
});
test("all consumers cancel active work and a later request can start fresh", async () => {
	let calls = 0;
	const client = createOsmAcquisitionClient({
		request,
		fetch: async (_, init) => {
			calls++;
			if (calls > 1) return response();
			return new Promise<Response>((_, reject) =>
				init!.signal!.addEventListener(
					"abort",
					() => reject(init!.signal!.reason),
					{ once: true },
				),
			);
		},
	});
	const controller = new AbortController();
	const first = client.acquire(bbox, { signal: controller.signal });
	controller.abort();
	await expect(first).rejects.toMatchObject({ name: "AbortError" });
	await client.acquire(bbox);
	expect(calls).toBe(2);
});
test("429 applies Retry-After cooldown without retries or subdivisions", async () => {
	let now = 0,
		calls = 0;
	const client = createOsmAcquisitionClient(
		{
			request,
			fetch: async () => {
				calls++;
				return calls === 1
					? new Response("", { status: 429, headers: { "retry-after": "2" } })
					: response();
			},
		},
		{ clock: () => now },
	);
	await expect(client.acquire(bbox)).rejects.toMatchObject({
		code: "rate-limit",
	});
	await expect(client.acquire(other)).rejects.toMatchObject({
		code: "rate-limit",
	});
	expect(calls).toBe(1);
	now = 2000;
	await client.acquire(other);
	expect(calls).toBe(2);
});
test("deadline aborts stalled transport without subdivision and releases queue", async () => {
	let calls = 0,
		aborted = false;
	const client = createOsmAcquisitionClient(
		{
			request,
			fetch: async (_, init) => {
				calls++;
				if (calls > 1) return response();
				init!.signal!.addEventListener("abort", () => {
					aborted = true;
				});
				return new Promise<Response>(() => {});
			},
		},
		{ timeoutMs: 10, concurrency: 1 },
	);
	const stalled = client.acquire(bbox),
		queued = client.acquire(other);
	await expect(stalled).rejects.toMatchObject({ code: "timeout" });
	await queued;
	expect(aborted).toBe(true);
	expect(calls).toBe(2);
});
test("route changes isolate cached data and queue capacity rejects excess work", async () => {
	let route = "/a",
		calls = 0;
	const client = createOsmAcquisitionClient({
		request: () => ({ url: route }),
		fetch: async () => {
			calls++;
			return response();
		},
	});
	await client.acquire(bbox);
	route = "/b";
	await client.acquire(bbox);
	expect(calls).toBe(2);
	const controller = new AbortController();
	const bounded = createOsmAcquisitionClient({
		request,
		fetch: async () => new Promise<Response>(() => {}),
	});
	const work = Array.from({ length: 32 }, (_, i) =>
		bounded
			.acquire({ ...bbox, east: i + 1 }, { signal: controller.signal })
			.catch((error) => error),
	);
	await expect(bounded.acquire({ ...bbox, east: 40 })).rejects.toMatchObject({
		code: "rate-limit",
	});
	controller.abort();
	await Promise.all(work);
});

test("two acquisitions and depth-two subdivision stay within transport and request budgets", async () => {
	let active = 0,
		peak = 0,
		calls = 0;
	const client = createOsmAcquisitionClient({
		request: (bounds) => ({ url: String(bounds.east - bounds.west) }),
		fetch: async (url) => {
			active++;
			calls++;
			peak = Math.max(peak, active);
			await tick();
			active--;
			return Number(url) > 0.25
				? new Response("", { status: 504 })
				: response();
		},
	});
	const [first, second] = await Promise.all([
		client.acquire(bbox),
		client.acquire({ ...bbox, west: 2, east: 3 }),
	]);
	expect(peak).toBe(2);
	expect(calls).toBe(42);
	expect(first.responses.length).toBe(16);
	expect(second.responses.length).toBe(16);
	expect(first.diagnostics.length).toBe(5);
});
