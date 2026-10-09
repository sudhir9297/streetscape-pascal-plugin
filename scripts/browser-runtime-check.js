// Evaluate this expression in the collaborative preview at localhost:3002.
// Development Webpack host only. Uses rendered event surfaces, not mocked hooks.
(async () => {
  let requireModule
  window.webpackChunk_N_E.push([[`streetscape-check-${Date.now()}`], {}, r => { requireModule = r }])
  const module = suffix => {
    const id = Object.keys(requireModule.m).find(id => id.endsWith(suffix))
    if (!id) throw Error(`Missing development module: ${suffix}`)
    return requireModule(id)
  }
  const core = module('/packages/core/dist/index.js')
  const viewer = module('/packages/viewer/dist/store/use-viewer.js').default
  const fiber = module('/@react-three/fiber/dist/react-three-fiber.esm.js')
  const street = module('/streetscape/src/store.ts').useStreetscapeStore
  const results = []
  const assert = (name, condition) => {
    results.push({ name, pass: !!condition })
    if (!condition) throw Error(name)
  }
  const wait = () => new Promise(resolve => setTimeout(resolve, 120))
  const until = async predicate => {
    for(let attempt=0;attempt<50;attempt++){if(predicate())return;await wait()}
    throw Error('Timed out waiting for the viewer to settle')
  }
  const originalSelection = viewer.getState().selection
  const originalMode = viewer.getState().cameraMode
  const originalStreetSelection = street.getState().roadElementSelection
  const errors = []
  const originalConsoleError = console.error
  console.error = (...args) => {
    errors.push(args.map(arg => arg?.message || String(arg)).join(' '))
    originalConsoleError(...args)
  }
  let road = Object.values(core.useScene.getState().nodes).find(node => node.name === 'Streetscape phase 0 test')
  if (!road) {
    const level = Object.values(core.useScene.getState().nodes).find(node => node.type === 'level')
    if (!level) throw Error('Open an unsaved scratch scene with a level first')
    const def = window.__pascalNodeRegistry.get('streetscape:road-network')
    road = def.schema.parse({ ...def.defaults(), parentId: level.id, name: 'Streetscape phase 0 test',
      graphNodes: { a: {id:'a',position:[-10,0.1,0]}, b:{id:'b',position:[10,0.1,0]} },
      edges: {ab:{id:'ab',startNodeId:'a',endNodeId:'b',alignment:[[0,0.1,-3]],styleId:'local-street'}} })
    core.useScene.getState().createNode(road, level.id)
  }
  const id = road.id
  let lamp = Object.values(core.useScene.getState().nodes).find(node => node.name === 'Streetscape phase 0 attached lamp')
  if (!lamp) {
    const def = window.__pascalNodeRegistry.get('streetscape:street-light')
    lamp = def.schema.parse({...def.defaults(),parentId:road.parentId,name:'Streetscape phase 0 attached lamp',position:[-6,0.1,5],
      roadAttachment:{networkNodeId:id,attachmentId:'phase0-lamp',side:'left'}})
    core.useScene.getState().createNode(lamp,road.parentId)
    core.useScene.getState().updateNode(id,{attachments:{...road.attachments,'phase0-lamp':{
      id:'phase0-lamp',edgeId:'ab',assetNodeId:lamp.id,kind:'lamp',station:4,lateralOffset:5,verticalOffset:0,alignment:'free',side:'left'}}})
  }
  const historyBefore = core.useScene.temporal.getState()
  const historySnapshot = {pastStates:[...historyBefore.pastStates],futureStates:[...historyBefore.futureStates]}
  const root = () => {
    const state = [...fiber._roots.values()].map(value => value.store.getState()).find(state => {
      const rect = state.gl.domElement.getBoundingClientRect()
      return state.gl.domElement.isConnected && rect.width > 0 && rect.height > 0
    })
    if (!state) throw Error('No visible mounted Canvas')
    return state
  }
  const node = () => core.useScene.getState().nodes[id]
  const shape = () => JSON.stringify({graphNodes:node().graphNodes,edges:node().edges, lamp:core.useScene.getState().nodes[lamp.id]?.position, lampRotation:core.useScene.getState().nodes[lamp.id]?.rotation})
  const handles = predicate => {
    const found = []
    root().scene.traverse(object => { if (predicate(object)) found.push(object) })
    return found
  }
  const arrow = () => handles(o => o.geometry?.parameters?.width === 0.52 && o.__r3f?.handlers.onPointerDown)[0]
  const hit = name => handles(o => o.name === name)[0]
  const begin = (object, dx = -30, dy = 0) => {
    if (!object) throw Error('Required handle did not render')
    const state = root(), rect = state.gl.domElement.getBoundingClientRect()
    state.scene.updateMatrixWorld(true)
    const point = object.position.clone()
    object.getWorldPosition(point)
    point.project(state.camera)
    const x = rect.left + (point.x + 1) * rect.width / 2
    const y = rect.top + (1 - point.y) * rect.height / 2
    const event = new PointerEvent('pointerdown', {bubbles:true,pointerId:71,button:0,buttons:1,clientX:x,clientY:y})
    Object.defineProperty(event, 'offsetX', {value:x-rect.left})
    Object.defineProperty(event, 'offsetY', {value:y-rect.top})
    state.events.connected.dispatchEvent(event)
    window.dispatchEvent(new PointerEvent('pointermove', {pointerId:71,buttons:1,clientX:x+dx,clientY:y+dy}))
    assert('drag started with live preview', viewer.getState().inputDragging && !!core.useLiveNodeOverrides.getState().get(id))
  }
  const clean = () => !viewer.getState().inputDragging && !core.useLiveNodeOverrides.getState().get(id) && core.useScene.temporal.getState().isTracking
  try {
    viewer.getState().setCameraMode('perspective')
    viewer.getState().setSelection({...originalSelection,levelId:road.parentId,selectedIds:[id]})
    street.getState().setRoadElementSelection(null)
    await until(() => root().camera.isPerspectiveCamera && !!root().controls?.setLookAt && !!arrow())
    root().controls.setLookAt(24,24,24,0,0,0,false)
    root().advance(performance.now()/1000)
    assert('representative fixture has attached lamp',node().attachments['phase0-lamp']?.assetNodeId===lamp.id)
    assert('single Fiber runtime', Object.keys(requireModule.m).filter(id=>id.includes('fiber/dist/events')).length === 1)
    assert('Canvas scene and extension handles render', !!root().scene && !!arrow())
    let before = shape(), count = core.useScene.temporal.getState().pastStates.length
    begin(arrow())
    assert('preview does not mutate scene', before === shape())
    window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:99}))
    assert('unrelated pointer cannot cancel',viewer.getState().inputDragging)
    window.dispatchEvent(new PointerEvent('pointerup',{pointerId:99}))
    assert('unrelated pointer cannot commit', viewer.getState().inputDragging)
    window.dispatchEvent(new PointerEvent('pointerup',{pointerId:71}))
    assert('extension commits one undo step', shape() !== before && core.useScene.temporal.getState().pastStates.length === count+1 && clean())
    core.useScene.temporal.getState().undo()
    assert('undo restores extension', shape() === before)
    for (const cancel of ['Escape','pointercancel','blur','unmount']) {
      await wait(); before = shape(); count = core.useScene.temporal.getState().pastStates.length
      begin(arrow())
      if(cancel==='Escape') window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      if(cancel==='pointercancel') window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:71}))
      if(cancel==='blur') window.dispatchEvent(new Event('blur'))
      if(cancel==='unmount') viewer.getState().setSelection({selectedIds:[]})
      await wait()
      results.push({name:`extension cleanup ${cancel}`,unchanged:shape()===before,clean:clean(),historyDelta:core.useScene.temporal.getState().pastStates.length-count})
      assert(`extension ${cancel} releases preview/history`, shape()===before && clean() && core.useScene.temporal.getState().pastStates.length===count)
      viewer.getState().setSelection({selectedIds:[id]})
    }
    street.getState().setRoadElementSelection({networkId:id,kind:'spline',id})
    await wait()
    for(const [name,dx,dy] of [['road-control-hit:point:ab:0',30,0],['road-elevation-hit:point:ab:0:0.72',0,-30]]) {
      before=shape(); count=core.useScene.temporal.getState().pastStates.length
      begin(hit(name),dx,dy)
      window.dispatchEvent(new PointerEvent('pointerup',{pointerId:71}))
      assert(`${name} commits one undo step`,shape()!==before && core.useScene.temporal.getState().pastStates.length===count+1 && clean())
      core.useScene.temporal.getState().undo()
      assert(`${name} undo restores geometry`,shape()===before)
      await wait()
    }
    street.getState().setRoadElementSelection({networkId:id,kind:'control',id:'ab',index:0})
    await wait()
    for(const cancel of ['Escape','pointercancel','blur','unmount']) {
      street.getState().setRoadElementSelection({networkId:id,kind:'control',id:'ab',index:0});await until(()=>!!hit('road-control-hit:point:ab:0'))
      before=shape();count=core.useScene.temporal.getState().pastStates.length
      begin(hit('road-control-hit:point:ab:0'),30,0)
      if(cancel==='Escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
      if(cancel==='pointercancel')window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:71}))
      if(cancel==='blur')window.dispatchEvent(new Event('blur'))
      if(cancel==='unmount')viewer.getState().setSelection({selectedIds:[]})
      await wait()
      assert(`spline ${cancel} releases preview/history`,shape()===before && clean() && core.useScene.temporal.getState().pastStates.length===count)
      viewer.getState().setSelection({selectedIds:[id]});await wait()
    }
    street.getState().setRoadElementSelection({networkId:id,kind:'control',id:'ab',index:0});await until(()=>!!hit('road-control-hit:point:ab:0'))
    viewer.getState().setCameraMode('orthographic')
    await until(() => root().camera.isOrthographicCamera)
    const camera=root().camera, zoomBefore=camera.zoom
    assert('orthographic camera mounted',camera.isOrthographicCamera)
    for(const zoom of [10,40,100]) {
      root().controls.zoomTo(zoom,false);camera.zoom=zoom; camera.updateProjectionMatrix();root().advance(performance.now()/1000)
      const control=hit('road-control-hit:point:ab:0')
      results.push({name:`zoom measurement ${zoom}`,zoom:camera.zoom,scale:control.parent.scale.x})
      assert(`spline screen scale at zoom ${zoom}`,Math.abs(control.parent.scale.x*zoom-0.82*1.12)<1e-6)
    }
    root().controls.zoomTo(zoomBefore,false);camera.zoom=zoomBefore;camera.updateProjectionMatrix()
    street.getState().setRoadElementSelection(null)
    await wait()
    for(const zoom of [10,40,100]) {
      root().controls.zoomTo(zoom,false);camera.zoom=zoom;camera.updateProjectionMatrix();root().advance(performance.now()/1000)
      assert(`extension screen scale at zoom ${zoom}`,Math.abs(arrow().parent.scale.x*zoom-0.65)<1e-6)
    }
    root().controls.zoomTo(zoomBefore,false);camera.zoom=zoomBefore;camera.updateProjectionMatrix()
    assert('no Canvas or interaction errors',errors.length===0)
    return {pass:true,url:location.href,results}
  } catch(error) {
    return {pass:false,error:error.message,errors,results}
  } finally {
    window.dispatchEvent(new Event('blur'))
    viewer.getState().setCameraMode(originalMode)
    viewer.getState().setSelection(originalSelection)
    street.getState().setRoadElementSelection(originalStreetSelection)
    core.useScene.temporal.setState(historySnapshot)
    console.error=originalConsoleError
  }
})()
