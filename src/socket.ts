#!/usr/bin/env bun

import { Server, ServerWebSocket } from "bun";

// Store clients by channel
const channels = new Map<string, Set<ServerWebSocket<any>>>();

function handleConnection(ws: ServerWebSocket<any>) {
  // Don't add to clients immediately - wait for channel join
  console.log("New client connected");

  // Send welcome message to the new client
  ws.send(JSON.stringify({
    type: "system",
    message: "Please join a channel to start chatting",
  }));
}

const server = Bun.serve({
  port: 3055,
  // 내 컴퓨터에서만 접속을 받는다(기본값은 같은 네트워크 전체에 열림).
  // Windows WSL 에서 쓸 땐 "0.0.0.0" 으로 바꾼다
  hostname: "127.0.0.1",
  fetch(req: Request, server: Server) {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // Handle WebSocket upgrade
    const success = server.upgrade(req, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });

    if (success) {
      return; // Upgraded to WebSocket
    }

    // Return response for non-WebSocket requests
    return new Response("WebSocket server running", {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
  websocket: {
    open: handleConnection,
    message(ws: ServerWebSocket<any>, message: string | Buffer) {
      try {
        const data = JSON.parse(message as string);
        if (data.message?.command) {
          console.log(`Command: ${data.message.command} (${data.channel})`);
        }

        if (data.type === "join") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            return;
          }

          // Create channel if it doesn't exist
          if (!channels.has(channelName)) {
            channels.set(channelName, new Set());
          }

          // Add client to channel
          const channelClients = channels.get(channelName)!;
          channelClients.add(ws);

          console.log(`\n✓ Client joined channel "${channelName}" (${channelClients.size} total clients)`);

          // Notify client they joined successfully
          ws.send(JSON.stringify({
            type: "system",
            message: `Joined channel: ${channelName}`,
            channel: channelName
          }));

          ws.send(JSON.stringify({
            type: "system",
            message: {
              id: data.id,
              result: "Connected to channel: " + channelName,
            },
            channel: channelName
          }));

          // Notify other clients in channel
          channelClients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                type: "system",
                message: "A new user has joined the channel",
                channel: channelName
              }));
            }
          });
          return;
        }

        // Handle regular messages
        if (data.type === "message") {
          const channelName = data.channel;
          if (!channelName || typeof channelName !== "string") {
            ws.send(JSON.stringify({
              type: "error",
              message: "Channel name is required"
            }));
            return;
          }

          const channelClients = channels.get(channelName);
          if (!channelClients || !channelClients.has(ws)) {
            ws.send(JSON.stringify({
              type: "error",
              message: "You must join the channel first"
            }));
            return;
          }

          // Broadcast to all OTHER clients in the channel (not the sender)
          // This prevents echo and ensures proper request-response flow
          let broadcastCount = 0;
          channelClients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              broadcastCount++;
              const broadcastMessage = {
                type: "broadcast",
                message: data.message,
                sender: "peer",
                channel: channelName
              };
              client.send(JSON.stringify(broadcastMessage));
            }
          });
          
          if (broadcastCount === 0) {
            console.log(`⚠️  No other clients in channel "${channelName}" to receive message!`);
          }
        }

        // Forward progress_update messages to the MCP server so it can reset
        if (data.type === "progress_update") {
          const channelName = data.channel;
          if (!channelName) return;

          const channelClients = channels.get(channelName);
          if (!channelClients || !channelClients.has(ws)) return;

          channelClients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(data));
            }
          });
        }
      } catch (err) {
        console.error("Error handling message:", err);
      }
    },
    close(ws: ServerWebSocket<any>) {
      // Remove client from their channel
      channels.forEach((clients) => {
        clients.delete(ws);
      });
    }
  }
});

console.log(`WebSocket server running on port ${server.port}`);
