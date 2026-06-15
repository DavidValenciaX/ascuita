import { FastifyPluginAsync } from 'fastify';

type ClientMessage = {
  type?: string;
  payload?: unknown;
};

function safeJsonParse(raw: Buffer): ClientMessage {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return {};
  }
}

function toBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) {
    return raw;
  }

  if (typeof raw === 'string') {
    return Buffer.from(raw);
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw);
  }

  return Buffer.from(String(raw));
}

const liveRoute: FastifyPluginAsync = async fastify => {
  fastify.get(
    '/live',
    { websocket: true },
    (socket, request) => {
      request.log.info('WebSocket client connected to /live');

      socket.send(
        JSON.stringify({
          type: 'connection.ready',
          message: 'Ascuita API WebSocket online. Gemini proxy pending in phase 3.',
        })
      );

      socket.on('message', (raw: unknown) => {
        const message = safeJsonParse(toBuffer(raw));

        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        socket.send(
          JSON.stringify({
            type: 'ack',
            message: 'Message received by backend placeholder.',
            receivedType: message.type || null,
          })
        );
      });

      socket.on('close', () => {
        request.log.info('WebSocket client disconnected from /live');
      });

      socket.on('error', (error: Error) => {
        request.log.error({ err: error }, 'WebSocket error on /live');
      });
    }
  );
};

export default liveRoute;
