// Open Streetscape Lab, then evaluate in the localhost:3002 collaborative preview.
(async () => {
 let requireModule;
 webpackChunk_N_E.push([['osm-client-' + Date.now()], {}, r => { requireModule = r }]);
 const module = suffix => requireModule(Object.keys(requireModule.m).find(id => id.endsWith(suffix)));
 const { createOsmAcquisitionClient } = module('/streetscape/src/source/osm-acquisition.ts');
 const { createOsmSourceSnapshot } = module('/streetscape/src/source/osm-source-snapshot.ts');
 const bbox = { south: 0, west: 0, north: 1, east: 1 };
 const checks = [];
 const check = (name, pass) => { checks.push({ name, pass: !!pass }); if (!pass) throw Error(name); };
 const response = () => new Response('{"elements":[]}');
 try {
  let requests = 0, release;
  const client = createOsmAcquisitionClient({ request: () => ({ url: '/test-only' }), fetch: async () => {
   requests++; await new Promise(resolve => { release = resolve; }); return response();
  } });
  const controller = new AbortController();
  const cancelled = client.acquire(bbox, { signal: controller.signal }).catch(error => error);
  const shared = client.acquire(bbox);
  controller.abort(); release();
  check('one consumer cancellation preserves shared request', (await cancelled).name === 'AbortError' && requests === 1);
  const captured = await shared;
  const reused = await client.acquire(bbox);
  check('cache retains capture time', requests === 1 && captured.responses[0].capture.acquiredAt === reused.responses[0].capture.acquiredAt);
  const original = await createOsmSourceSnapshot(captured), cached = await createOsmSourceSnapshot(reused);
  check('cached capture preserves snapshot identities', original.contentIdentity === cached.contentIdentity && original.integrityIdentity === cached.integrityIdentity);
  reused.responses[0].payload.elements.push({ type: 'node', id: 1 });
  check('caller mutation cannot affect cache', (await client.acquire(bbox)).responses[0].payload.elements.length === 0);
  let calls = 0, unblock;
  const serial = createOsmAcquisitionClient({ request: () => ({ url: '/test-only' }), fetch: async () => {
   calls++; await new Promise(resolve => { unblock = resolve; }); return response();
  } }, { concurrency: 1 });
  const running = serial.acquire(bbox), queuedController = new AbortController();
  const queued = serial.acquire({ ...bbox, east: 2 }, { signal: queuedController.signal }).catch(error => error);
  queuedController.abort(); unblock(); await running;
  check('cancelled queue never reaches transport', (await queued).name === 'AbortError' && calls === 1);
  let timeoutCalls = 0;
  const deadline = createOsmAcquisitionClient({ request: () => ({ url: '/test-only' }), fetch: async () => {
   timeoutCalls++; return new Promise(() => {});
  } }, { timeoutMs: 20 });
  const failure = await deadline.acquire(bbox).catch(error => error);
  check('deadline cannot trigger request fan-out', failure.code === 'timeout' && timeoutCalls === 1);
  return { pass: true, url: location.href, checks };
 } catch (error) { return { pass: false, error: error.message, checks }; }
})()
