// SPDX-License-Identifier: Apache-2.0
// A minimal, no-eval contract for the first safe Node-RED package factory.
const slug=/^[a-z][a-z0-9-]{1,47}$/;
const required=['schema','id','label','transform','suffix'];
const schema='adamantium.node-factory/1';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export function validateFactoryContract(contract){
  if(!contract||typeof contract!=='object'||Array.isArray(contract)||
    Object.keys(contract).length!==required.length||
    !required.every(key=>own(contract,key)))
    throw new TypeError('invalid_contract_fields');
  if(contract.schema!==schema||typeof contract.id!=='string'||
    !slug.test(contract.id)||contract.id.endsWith('-'))
    throw new TypeError('invalid_factory_contract');
  if(typeof contract.label!=='string'||contract.label.length<1||
    contract.label.length>64||/[\u0000-\u001f<>]/.test(contract.label))
    throw new TypeError('unsafe_node_label');
  if(!['uppercase','suffix'].includes(contract.transform))
    throw new TypeError('unsupported_transform');
  if(typeof contract.suffix!=='string'||contract.suffix.length>32||
    /[\u0000-\u001f]/.test(contract.suffix)||
    (contract.transform==='uppercase'&&contract.suffix!==''))
    throw new TypeError('unsafe_node_suffix');
  return Object.freeze({
    schema:contract.schema,id:contract.id,label:contract.label,
    transform:contract.transform,suffix:contract.suffix
  });
}
export function demoFactoryContract(){
  return {
    schema,id:'demo-uppercase',label:'Adamantium Demo Uppercase',
    transform:'uppercase',suffix:''
  };
}
