/**
 * Single-release, source-pinned trusted microprogram worker.
 * Worker threads are NOT a security sandbox for untrusted code.
 * SPDX-License-Identifier: Apache-2.0
 */
import {parentPort, workerData} from 'node:worker_threads';

try {
  const source = Buffer.from(workerData.sourceBase64, 'base64');
  const moduleUrl = 'data:text/javascript;base64,' + source.toString('base64');
  const implementation = await import(moduleUrl);
  if (typeof implementation.handle !== 'function') throw new TypeError('missing handle(input) export');
  parentPort.postMessage({type: 'ready', releaseId: workerData.releaseId});
  parentPort.on('message', async message => {
    if (message?.type !== 'invoke' || !Number.isSafeInteger(message.id)) return;
    try {
      const output = await implementation.handle(message.input);
      if (output === undefined) throw new TypeError('undefined output not allowed');
      parentPort.postMessage({type:'response', id:message.id, ok:true, output});
    } catch {
      // No stack, source content or exception messages cross the worker boundary.
      parentPort.postMessage({type:'response', id:message.id, ok:false, error:'module invocation failed'});
    }
  });
} catch {
  parentPort.postMessage({type:'startup-error'});
}
