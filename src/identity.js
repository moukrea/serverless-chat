// Identity Management with localStorage persistence

// Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Human-readable name generation
const ADJECTIVES = [
  'Happy', 'Clever', 'Brave', 'Bright', 'Swift', 'Gentle', 'Noble', 'Wise',
  'Calm', 'Bold', 'Kind', 'Quick', 'Warm', 'Cool', 'Free', 'Pure',
  'Wild', 'Keen', 'Zesty', 'Merry', 'Jolly', 'Proud', 'Lucky', 'Sunny'
];

const ANIMALS = [
  'Penguin', 'Dolphin', 'Eagle', 'Tiger', 'Panda', 'Fox', 'Wolf', 'Bear',
  'Owl', 'Hawk', 'Lion', 'Lynx', 'Otter', 'Seal', 'Whale', 'Falcon',
  'Raven', 'Swan', 'Deer', 'Rabbit', 'Badger', 'Moose', 'Elk', 'Phoenix'
];

function generateDisplayName() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adjective} ${animal}`;
}

class Identity {
  constructor() {
    this.load();
  }

  load() {
    const stored = localStorage.getItem('p2p_identity');
    if (stored) {
      const data = JSON.parse(stored);
      this.uuid = data.uuid;
      this.displayName = data.displayName;
    } else {
      this.uuid = generateUUID();
      this.displayName = generateDisplayName();
      this.save();
    }

    // Load custom peer renames
    const renames = localStorage.getItem('p2p_peer_renames');
    this.peerRenames = renames ? JSON.parse(renames) : {};
  }

  save() {
    localStorage.setItem('p2p_identity', JSON.stringify({
      uuid: this.uuid,
      displayName: this.displayName
    }));
  }

  saveRenames() {
    localStorage.setItem('p2p_peer_renames', JSON.stringify(this.peerRenames));
  }

  setDisplayName(name) {
    this.displayName = name;
    this.save();
  }

  setPeerRename(uuid, customName) {
    if (customName && customName.trim()) {
      this.peerRenames[uuid] = customName.trim();
    } else {
      delete this.peerRenames[uuid];
    }
    this.saveRenames();
  }

  getPeerDisplayName(uuid, defaultName) {
    return this.peerRenames[uuid] || defaultName || uuid.substring(0, 8);
  }

  reset() {
    this.uuid = generateUUID();
    this.displayName = generateDisplayName();
    this.save();
  }
}

export default Identity;
