# P2P Mesh Network Chat

A fully decentralized peer-to-peer mesh network chat application with JWT authentication, two-stage peer approval, and automatic token renewal.

## Features

- **Decentralized Architecture**: No central server required - peers connect directly
- **Cryptographic Identity**: ECDH shared secrets and Ed25519 digital signatures
- **Trust On First Use**: Secure peer authentication with persistent trust store
- **WebRTC Connections**: Direct P2P connections with automatic STUN/TURN fallback
- **Mesh Topology**: Peers relay connection information to enable full mesh networking
- **Automatic Reconnection**: Multi-layer reconnection strategy for browser refresh scenarios
- **Markdown Support**: Rich text formatting with live preview

## Live Demo

Visit: https://moukrea.github.io/chat/

## Technology Stack

- **Vite**: Modern build tool
- **SimplePeer**: WebRTC wrapper for peer connections
- **Web Crypto API**: ECDH key exchange, Ed25519 signatures, AES-GCM encryption
- **Vanilla JavaScript**: No framework dependencies
- **Marked**: Markdown parsing
- **DOMPurify**: XSS protection

## Architecture

The codebase is organized into modular components:

- `src/crypto/` - Cryptographic utilities (ECDH, Ed25519, AES-GCM, trust store)
- `src/identity/` - Identity and peer management
- `src/mesh.js` - Mesh network and peer connection management
- `src/router.js` - Message routing with flood algorithm
- `src/reconnection/` - Multi-layer reconnection strategies
- `src/storage/` - LocalStorage persistence with encryption
- `src/app.js` - Main application logic
- `src/ui/` - UI components and DOM manipulation

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

Each peer generates cryptographic keys on first launch:
- **Ed25519 Signing Key**: For digital signatures
- **P-256 ECDH Key**: For shared secret derivation
- **Unique UUID**: Persistent peer identifier

### 2. Initial Connection

Peers connect using QR codes or shared secrets:
1. One peer creates an offer (WebRTC SDP + ICE candidates)
2. Other peer scans QR code or enters secret
3. Answer is generated and exchange completes
4. WebRTC connection established

### 3. Identity Exchange

After WebRTC connection:
1. Peers exchange public keys (Ed25519 + ECDH)
2. Derive shared secret using ECDH
3. Sign messages with Ed25519 for authentication
4. Store peer in encrypted localStorage

### 4. Mesh Networking

Connected peers enable full mesh topology:
- Peers relay WebRTC offers/answers through mutual connections
- Mesh announcements propagate peer presence
- Creates redundant paths for message delivery

### 5. Automatic Reconnection

Multi-layer strategy handles browser refresh:
1. **Recent Peers**: Direct reconnection using cached ICE candidates
2. **Knock Protocol**: Wake NAT bindings with minimal packets
3. **All Known Peers**: Aggressive parallel reconnection
4. **Mesh Relay**: Reconnect via mutual peers (warm start)
5. **Manual Pairing**: Fallback to QR code/secret

## Security Features

- **ECDH Key Exchange**: Shared secrets derived using P-256 elliptic curve
- **Ed25519 Signatures**: All messages cryptographically signed
- **Trust On First Use**: Peers trusted after first successful connection
- **AES-GCM Encryption**: LocalStorage data encrypted at rest
- **Message Authentication**: Digital signatures prevent impersonation
- **XSS Protection**: DOMPurify sanitizes all user-generated content

## Browser Compatibility

Requires modern browser with support for:
- WebRTC
- Web Crypto API (SubtleCrypto)
- LocalStorage
- ES6 Modules

Tested on:
- Chrome 90+
- Firefox 88+
- Edge 90+
- Safari 15+

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
