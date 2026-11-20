# GENESIS Neural Region Designer R01

Design-only Node-RED palette prototype for the **Dante / GENESIS HQ500M** artificial nervous tissue graph. It does not materialize neurons, run neural simulation, or deploy to the canonical MAS runtime.

## Contents
- Packaged source: [neural-region-designer-r01.zip](../../experiments/genesis/neural-region-designer-r01.zip)
- Node-RED node type: `genesis-neural-region`
- Node palette category: `GENESIS`
- Contract: `mechanicus.neural-region/1`
- Typed projection: Universal Graph IR (experimental adapter)
- Test runner: `npm test` (14 offline tests passed locally on Node 22).

## Supported in R01
- Region cards with layered, sublayered and population-based configuration
- Flexible percentage, absolute and density-based neuron assignment
- Exact integer conservation and automatic share redistribution
- Typed projections distinguishing axons, synaptic contacts and unique neuron pairs
- Biological-spiking, rate-based, ANN and hybrid design profiles
- Genome source/acquired tracks, receptor descriptors and developmental metadata
- Resource estimate distinguishing virtual-address budget from active materialization
- Round-trip conversion to typed Universal Graph IR

## Important limitations
- Editor and serializer **only**: no neural engine, plasticity execution, distributed placement, NeuroML / SONATA import-export or durable genome persistence.
- No full-screen nested graph editor or true 3D; sublayers/population details currently edited via Advanced JSON.
- A virtual address limit of 500M is **not** the number of simulated neurons.
- Biological parameters in examples are experimental, not measured V1 anatomy.
- No dynamic MAS registry discovery yet; this is an independent optional plugin.

## Local installation in an isolated Node-RED Studio
1. Back up `settings.js`, `flows.json`, and the Studio userDir.
2. Download the ZIP from this branch and extract the folder `node-red-contrib-genesis-neural-region`.
3. From the Studio Node-RED userDir, run:
   `npm install --no-save <absolute-path-to-extracted-node-red-contrib-genesis-neural-region>`
4. Restart **only** that isolated Studio, then refresh the editor.
5. In the palette search for `Neural Region`; import `examples/genesis-region-flow.json` into a new tab.
6. Confirm the node publishes `msg.genesis` with `execution: "not-started"` and typed `graph_ir`.

**No production deployment, existing-user flow replacement, or server credential change is included.**
