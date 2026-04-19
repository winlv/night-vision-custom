import debounce from 'lodash/debounce';
import FrameAnimation from "../../stuff/frame.js";
import Utils from "../../stuff/utils.js";
import math from "../../stuff/math.js";
import Events from "../events.js";
import DataHub from "../dataHub.js";
import MetaHub from "../metaHub.js";

const soon = (function () {
    var c = [];
    function b() {
        while (c.length) {
            var d = c[0];
            d.f.apply(d.m, d.a);
            c.shift();
        }
    }
    var a = (function () {
        if (typeof MutationObserver !== "undefined") {
            var d = document.createElement("div");
            return function (e) {
                var f = new MutationObserver(function () {
                    f.disconnect();
                    e();
                });
                f.observe(d, {attributes: true});
                d.setAttribute("a", 0);
            };
        }
        if (typeof setImmediate !== "undefined") {
            return setImmediate;
        }
        return function (e) {
            soon(e, 0);
        };
    })();
    return function (d) {
        c.push({f: d, a: [].slice.apply(arguments).splice(1), m: this});
        if (c.length === 1) {
            a(b);
        }
    };
})();

export default class Input {

    constructor() {
        this.rangeUpdateNeeded = false;
        this.rangeToUpdate = null;
        this.debouncedMousedrag = soon.bind(this, debounce(this.mousedrag.bind(this), 5));
    }

    async setup(comp) {
        this.ZOOM_SENS_X = comp.props.config.ZOOM_X_SENS;
        this.ZOOM_SENS_Y = comp.props.config.ZOOM_Y_SENS;
        this.MIN_ZOOM = comp.props.config.MIN_ZOOM;
        this.MAX_ZOOM = comp.props.config.MAX_ZOOM;
        this.canvas = comp.canvas;
        this.ctx = comp.ctx;
        this.props = comp.props;
        this.layout = comp.layout;
        this.rrId = comp.rrUpdId;
        this.gridUpdId = comp.gridUpdId;
        this.gridId = comp.id;
        this.cursor = {};
        this.oldMeta = {};
        this.range = this.props.range;
        this.interval = this.props.interval;
        this.offsetX = 0;
        this.offsetY = 0;
        this.deltas = 0;
        this.wmode = this.props.config.SCROLL_WHEEL;
        this.lastZoomTime = 0;

        this.hub = DataHub.instance(this.props.id);
        this.meta = MetaHub.instance(this.props.id);
        this.events = Events.instance(this.props.id);

        this.events.on("app:range-changed", e => this.range = e);

        await this.listeners();
        this.mouseEvents("addEventListener");
    }

    mouseEvents(cmd) {
        ["mousemove", "mouseout", "mouseup", "mousedown", "click"].forEach((e) => {
            if (cmd === "addEventListener") {
                this["_" + e] = this[e].bind(this);
            }
            this.canvas[cmd](e, this["_" + e]);
        });
    }

