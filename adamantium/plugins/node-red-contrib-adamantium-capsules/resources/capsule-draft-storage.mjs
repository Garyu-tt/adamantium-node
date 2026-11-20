/**
 * Adamantium-node R08: best-effort optimistic concurrency for local drafts.
 *
 * This is NOT distributed CAS, not an authenticated registry and not a
 * replacement for Core Graph Manager. In different tabs, localStorage
 * compare + set is not atomic. It detects stale snapshots before a write
 * in one JS turn and preserves existing bytes on detected conflicts.
 * SPDX-License-Identifier: Apache-2.0
 */
export const DRAFT_VERSION= "adamantium.capsule-local-draft/1";
export const DEFAULT_STORAGE_KEY="adamantium.capsule-studio.r01";
const MAX_BYTES=8_000_000;
const object=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
function insist(ok,why){if(!ok)throw new TypeError("Capsule draft: "+why);}
export class CapsuleDraftConflict extends Error {
  constructor(){super("Локальный граф изменён в другой вкладке. Перезагрузи черновик перед сохранением.");this.name="CapsuleDraftConflict";}
}
export class CapsuleDraftStorage {
  #storage;#key;#seen=null;#revision=0;
  constructor({storage,key=DEFAULT_STORAGE_KEY}){
    insist(storage&&typeof storage.getItem==="function"&&typeof storage.setItem==="function","missing storage");
    insist(typeof key==="string"&&key.length>0&&key.length<200,"invalid storage key");
    this.#storage=storage;this.#key=key;
  }
  read(){
    const raw=this.#storage.getItem(this.#key);
    insist(raw===null||typeof raw==="string","invalid stored draft bytes");
    insist(raw===null||raw.length<=MAX_BYTES,"stored draft exceeds size limit");
    const value=raw===null?null:JSON.parse(raw);
    insist(value===null||object(value),"invalid stored draft object");
    const rev=value?.draftRevision;
    insist(rev===undefined||(Number.isSafeInteger(rev)&&rev>=0),"invalid draft revision");
    this.#seen=raw;
    this.#revision=rev??0;
    return {value,revision:this.#revision};
  }
  /**
   * Refuse stale writes, even if they would otherwise be valid graph edits.
   * SetItem failures leave internal revision/seen bytes unchanged.
   */
  write(value){
    insist(object(value)&&object(value.model),"missing draft model");
    const actual=this.#storage.getItem(this.#key);
    if(actual!==this.#seen)throw new CapsuleDraftConflict();
    const rev=this.#revision+1;
    insist(Number.isSafeInteger(rev),"local revision limit reached");
    const encoded=JSON.stringify({...value,draftRevision:rev});
    insist(encoded.length<=MAX_BYTES,"new draft exceeds size limit");
    this.#storage.setItem(this.#key,encoded);
    this.#seen=encoded;this.#revision=rev;
    return rev;
  }
  get revision(){return this.#revision;}
  get stale(){return this.#storage.getItem(this.#key)!==this.#seen;}
}
