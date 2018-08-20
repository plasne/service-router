
// schedule the next execution
next(10000);

await listen(8080);
await listen({
    port: 8081,
    cert: "./certificates/star_plasne_com.pem",
    key: "./certificates/star_plasne_com.key"
});

const endpoints = [
    define({
        in: "http://*:8080",
        out: "http://192.168.11.42:8100",
        probe: "http://192.168.11.42:8100/health",
        weight: 0.1,
        waf: "protect"
    }),
    define({
        in: "*:8081",
        out: "http://192.168.11.42:8101",
        weight: 0.9,
        waf: "protect"
    })
]

log("pinging endpoints...");
await ping(endpoints, {
    timeout: 1000
});
commit(endpoints);
/*
for (endpoint of endpoints) {
    endpoint.status = "up";
}
*/

for (const endpoint of endpoints) {
    console.log(`${endpoint.id}: ${endpoint.status}, ${endpoint.body}`);
}

//return "done";