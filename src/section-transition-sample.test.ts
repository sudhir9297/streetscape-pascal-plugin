import {test,expect} from "bun:test";
import {RoadNetworkNode} from "./schema";
import {StreetSectionLayout} from "./domain/street-section-layout";
import {asymmetricLayout} from "./domain/street-section-layout-fixture";
import {buildRoadTransitionProfiles} from "./road-transition-profile";
import {roadJunctionMouth,trimRoadProfileAtJunctions} from "./road-junction-seams";

test("junction mouth at a cut uses interpolated section widths and authored band offsets",()=>{
 const layout=StreetSectionLayout.parse(asymmetricLayout);
 layout.intervals[0]!.lanes.push({id:"turn",direction:"forward",use:"turning",width:3,startWidth:0,endWidth:3});
 layout.intervals[0]!.leftBands[0]!.endWidth=3;
 const node=RoadNetworkNode.parse({id:"road-network_section-seams",graphNodes:{a:{id:"a",position:[0,0,0]},b:{id:"b",position:[30,0,0]}},edges:{ab:{id:"ab",startNodeId:"a",endNodeId:"b",sectionLayout:layout}}});
 const profile=buildRoadTransitionProfiles(node)[0]!;
 const trimmed=trimRoadProfileAtJunctions(profile,5,0);
 const mouth=roadJunctionMouth(trimmed,false);
 expect(mouth.sample.carriagewayHalfWidth).toBeCloseTo((6.2+1.5)/2);
 expect(mouth.sample.components.left.sidewalk.width).toBeCloseTo(2.5);
 expect(mouth.sample.components.left["bike-lane"].innerOffset).toBeCloseTo((6.2+1.5)/2+2.5);
 expect(mouth.sample.components.left["bike-lane"].width).toBe(1.2);
});
