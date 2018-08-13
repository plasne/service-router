
// includes
import * as fs from "fs";
import * as util from "util";
import axios from "axios";
import { NodeVM, VMScript } from "vm2";
import Endpoints from "./Endpoints";
import Endpoint, { EndpointJSON, EndpointProxy } from "./Endpoint";

// promisify
const readFileAsync = util.promisify(fs.readFile);

export default class Probe {

    private context:      any;
    private processor?:   VMScript;
    private nextTimer?:   NodeJS.Timer;
    private isProcessing: boolean      = false;

    public process() {
        if (this.processor) {
            if (!this.isProcessing) {
                this.isProcessing = true;
                try {

                    // run the processor script
                    //   NOTE: wrapper: "none" // allows return
                    const vm = new NodeVM({
                        sandbox: this.context
                    });
                    vm.run(this.processor);

                } catch (ex) {
                    global.logger.error(`While running probe rules: ${ex}`);
                }
                this.isProcessing = false;
            } else {

                // try again after 1 second
                if (this.nextTimer) clearTimeout(this.nextTimer);
                this.nextTimer = setTimeout(_ => {
                    this.process();
                }, 1000);

            }
        }
    }

    private async pingOne(endpoint: Endpoint, options?: any) {
        const opts = endpoint.generateProbeOptions(options);
        try {
            global.logger.log("info", `probing "${opts.url}"...`);
            const response = await axios(opts);
            if (response.status >= 200 && response.status <= 299) {
                endpoint.stagePingResults(response.status, "up", response.data);
                global.logger.log("info", `probe found "${opts.url}" to be "up".`);
            } else {
                endpoint.stagePingResults(response.status, "down", response.data);
                global.logger.log("info", `probe found "${opts.url}" to be "down" (HTTP status code ${response.status}).`);
            }
        } catch (ex) {
            // ex. ECONNREFUSED
            endpoint.stagePingResults(0, "down", ex);
            global.logger.log("info", `probe found "${opts.url}" to be "down" (${ex}).`);
        }
    }

    private async pingAll(endpoints: Endpoints, options?: any) {
        const groups = endpoints.groupByProbeOptions(options);

        // query the first of each group simultaneously
        const promises: Promise<void>[] = [];
        for (const group of groups) {
            const promise = this.pingOne(group[0], options);
            promises.push(promise);
        }
        await Promise.all(promises);

        // apply across the others in the group
        for (const group of groups) {
            for (let j = 1; j < group.length; j++) {
                group[j].stagePingResults(
                    group[0].code || 0,
                    group[0].actual,
                    group[0].body || ""
                );
            }
        }

    }

    public async load(path: string) {
        try {

            // load the file
            const raw = await readFileAsync(path, { encoding: "utf8" });

            // make an async function that executes immediately
            const wrapped = `(async () => {
                try {
                    ${raw}
                } catch (ex) {
                    console.error(ex);
                }
            })();`
            
            // create it into a script
            this.processor = new VMScript(wrapped, path);

        } catch (ex) {
            // raise error
            console.error(ex);
        }
    }

    constructor() {

        // create the context object
        const bag: any = {};
        this.context = {

            bag: bag,

            define: (obj: EndpointJSON) => {
                const endpoint = global.endpoints.define(obj);
                return (endpoint) ? endpoint.proxy : null;
            },

            ping: async (proxyOrProxies: EndpointProxy | EndpointProxy[], options?: any) => {
                const resolved = global.endpoints.resolve(proxyOrProxies);
                await this.pingAll(resolved, options);
            },

            commit: () => {
                global.endpoints.commit();
            },

            next: (ms: number) => {
                bag.next = new Date(new Date().valueOf() + ms);
                if (this.nextTimer) clearTimeout(this.nextTimer);
                this.nextTimer = setTimeout(_ => {
                    this.process();
                }, ms);
            },

            log: (level: string, message?: string) => {
                if (message) {
                    global.logger.log(level, message);
                } else {
                    global.logger.log("info", level);
                }
            }

        };
        
    }
}