    async listeners() {
        const Hamster = await import("hamsterjs");
        const Hammer = await import("hammerjs");

        this.hm = Hamster.default(this.canvas);
        this.hm.wheel((event, delta) => this.mousezoom(-delta * 50, event));

        let mc = (this.mc = new Hammer.Manager(this.canvas));
        mc.add(new Hammer.Pan({ threshold: 0 }));
        mc.add(new Hammer.Tap());
        mc.add(new Hammer.Pinch({ threshold: 0 }));
        mc.get("pinch").set({ enable: true });
        if (Utils.isMobile) mc.add(new Hammer.Press());

        mc.on("panstart", (event) => {
            // Перемещаем расчет drug выше проверки на aim,
            // чтобы перетаскивание работало в любом случае
            let scaleId = this.layout.scaleIndex;
            let tfrm = this.meta.getYtransform(this.gridId, scaleId);
            this.drug = {
                x: event.center.x + this.offsetX,
                y: event.center.y + this.offsetY,
                r: this.range.slice(),
                t: this.range[1] - this.range[0],
                o: tfrm ? tfrm.offset || 0 : 0,
                y_r: tfrm && tfrm.range ? tfrm.range.slice() : undefined,
                B: this.layout.B,
                t0: Utils.now(),
            };

            this.events.emit("cursor-changed", {
                gridId: this.gridId,
                x: event.center.x + this.offsetX,
                y: event.center.y + this.offsetY,
            });

            if (Utils.isMobile) {
                this.calcOffset();
                this.propagate('mousedown', this.touch2mouse(event));
            }

            if (this.cursor.mode === "aim") {
                this.emitCursorCoord(event);
            }
        });

        mc.on("panmove", (event) => {
            if (Utils.isMobile) {
                this.calcOffset();
                this.events.emit('cursor-changed', {
                    gridId: this.gridId,
                    x: event.center.x + this.offsetX,
                    y: event.center.y + this.offsetY
                });
                this.propagate("mousemove", this.touch2mouse(event));
            }

            if (this.drug) {
                if (Utils.isMobile) {
                    this.handleMousedrag(this.drug.x + event.deltaX, this.drug.y + event.deltaY);
                } else {
                    this.mousedrag(this.drug.x + event.deltaX, this.drug.y + event.deltaY);
                }
            } else if (this.cursor.mode === "aim") {
                this.emitCursorCoord(event);
            }
        });

        mc.on("panend", (event) => {
            // if (Utils.isMobile && this.drug) this.panFade(event);
            this.drug = null;
            if (Utils.isMobile) {
                this.calcOffset();
                this.propagate('mouseup', this.touch2mouse(event));
            }
        });

        mc.on("tap", (event) => {
            if (!Utils.isMobile) return;
            this.simMousedown(event);
            if (this.fade) this.fade.stop();
            this.events.emit("cursor-changed", { mode: "explore" });
            this.events.emitSpec(this.rrId, "update-rr");
        });

        mc.on("pinchstart", () => {
            this.drug = null;
            let scaleId = this.layout.scaleIndex;
            let tfrm = this.meta.getYtransform(this.gridId, scaleId);
            this.pinch = {
                t: this.range[1] - this.range[0],
                r: this.range.slice(),
                y_r: tfrm && tfrm.range ? tfrm.range.slice() : null
            };
        });

        mc.on("pinchend", () => { this.pinch = null; });
        mc.on("pinch", (event) => { if (this.pinch) this.pinchZoom(event.scale); });

        mc.on("press", (event) => {
            if (!Utils.isMobile) return;
            if (this.fade) this.fade.stop();
            this.calcOffset();
            this.emitCursorCoord(event, {mode: "aim"});
            setTimeout(() => this.events.emitSpec(this.rrId, "update-rr"));
            this.simMousedown(event);
        });
    }

    gesturestart(event) { event.preventDefault(); }
    gesturechange(event) { event.preventDefault(); }
    gestureend(event) { event.preventDefault(); }

    mousemove(event) {
        if (Utils.isMobile) return;
        this.events.emit("cursor-changed", {
            visible: true,
            gridId: this.gridId,
            x: event.layerX,
            y: event.layerY - 1,
        })
        this.calcOffset();
        this.propagate("mousemove", event);
    }

    mouseout(event) {
        if (Utils.isMobile) return;
        this.events.emit("cursor-changed", {visible: false});
        this.propagate("mouseout", event);
    }

    mouseup(event) {
        this.drug = null;
        this.events.emit("cursor-locked", false);
        this.propagate("mouseup", event);
    }

    mousedown(event) {
        if (Utils.isMobile) return;
        this.events.emit("cursor-locked", true);
        this.propagate("mousedown", event);
        if (event.defaultPrevented) return;
        this.events.emit("grid-mousedown", [this.gridId, event]);
    }

    simMousedown(event) {
        if (event.srcEvent.defaultPrevented) return;
        this.events.emit("grid-mousedown", [this.gridId, event]);
        this.propagate("mousemove", this.touch2mouse(event));
        this.events.emitSpec(this.rrId, "update-rr");
        this.propagate("mousedown", this.touch2mouse(event));
        setTimeout(() => this.propagate("click", this.touch2mouse(event)));
    }

