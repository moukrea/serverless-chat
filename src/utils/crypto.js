/**
 * Cryptographic utilities for JWT signing and verification
 */

export const generateKeyPair = async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return { publicKey, privateKey };
};

export const signJWT = async (payload, privateKeyJWK) => {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJWK,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const header = { alg: 'ES256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(data)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${data}.${encodedSignature}`;
};

export const verifyJWT = async (token, publicKeyJWK) => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJWK,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    const data = `${parts[0]}.${parts[1]}`;
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      new TextEncoder().encode(data)
    );

    if (!valid) throw new Error('Invalid signature');

    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (e) {
    console.error('JWT verification failed:', e);
    return null;
  }
};

export const decodeJWT = (token) => {
  try {
    const parts = token.split('.');
    return JSON.parse(atob(parts[1]));
  } catch (e) {
    return null;
  }
};

export const createInfoHash = async (passphrase) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(passphrase + '-p2pmesh-v3');
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};
