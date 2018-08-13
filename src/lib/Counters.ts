
//const _served = new Map();
const _active = new Map();

export default class Counters {
    
    /*
    public served(host: string) {
        return _served.get(host) || 0 as number;
    }
    */

    public active(host: string) {
        return _active.get(host) || 0 as number;
    }

    public open(host: string) {
        //const s = _served.get(host) || 0 as number;
        //_served.set(host, s + 1);
        const a = _active.get(host) || 0 as number;
        _active.set(host, a + 1);
    }

    public close(host: string) {
        const a = _active.get(host) || 1 as number;
        _active.set(host, a - 1);
    }

}