    panFade(event) {
        // let dt = Utils.now() - this.drug.t0;
        // let dx = this.range[1] - this.drug.r[1];
        // let v = (42 * dx) / dt;
        // let v0 = Math.abs(v * 0.01);
        // if (dt > 500) return;
        // if (this.fade) this.fade.stop();
        // this.fade = new FrameAnimation((self) => {
        //     v *= 0.85;
        //     if (Math.abs(v) < v0) {
        //         self.stop();
        //     }
        //     this.range[0] += v;
        //     this.range[1] += v;
        //     this.changeRange();
        // });
    }

    touch2mouse(e) {
        this.calcOffset();
        return {
            original: e.srcEvent,
            layerX: e.center.x + this.offsetX,
            layerY: e.center.y + this.offsetY,
            preventDefault: function () { this.original.preventDefault(); },
        };
    }

    click(event) { this.propagate("click", event); }

    emitCursorCoord(event, add = {}) {
        this.events.emit("cursor-changed", Object.assign({
            gridId: this.gridId,
            x: event.center.x + this.offsetX,
            y: event.center.y + this.offsetY,
        }, add));
    }

    calcOffset() {
        let rect = this.canvas.getBoundingClientRect();
        this.offsetX = -rect.x;
        this.offsetY = -rect.y;
    }

    mousezoom(delta, event) {
        if (this.meta.scrollLock) return;

        const now = performance.now();
        if (now - this.lastZoomTime < 16) return;
        this.lastZoomTime = now;

        if (this.wmode !== "pass") {
            if (this.wmode === "click" && !this.oldMeta.activated) return;
            event.originalEvent.preventDefault();
            event.preventDefault();
        }

        event.deltaX = event.deltaX || Utils.getDeltaX(event);
        event.deltaY = event.deltaY || Utils.getDeltaY(event);

        if (Math.abs(event.deltaX) > 0) {
            this.trackpad = true;
            this.trackpadScroll(event);
            return;
        }

        delta = Utils.smartWheel(delta);
        let data = this.hub.mainOv.dataSubset;
        const dpr = window.devicePixelRatio ?? 1;

        let k = this.interval / 1000;
        let diffX = delta * k * data.length * this.ZOOM_SENS_X;

        let ratio = 0.5;
        if (event.originalEvent.ctrlKey || this.props.config.ZOOM_MODE === "tl") {
            let offset = event.originalEvent.offsetX;
            ratio = offset / (this.canvas.width / dpr - 1);
        }

        let newRange = [
            this.range[0] - diffX * ratio,
            this.range[1] + diffX * (1 - ratio)
        ];

        let newWidth = newRange[1] - newRange[0];
        const maxW = this.MAX_ZOOM * this.interval;
        const minW = this.MIN_ZOOM * this.interval;

        if (newWidth > maxW) {
            let over = newWidth - maxW;
            newRange[0] += over * ratio;
            newRange[1] -= over * (1 - ratio);
        } else if (newWidth < minW) {
            let under = minW - newWidth;
            newRange[0] -= under * ratio;
            newRange[1] += under * (1 - ratio);
        }

        this.range[0] = newRange[0];
        this.range[1] = newRange[1];

        let scaleId = this.layout.scaleIndex;
        let tfrm = this.meta.getYtransform(this.gridId, scaleId);
        if (tfrm && tfrm.range) {
            let yRange = tfrm.range.slice();
            let yLen = yRange[1] - yRange[0];
            let factor = 1 + (delta * 0.001 * this.ZOOM_SENS_Y);
            let newYRange = [
                yRange[0] + (yLen * (1 - factor)) * 0.5,
                yRange[1] - (yLen * (1 - factor)) * 0.5
            ];
            this.events.emit('sidebar-transform', {
                gridId: this.gridId,
                scaleId: scaleId,
                range: newYRange,
                auto: false
            });
        }

        this.changeRange();
    }

