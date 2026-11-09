// Development token server for the walkie-talkie. Run with: npm run voice:token
//
// Anyone who can reach this port gets a token for any room, so use it on a trusted
// network only. Production needs an endpoint that checks who the user is first.
import { createServer } from 'node:http';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
const PORT = Number(process.env.LIVEKIT_TOKEN_PORT || 8787);
const MAX_BODY_BYTES = 4096;

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
  console.error(
    'Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET and LIVEKIT_URL in .env (see .env.example).'
  );
  process.exit(1);
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) throw new Error('Request body too large');
  }
  return JSON.parse(body);
}

function respond(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/token') {
    respond(response, 404, { error: 'Use POST /token' });
    return;
  }

  try {
    const { room_name, participant_identity, participant_name } =
      await readJson(request);
    if (!room_name || !participant_identity) {
      respond(response, 400, {
        error: 'room_name and participant_identity are required',
      });
      return;
    }

    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participant_identity,
      name: participant_name,
      ttl: '6h',
    });
    token.addGrant({
      roomJoin: true,
      room: room_name,
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      canPublishSources: [TrackSource.MICROPHONE],
    });

    respond(response, 200, {
      server_url: LIVEKIT_URL,
      participant_token: await token.toJwt(),
    });
  } catch (error) {
    respond(response, 400, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`LiveKit token server: http://0.0.0.0:${PORT}/token`);
});
