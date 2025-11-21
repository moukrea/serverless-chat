/**
 * TypeScript definitions for peer-persistence module
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface StorageConfig {
  KEYS: {
    PEERS_INDEX: string;
    PEER_PREFIX: string;
    METADATA: string;
    ENCRYPTION_KEY: string;
    SCHEMA_VERSION: string;
  };
  MAX_PEERS: number;
  MAX_STORAGE_MB: number;
  CLEANUP_THRESHOLD: number;
  RETENTION: {
    ACTIVE_DAYS: number;
    INACTIVE_DAYS: number;
    FAILED_ATTEMPTS: number;
    BLACKLIST_DURATION: number;
  };
  CURRENT_VERSION: string;
}

export const STORAGE_CONFIG: StorageConfig;

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface PeerConnectionQuality {
  latency: number | null;
  successRate: number;
  connectionType: 'host' | 'srflx' | 'relay' | 'prflx' | null;
  lastMeasured: number;
  totalConnections: number;
  successfulConnections: number;
  avgUptime: number;
}

export interface PeerICECandidate {
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
  type: 'host' | 'srflx' | 'relay' | 'prflx';
}

export interface PeerData {
  peerId: string;
  userId: string;
  displayName: string;
  firstSeen: number;
  lastSeen: number;
  lastConnected: number;
  publicKey: string;
  encryptedSecret?: string;
  sharedSecret?: string;
  lastKnownIP: string | null;
  iceServers: RTCIceServer[];
  cachedCandidates: PeerICECandidate[];
  connectionQuality: PeerConnectionQuality;
  reconnectionAttempts: number;
  blacklistUntil: number | null;
  metadata: Record<string, any>;
  dataVersion: string;
  _qualityScore?: number; // Internal use for queries
}

export interface StorageMetadata {
  lastCleanup: number;
  totalPeers: number;
  estimatedSize: number;
  statistics: {
    totalReconnections: number;
    successfulReconnections: number;
    failedReconnections: number;
  };
}

export interface ReconnectionCandidate {
  peer: PeerData;
  score: number;
  reason: string;
}

export interface QueryOptions {
  sortBy?: 'lastSeen' | 'quality' | 'lastConnected';
  order?: 'asc' | 'desc';
  limit?: number | null;
  minQuality?: number;
  maxAge?: number | null;
  excludeBlacklisted?: boolean;
}

export interface ReconnectionOptions {
  limit?: number;
  maxAge?: number;
}

export interface StorageStats {
  peerCount: number;
  estimatedSizeBytes: number;
  estimatedSizeMB: string;
  maxPeers: number;
  utilizationPercent: string;
  lastCleanup: number;
}

export interface ExportData {
  version: string;
  exportDate: number;
  peers: PeerData[];
}

// =============================================================================
// ENCRYPTION MANAGER
// =============================================================================

export class EncryptionManager {
  constructor();
  getMasterKey(): Promise<CryptoKey>;
  encrypt(plaintext: string): Promise<string>;
  decrypt(encrypted: string): Promise<string | null>;
  clearKey(): void;
}

// =============================================================================
// PEER PERSISTENCE MANAGER
// =============================================================================

export class PeerPersistenceManager {
  constructor();

  // Initialization
  initialize(): Promise<void>;

  // CRUD Operations
  storePeer(peerData: PeerData): Promise<boolean>;
  getPeer(peerId: string): Promise<PeerData | null>;
  removePeer(peerId: string): Promise<boolean>;
  updateLastSeen(peerId: string): Promise<boolean>;
  updateConnectionQuality(peerId: string, quality: Partial<PeerConnectionQuality>): Promise<boolean>;
  incrementReconnectionAttempts(peerId: string): Promise<boolean>;

  // Query Operations
  getAllPeerIds(): Promise<string[]>;
  queryPeers(options?: QueryOptions): Promise<PeerData[]>;
  getReconnectionCandidates(options?: ReconnectionOptions): Promise<ReconnectionCandidate[]>;
  calculateQualityScore(peer: PeerData): number;
  calculateReconnectionScore(peer: PeerData): number;
  getReconnectionReason(peer: PeerData): string;

  // Cleanup Operations
  cleanupStalePeers(): Promise<number>;
  cleanupLRU(count: number): Promise<number>;
  clearExpiredBlacklists(): Promise<number>;

  // Storage Management
  getStorageStats(): Promise<StorageStats>;
  needsCleanup(): Promise<boolean>;

  // Metadata Management
  loadMetadata(): Promise<StorageMetadata>;
  getMetadata(): Promise<StorageMetadata>;
  updateMetadata(updates?: Partial<StorageMetadata>): Promise<void>;

  // Migration & Versioning
  checkAndMigrate(): Promise<void>;
  migrate(fromVersion: string, toVersion: string): Promise<void>;

  // Utility Methods
  clearAll(): Promise<void>;
  exportData(): Promise<ExportData>;
  importData(data: ExportData): Promise<number>;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export interface CreatePeerDataOptions {
  peerId: string;
  userId?: string;
  displayName?: string;
  publicKey: string;
  sharedSecret?: string | null;
  lastKnownIP?: string | null;
  iceServers?: RTCIceServer[];
  cachedCandidates?: PeerICECandidate[];
  connectionQuality?: Partial<PeerConnectionQuality>;
  metadata?: Record<string, any>;
}

export function createPeerData(options: CreatePeerDataOptions): PeerData;

export interface NewMetrics {
  latency?: number | null;
  connectionType?: 'host' | 'srflx' | 'relay' | 'prflx';
  success?: boolean;
  uptime?: number;
}

export function updateQualityMetrics(
  current: PeerConnectionQuality,
  newMetrics: NewMetrics
): PeerConnectionQuality;

// =============================================================================
// DEFAULT EXPORT
// =============================================================================

declare const peerPersistence: PeerPersistenceManager;
export default peerPersistence;
