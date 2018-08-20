
import Listener, { ListenerJSON } from "./Listener";

export default class Listeners extends Array<Listener> {

    public async add(obj: ListenerJSON) {
        try {

            // see if it already exists
            const exists = this.find(existing => existing.port === obj.port);
            if (exists) return;
            // TODO: support changing the certificate

            // create and start listening
            const listener = new Listener(obj);
            await listener.open();

            // add it to the list
            this.push(listener);
            global.logger.log("info", `proxying protocol "${listener.protocol}" on port "${listener.port}"...`);

        } catch (ex) {
            global.logger.error(`failed to proxy port "${obj.port}"...`);
            global.logger.error(ex);
        }
    }

}