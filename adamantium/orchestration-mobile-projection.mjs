/**
 * R04: project a validated orchestration DAG into the R03 mobile UI ABI.
 * Never embeds backend endpoints, credentials or executable Node-RED flows.
 */
import { validateOrchestrationView } from "./orchestration-view-contract.mjs";
import { UI_SCHEMA, UI_TARGET, validateMobileUI } from "./mobile-ui-contract.mjs";

export function projectOrchestrationMobileUI(snapshot) {
  const view = validateOrchestrationView(snapshot);
  const document = {
    schema: UI_SCHEMA,
    target: UI_TARGET,
    revision: view.revision,
    dataBindings: {
      providers: [
        {id:"orchestration.tasks",source:"typed-snapshot"},
        {id:"orchestration.providers",source:"typed-snapshot"},
        {id:"orchestration.summary",source:"typed-snapshot"},
      ]
    },
    screens:[
      {id:"workbench",title:"Задачи и агенты",tree:{
        id:"workbench.root",type:"column",children:[
          {id:"workbench.heading",type:"heading",label:"Фабрика задач"},
          {id:"workbench.authority",type:"status",label:"Управление — Graph Manager",dataRef:"orchestration.summary"},
          {id:"workbench.tasks",type:"task-tree",dataRef:"orchestration.tasks"},
          {id:"workbench.agents",type:"module-list",label:"Исполнители",dataRef:"orchestration.providers"},
        ]}},
      {id:"diagnostics",title:"Диагностика",tree:{
        id:"diagnostics.root",type:"column",children:[
          {id:"diagnostics.heading",type:"heading",label:"Состояние и блокеры"},
          {id:"diagnostics.summary",type:"status",dataRef:"orchestration.summary"},
          {id:"diagnostics.providers",type:"module-list",dataRef:"orchestration.providers"},
          {id:"diagnostics.tasks",type:"task-tree",dataRef:"orchestration.tasks"},
        ]}}
    ],
    navigation:[
      {screen:"workbench",label:"Задачи"},
      {screen:"diagnostics",label:"Диагностика"}
    ]
  };
  // Hard-fail if any output is outside the already installed UI interpreter.
  validateMobileUI(document,{availableCapabilities:[]});
  return Object.freeze({
    document,
    data: Object.freeze({
      "orchestration.summary":Object.freeze({
        graphRevision:view.revision,authorityProviderId:view.authorityProviderId,
        taskCounts:view.taskCounts,readOnly:true
      }),
      "orchestration.tasks":view.tasks,
      "orchestration.providers":view.providers,
    }),
    backendMutationsAuthorized:false,
  });
}
