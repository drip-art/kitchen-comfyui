import { createPrompt, deleteFromQueue, getWidgetLibrary as getWidgets, sendPrompt } from '@/client'
import { retrieveLocalWorkflow, saveLocalWorkflow, writeWorkflowToFile } from '@/persistence'
import { addConnection, addNode, getQueueItems, toPersisted, updateNode } from '@/utils'
import { applyEdgeChanges, applyNodeChanges } from 'reactflow'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { AppState } from './AppState'

const initialState = {
  counter: 0,
  widgets: {},
  graph: {},
  nodes: [],
  edges: [],
  queue: [],
  gallery: [],
  previewedImageIndex: undefined,
  nodeInProgress: undefined,
  promptError: undefined,
  clientId: undefined,
}

export const useAppStore = create<AppState>()(
  devtools((set, get) => ({
    ...initialState,

    onNewClientId: (id) => {
      set({ clientId: id })
    },

    onInit: async () => {
      setInterval(() => get().onPersistLocal(), 5000)

      const widgets = await getWidgets()
      set({ widgets })
      get().onLoadWorkflow(retrieveLocalWorkflow() ?? { data: {}, connections: [] })
    },

    /******************************************************
     *********************** Node *************************
     ******************************************************/

    onNodesChange: (changes) => {
      set((st) => ({ nodes: applyNodeChanges(changes, st.nodes) }))
    },

    onUpdateNodes: (id, data) => {
      set((st) => ({ nodes: updateNode(id, data, st.nodes) }))
    },

    onAddNode: (nodeItem) => {
      set((st) => addNode(st, nodeItem))
    },

    onDeleteNode: (id) => {
      set(({ graph: { [id]: _toDelete }, nodes }) => ({
        // graph, // should work but currently buggy
        nodes: applyNodeChanges([{ type: 'remove', id }], nodes),
      }))
    },

    onDuplicateNode: (id) => {
      set((st) => {
        const item = st.graph[id]
        const node = st.nodes.find((n) => n.id === id)
        const position = node?.position
        const moved = position !== undefined ? { ...position, y: position.y + 100 } : undefined
        return addNode(st, { widget: st.widgets[item.widget], node: item, position: moved })
      })
    },

    onNodeInProgress: (id, progress) => {
      set({ nodeInProgress: { id, progress } })
    },

    onPropChange: (id, key, val) => {
      set((state) => ({
        graph: {
          ...state.graph,
          [id]: {
            ...state.graph[id],
            fields: {
              ...state.graph[id]?.fields,
              [key]: val,
            },
          },
        },
      }))
    },

    /******************************************************
     *********************** Edges *************************
     ******************************************************/

    onEdgesChange: (changes) => {
      set((st) => ({ edges: applyEdgeChanges(changes, st.edges) }))
    },

    /******************************************************
     ********************* Connection ***********************
     ******************************************************/

    onConnect: (connection) => {
      set((st) => addConnection(st, connection))
    },

    /******************************************************
     *********************** Image *************************
     ******************************************************/

    onImageSave: (id, images) => {
      set((st) => ({
        gallery: st.gallery.concat(images.map((image) => ({ image }))),
        graph: {
          ...st.graph,
          [id]: { ...st.graph[id], images },
        },
      }))
    },

    onPreviewImage: (index) => {
      set({ previewedImageIndex: index })
    },

    /******************************************************
     *********************** Queue *************************
     ******************************************************/

    onSubmit: async () => {
      const state = get()
      const graph = toPersisted(state)
      const res = await sendPrompt(createPrompt(graph, state.widgets, state.clientId))
      set({ promptError: res.error })
    },

    onDeleteFromQueue: async (id) => {
      await deleteFromQueue(id)
      await get().onQueueUpdate()
    },

    onQueueUpdate: async () => {
      set({ queue: await getQueueItems(get().clientId) })
    },

    /******************************************************
     ***************** Workflow && Persist*******************
     ******************************************************/

    onPersistLocal: () => {
      saveLocalWorkflow(toPersisted(get()))
    },

    onLoadWorkflow: (workflow) => {
      set((st) => {
        let state: AppState = { ...st, nodes: [], edges: [], counter: 0, graph: {} }
        for (const [key, node] of Object.entries(workflow.data)) {
          const widget = state.widgets[node.value.widget]
          if (widget !== undefined) {
            state = addNode(state, {
              widget,
              node: node.value,
              position: node.position,
              key: parseInt(key),
            })
          } else {
            console.warn(`Unknown widget ${node.value.widget}`)
          }
        }
        for (const connection of workflow.connections) {
          state = addConnection(state, connection)
        }
        return state
      }, true)
    },

    onSaveWorkflow: () => {
      writeWorkflowToFile(toPersisted(get()))
    },
  }))
)
