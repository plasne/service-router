
// includes
import cmd = require("commander");
import express = require("express");

// define command line parameters
cmd
    .version("0.1.0")
    .option("-p, --port <integer>", `PORT. The port to host the web services on. Defaults to "8100".`, parseInt)
    .parse(process.argv);

// globals
const PORT          = cmd.port         || process.env.PORT          || 8100;

// log
console.log(`PORT          = "${PORT}"`);

// startup express
const app = express();

app.all("/500", (_, res) => {
    res.status(500).send({
        endpoint: "/500",
        port: PORT
    });
});

app.all("/401", (_, res) => {
    res.status(401).send({
        endpoint: "/500",
        port: PORT
    });
});

app.all("/200", (_, res) => {
    res.send({
        endpoint: "/200",
        port: PORT
    });
});

app.all("/timeout", () => {
    // never send a response
});

app.all("/health", (_, res) => {
    res.send({
        endpoint: "/health",
        port: PORT
    });
});

app.all("/", (_, res) => {
    res.send({
        endpoint: "/",
        port: PORT
    });
});

app.all("/path/subpath", (_, res) => {
    res.send({
        endpoint: "/path/subpath",
        port: PORT
    });
});

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}...`);
});