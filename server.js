// If you are hosting locally, there is no need to use this. Just change the WebSocket link in the tcas.js to use the official PTFS WebSocket or wss://ws.awdevsoftware.org

const express = require("express");
const path = require("path");
const WebSocket = require("ws");

const app = express();


app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(process.env.PORT || 8080, () => {
    console.log("Server running on port", process.env.PORT || 8080);
});

const relay = new WebSocket.Server({ server });


const ptfs = new WebSocket("wss://24data.ptfs.app/wss", {
    headers: {}
});

ptfs.on("open", () => {
    console.log("Server websocket connection attempt made to 24data");
});

ptfs.on("error", (err) => {
    console.error("Oops, restart. Error:", err);
});

ptfs.on("message", (data) => {
    const text = data.toString();

    relay.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(text);
        }
    });
});

relay.on("connection", () => {
    console.log("Server websocket connection established.");
});
