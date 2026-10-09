import type { StreetSectionLayout } from "./domain/street-section-layout";
import { ROAD_SIDE_COMPONENT_SPECS, type RoadSideComponentKind } from "./road-cross-section";
import type { RoadTransitionSample } from "./road-transition-profile";

/** Station surfaces and junction seams share physical lane/band widths. */
export function sectionTransitionSample(sample: RoadTransitionSample, layout: StreetSectionLayout, station: number, reversed=false): RoadTransitionSample {
 const interval=layout.intervals.find(interval=>station<interval.end-1e-8)??layout.intervals.at(-1)!;
 const t=Math.max(0,Math.min(1,(station-interval.start)/(interval.end-interval.start)));
 const width=(item:{width:number;startWidth?:number;endWidth?:number})=>(item.startWidth??item.width)+((item.endWidth??item.width)-(item.startWidth??item.width))*t;
 const widths=interval.lanes.map(width);
 const half=widths.reduce((sum,width)=>sum+width,0)/2;
 let cursor=half;
 const laneBoundaryOffsets=widths.slice(0,-1).map(width=>{cursor-=width;return cursor;});
 const components={} as RoadTransitionSample["components"];
 const kinds:Record<string,RoadSideComponentKind>={parking:"parking-lane","protected-cycling":"bike-lane",gutter:"gutter",curb:"curb",verge:"verge",sidewalk:"sidewalk",median:"verge",shoulder:"verge"};
 for(const side of ["left","right"] as const){
  components[side]=Object.fromEntries(ROAD_SIDE_COMPONENT_SPECS.map(spec=>[spec.kind,{innerOffset:half,outerOffset:half,width:0}])) as RoadTransitionSample["components"]["left"];
  let offset=half;
  for(const band of side==="left"?interval.leftBands:interval.rightBands){
   const size=width(band),kind=kinds[band.kind]!;
   const previous=components[side][kind];
   components[side][kind]={innerOffset:previous.width>0?previous.innerOffset:offset,outerOffset:offset+size,width:previous.width+size};
   offset+=size;
  }
 }
 return {...sample,carriagewayHalfWidth:half,medianWidth:0,laneBoundaryOffsets:reversed?laneBoundaryOffsets.reverse().map(offset=>-offset):laneBoundaryOffsets,components:reversed?{left:components.right,right:components.left}:components};
}
