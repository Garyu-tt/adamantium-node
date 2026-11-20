/**
 * Adamantium-node R08 screen-to-workspace coordinate conversion.
 * Uses the native SVG current transformation matrix (zoom + pan).
 * Fail closed in real SVG if its CTM cannot be recovered.
 * SPDX-License-Identifier: Apache-2.0
 */
export function workspacePointFromPointer(event,layer,windowRef){
  const x=Number(event?.clientX),y=Number(event?.clientY);
  if(!Number.isFinite(x)||!Number.isFinite(y))
    throw new TypeError("Invalid screen pointer");
  const owner=layer?.ownerSVGElement;
  const matrix=layer?.getScreenCTM?.();
  if(!matrix||typeof matrix.inverse!=="function"){
    // Testing adapters without a real SVG have no CTM. A *real* mounted
    // SVG must not assume scale 1 and silently corrupt graph coordinates.
    if(owner)throw new Error("SVG transform unavailable: drag cancelled");
    return {x,y};
  }
  let transformed=null;
  if(owner&&typeof owner.createSVGPoint==="function"){
    const p=owner.createSVGPoint();p.x=x;p.y=y;
    transformed=p.matrixTransform(matrix.inverse());
  }else if(typeof windowRef?.DOMPoint==="function"){
    transformed=new windowRef.DOMPoint(x,y).matrixTransform(matrix.inverse());
  }else{
    throw new Error("Native SVG coordinate adapter unavailable");
  }
  if(!transformed||!Number.isFinite(transformed.x)||!Number.isFinite(transformed.y))
    throw new TypeError("Invalid transformed SVG pointer");
  return {x:transformed.x,y:transformed.y};
}
