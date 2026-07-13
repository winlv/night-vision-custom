
// Webworker interface

import Utils from '../../stuff/utils.js'
import WebWorker from './worker.js?worker&inline'

class WebWork {

    constructor(id, chart) {
        this.chart = chart
        this.tasks = {}
        this.onevent = () => {}
        this.start()
    }

    start() {
        if (this.worker) this.worker.terminate()
        this.stopped = false
        this.worker = new WebWorker()
        //this.worker = new Worker(new URL('./worker.js', import.meta.url), {
        //    type: 'module',
        //})
        this.worker.onmessage = e => this.onmessage(e)
    }

    // TODO: Do we need this ???
    startSocket() {
        /*if (!this.dc.sett.node_url) return
        this.socket = new WebSocket(this.dc.sett.node_url)
        this.socket.addEventListener('message', e => {
            this.onmessage({data: JSON.parse(e.data)})
        })
        this.msg_queue = []*/
    }

    send(msg, txKeys) {
        /*if (this.dc.sett.node_url) {
            return this.sendToNode(msg, txKeys)
        }*/
        if (txKeys) {
            let txObjs = txKeys.map(k => msg.data[k])
            this.worker.postMessage(msg, txObjs)
        } else {
            this.worker.postMessage(msg)
        }
    }

    // Send to node.js via websocket
    sendToNode(msg, txKeys) {
        /*if (!this.socket) this.start_socket()
        if (this.socket && this.socket.readyState) {
            // Send the old messages first
            while(this.msg_queue.length) {
                let m = this.msg_queue.shift()
                this.socket.send(JSON.stringify(m))
            }
            this.socket.send(JSON.stringify(msg))
        } else {
            this.msg_queue.push(msg)
        }*/
    }

    onmessage(e) {
        if (e.data.id in this.tasks) {
            this.tasks[e.data.id](e.data.data)
            delete this.tasks[e.data.id]
        } else {
            this.onevent(e)
        }
    }

    // Execute a task
    async exec(type, data, txKeys) {
        return new Promise((rs, rj) => {
            let id = Utils.uuid()
            this.send({ type, id, data }, txKeys)
            this.tasks[id] = res => {
                rs(res)
            }
        })
    }

    // Execute a task, but just fucking do it,
    // do not wait for the result
    just(type, data, txKeys) {
        let id = Utils.uuid()
        this.send({ type, id, data }, txKeys)
    }

    // Relay an event from iframe postMessage
    // (for the future)
    async relay(event, just = false) {
        return new Promise((rs, rj) => {
            this.send(event, event.txKeys)
            if (!just) {
                this.tasks[event.id] = res => {
                    rs(res)
                }
            }
        })
    }

    stop() {
        if (this.worker) this.worker.terminate()
        this.stopped = true
    }
}


let instances = {}

function instance(id, chart) {
    if (!instances[id]) {
        instances[id] = new WebWork(id, chart)
    } else {
        // Singleton outlives NightVision instances: refresh the chart ref and
        // revive the worker if a previous chart.destroy() terminated it —
        // otherwise a chart re-created with the same id gets a dead script
        // engine (overlays never execute).
        if (chart) instances[id].chart = chart
        if (instances[id].stopped) instances[id].start()
    }
    return instances[id]
}

export default { instance }
