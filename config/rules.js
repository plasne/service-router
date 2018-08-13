
// schedule the next execution
next(10000);

const endpoints = [
    define({
        in: "http://localhost:8080/app",
        out: "http://localhost:8100",
        health: "http://localhost:8100/health",
        weight: 0.1
    }),
    define({
        in: "http://localhost:8080/app",
        out: "http://localhost:8101",
        weight: 0.9
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