    mousedrag(x, y) {
        if (this.meta.scrollLock || !this.drug) return;

        let dt = this.drug.t * (this.drug.x - x) / this.layout.width;
        let d$ = this.layout.$hi - this.layout.$lo;
        d$ *= (this.drug.y - y) / this.layout.height;
        let offset = this.drug.o + d$;
        let ls = this.layout.settings.logScale;

        let range;
        if (ls && this.drug.y_r) {
            let dy = this.drug.y - y;
            range = this.drug.y_r.slice();
            range[0] = math.exp((0 - this.drug.B + dy) / this.layout.A);
            range[1] = math.exp((this.layout.height - this.drug.B + dy) / this.layout.A);
        }

        let scaleId = this.layout.scaleIndex;
        let yTransform = this.meta.getYtransform(this.gridId, scaleId);
        if (this.drug.y_r && yTransform && !yTransform.auto) {
            this.events.emit('sidebar-transform', {
                gridId: this.gridId,
                scaleId: scaleId,
                range: ls ? (range || this.drug.y_r) : [
                    this.drug.y_r[0] - offset,
                    this.drug.y_r[1] - offset,
                ]
            });
        }

        this.range[0] = this.drug.r[0] + dt;
        this.range[1] = this.drug.r[1] + dt;

        requestAnimationFrame(() => this.changeRange());
    }

    handleMousedrag(x, y) { this.debouncedMousedrag(x, y); }

    pinchZoom(scale) {
        if (this.meta.scrollLock || !this.pinch) return;

        let t = this.pinch.t;
        let nt = t / scale;

        // Ограничиваем nt
        const maxW = this.MAX_ZOOM * this.interval;
        const minW = this.MIN_ZOOM * this.interval;

        if (nt > maxW) nt = maxW;
        if (nt < minW) nt = minW;

        this.range[0] = this.pinch.r[0] - (nt - t) * 0.5;
        this.range[1] = this.pinch.r[1] + (nt - t) * 0.5;

        let scaleId = this.layout.scaleIndex;
        if (this.pinch.y_r) {
            let yR = this.pinch.y_r;
            let yLen = yR[1] - yR[0];
            let nyLen = yLen / scale;

            this.events.emit('sidebar-transform', {
                gridId: this.gridId,
                scaleId: scaleId,
                range: [
                    yR[0] - (nyLen - yLen) * 0.5,
                    yR[1] + (nyLen - yLen) * 0.5
                ],
                auto: false
            });
        }

        this.changeRange();
    }

    trackpadScroll(event) {
        if (this.meta.scrollLock) return;
        let dt = this.range[1] - this.range[0];
        this.range[0] += event.deltaX * dt * 0.011;
        this.range[1] += event.deltaX * dt * 0.011;
        this.changeRange();
    }

    changeRange() {
        let data = this.hub.mainOv.data;
        if (!this.range.length || data.length < 2) return;

        let l = data.length - 1;
        let range = this.range;
        let layout = this.layout;

        let minRange = layout.ti(data[l][0], l) - this.interval * 5.5;
        let maxRange = layout.ti(data[0][0], 0) + this.interval * 5.5;

        if ((range[0] <= minRange && range[1] <= maxRange) || (range[0] >= minRange && range[1] >= maxRange)) {
            return; // Можно разблокировать, если нужно жесткое ограничение
        }

        this.rangeUpdateNeeded = true;
        this.rangeToUpdate = range;

        if (!this.frameRequested) {
            this.frameRequested = true;
            requestAnimationFrame(() => this.emitRangeChange());
        }
    }

    emitRangeChange() {
        if (this.rangeUpdateNeeded) {
            this.events.emit("range-changed", this.rangeToUpdate);
            this.rangeUpdateNeeded = false;
            this.rangeToUpdate = null;
        }
        this.frameRequested = false;
    }

    propagate(name, event) {
        this.events.emitSpec(this.gridUpdId, "propagate", { name, event });
    }

    destroy() {
        let rm = this.canvas.removeEventListener;
        rm("gesturestart", this.gesturestart);
        rm("gesturechange", this.gesturechange);
        rm("gestureend", this.gestureend);
        if (this.mc) this.mc.destroy();
        if (this.hm) this.hm.unwheel();
        this.mouseEvents("removeEventListener");
    }
}