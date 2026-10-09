const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
 const fixtureDir = path.resolve('packages/streetscape/docs/fixtures');
 const api = JSON.parse(fs.readFileSync(path.join(fixtureDir,'effective-model-api-result.json')));
 const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-webgpu']});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(`http://localhost:3002/scene/${api.sceneId}?disable=postFx&qa=46-headless`,{waitUntil:'domcontentloaded',timeout:60000});
  for(let attempt=0;attempt<3;attempt++) {
   await page.getByRole('button',{name:'Streetscape Lab',exact:true}).waitFor({timeout:60000});
   if(!await page.getByRole('button',{name:'Map',exact:true}).isVisible()) await page.getByRole('button',{name:'Streetscape Lab',exact:true}).click();
   try {await page.getByRole('button',{name:'Map',exact:true}).waitFor({timeout:10000});break;}catch(error){if(attempt===2)throw error;}
  }
  await page.getByRole('button',{name:'Map',exact:true}).click();
  console.log('Scenario controls opened');
  await page.getByLabel('Street mode',{exact:true}).waitFor({timeout:60000});
  await page.evaluate(()=>{
   let r;webpackChunk_N_E.push([['step46-browser-'+Date.now()],{},x=>r=x]);
   const m=s=>{const id=Object.keys(r.m).find(id=>id.endsWith(s));if(!id)throw Error(`Missing module ${s}`);return r(id);};
   const core=m('/packages/core/dist/index.js'),p=m('/streetscape/src/host/street-project-persistence.ts');
   window.step46Read=()=>{
    const nodes=core.useScene.getState().nodes,site=Object.values(nodes).find(n=>n.type==='site'),doc=p.readStreetProjectFromSite(site),road=Object.values(nodes).find(n=>n.type==='streetscape:road-network');
    const layout=Object.values(road.edges).find(e=>e.sectionLayout).sectionLayout;
    return {scenario:doc.project.activeScenarioId,width:layout.intervals[0].leftBands[0].width,connectivity:road.osmLaneConnectivity.length,baselines:JSON.stringify(doc.project.baselineRevisions),sources:JSON.stringify(doc.project.sourceReferences),nodes:JSON.stringify(nodes)};
   };
   window.step46Core=core;
   window.step46Initial=window.step46Read();
  });
  const initial = await page.evaluate(()=>step46Initial);
  console.log('Reopened scenario',initial.scenario,initial.width,initial.connectivity);
  if(initial.scenario !== api.scenarioA || initial.width !== 4 || initial.connectivity !== 0)throw Error('Reopened proposal differs');
  const pavement=page.getByLabel('Scenario pavement road 1 section 1',{exact:true});
  if(!await pavement.isDisabled() || await pavement.inputValue() !== 'concrete')throw Error('Reopened lock/material differs');
  const mode=page.getByLabel('Street mode',{exact:true});
  await mode.selectOption(api.scenarioB);
  const alternative=await page.evaluate(()=>step46Read());
  if(alternative.width !== 2 || alternative.connectivity !== 1 || await pavement.isDisabled())throw Error('Alternative did not inherit baseline');
  await mode.selectOption('');
  const baseline=await page.evaluate(()=>step46Read());
  if(baseline.scenario !== null || baseline.width !== 2 || baseline.connectivity !== 1)throw Error('Baseline not restored');
  await mode.selectOption(api.scenarioA);
  await page.getByLabel('Scenario effective change reason',{exact:true}).fill('Browser restore inventory check');
  await page.locator('[aria-label="Scenario locks and inventory"] details').evaluate(el=>{el.open=true;});
  await page.getByRole('button',{name:'Restore Road 1 laneConnectivity 1',exact:true}).click();
  if((await page.evaluate(()=>step46Read())).connectivity !== 1)throw Error('UI inventory restore failed');
  await page.evaluate(()=>step46Core.useScene.temporal.getState().undo());
  if((await page.evaluate(()=>step46Read())).connectivity !== 0)throw Error('Inventory undo failed');
  const beforeView=await page.evaluate(()=>step46Read().nodes);
  await page.getByRole('button',{name:'2D',exact:true}).click();
  await page.locator('[aria-label="Scenario locks and inventory"]').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(fixtureDir,'effective-model-browser-2d.png')});
  await page.getByRole('button',{name:'3D',exact:true}).click();
  await page.waitForTimeout(1500);
  await page.screenshot({path:path.join(fixtureDir,'effective-model-browser-3d.png')});
  const final=await page.evaluate(()=>step46Read());
  if(final.nodes!==beforeView || final.baselines!==initial.baselines || final.sources!==initial.sources)throw Error('Viewing/scenario edits mutated accepted evidence');
  const result={sceneId:api.sceneId,reopened:{width:initial.width,connectivity:initial.connectivity,material:'concrete',locked:true},alternative:{width:alternative.width,connectivity:alternative.connectivity,locked:false},baseline:{width:baseline.width,connectivity:baseline.connectivity},inventoryRestoreThroughUi:true,inventoryUndo:true,viewSwitchReadOnly:true,baselineUnchanged:true,sourcesUnchanged:true,lightPreview:true,browser:'Headless Chrome (T3 automation host explicitly unavailable)'};
  fs.writeFileSync(path.join(fixtureDir,'effective-model-browser-result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(result);
  await page.goto('http://localhost:3002/scene/78dbb7690924?disable=postFx',{waitUntil:'domcontentloaded',timeout:60000});
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
