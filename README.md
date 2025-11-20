# P2P Mesh Network Chat

A fully decentralized peer-to-peer mesh network chat application with JWT authentication, two-stage peer approval, and automatic token renewal.

## Features

- **Decentralized Architecture**: No central server required - peers discover and connect directly
- **JWT Authentication**: Each peer has cryptographically signed tokens for secure identity verification
- **Two-Stage Approval**: New peers go through probation before gaining full network access
- **DHT Discovery**: Uses WebTorrent DHT for peer discovery
- **WebRTC Connections**: Direct P2P connections with automatic STUN/TURN fallback
- **Mesh Topology**: Peers relay connection information to enable full mesh networking
- **Token Auto-Renewal**: Tokens automatically refresh before expiration
- **Verification Chat**: Separate channel for verifying new peers

## Live Demo

Visit: https://moukrea.github.io/chat/

## Technology Stack

- **Vite**: Modern build tool
- **SimplePeer**: WebRTC wrapper for peer connections
- **WebTorrent**: DHT-based peer discovery
- **Web Crypto API**: JWT signing and verification
- **Vanilla JavaScript**: No framework dependencies

## Architecture

The codebase is organized into modular components:

- `src/utils/crypto.js` - Cryptographic utilities (JWT signing/verification, hashing)
- `src/core/identity.js` - Identity and token management
- `src/core/peer.js` - Peer connection management
- `src/core/dht.js` - DHT-based peer discovery
- `src/core/messages.js` - Message handling and routing
- `src/ui/app.js` - Main UI application logic
- `src/ui/dom.js` - DOM manipulation helpers

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## How It Works

### 1. Identity Generation

Each peer generates an ECDSA P-256 key pair and creates self-signed JWT tokens:
- **Access Token**: Valid for 6 hours, used for peer authentication
- **Refresh Token**: Valid for 7 days, used for token renewal

### 2. Peer Discovery

Peers join a swarm using a shared passphrase:
1. Passphrase is hashed to create a DHT infohash
2. Peers announce themselves via WebTorrent DHT
3. When peers discover each other, they exchange identity information

### 3. Verification Process

New peers go through a two-stage approval:
1. **Probation**: Existing members grant initial access for verification
2. **Full Access**: After verification, peers gain full mesh access

### 4. Mesh Networking

Connected peers share their peer lists, enabling indirect connections:
- Peers relay WebRTC offers/answers through mutual connections
- Creates a full mesh topology where everyone can connect to everyone

### 5. Token Management

Tokens are automatically refreshed:
- When an access token has < 2 hours remaining, it's renewed
- New tokens are broadcast to all connected peers
- Expired tokens have a 1-hour grace period

## Security Features

- End-to-end JWT verification using ECDSA signatures
- Public keys are exchanged during initial handshake
- Tokens are verified against peer's public key
- Probation system prevents unauthorized access
- Token expiration and automatic renewal

## Browser Compatibility

Requires modern browser with support for:
- WebRTC
- Web Crypto API
- WebTorrent (IndexedDB, Service Workers)

Tested on:
- Chrome 90+
- Firefox 88+
- Edge 90+
- Safari 15+

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
