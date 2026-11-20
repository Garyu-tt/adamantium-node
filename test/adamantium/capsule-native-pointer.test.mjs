import test from "node:test";
import assert from "node:assert/strict";
import {workspacePointFromPointer} from "../../adamantium/capsule-native-pointer.mjs";

function nativeLayer({scale=1,tx=0,ty=0}={}){
 const ownerSVGElement={
   createSVGPoint(){
     return {x:0,y:0,matrixTransform(m){
       return {x:m.x(this.x),y:m.y(this.y)};
     }};
   }
 };
 return {
   ownerSVGElement,
   getScreenCTM(){
     return {inverse(){
       return {x:x=>(x-tx)/scale,y:y=>(y-ty)/scale};
     }};
   }
 };
}
test("native CTM inverses 50% zoom, offset pan and arbitrary viewport scroll",()=>{
 const layer=nativeLayer({scale:.5,tx:70,ty:100});
 assert.deepEqual(workspacePointFromPointer({clientX:170,clientY:200},layer,{}),{x:200,y:200});
 assert.deepEqual(workspacePointFromPointer({clientX:220,clientY:260},layer,{}),{x:300,y:320});
});
test("native CTM inverse respects 2x zoom instead of raw client coordinates",()=>{
 const layer=nativeLayer({scale:2,tx:10,ty:25});
 assert.deepEqual(workspacePointFromPointer({clientX:410,clientY:425},layer,{}),{x:200,y:200});
});
test("test-only adapter without real SVG may use identity conversion",()=>{
 assert.deepEqual(workspacePointFromPointer({clientX:25,clientY:90},{},{}),{x:25,y:90});
});
test("real SVG refuses missing matrix instead of corrupting drag at nonunit zoom",()=>{
 const real={ownerSVGElement:{createSVGPoint(){}}};
 assert.throws(()=>workspacePointFromPointer({clientX:25,clientY:20},real,{}),/transform unavailable/);
 assert.throws(()=>workspacePointFromPointer({clientX:NaN,clientY:20},nativeLayer(),{}),/Invalid screen pointer/);
});
test("nonfinite transformed coordinates cannot be persisted",()=>{
 const layer={
   ownerSVGElement:{
     createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:Infinity,y:12}}};}
   },
   getScreenCTM(){return {inverse(){return {};}}}
 };
 assert.throws(()=>workspacePointFromPointer({clientX:10,clientY:20},layer,{}),/Invalid transformed SVG pointer/);
});
