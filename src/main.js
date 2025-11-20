/**
 * Application entry point
 */
import { Buffer } from 'buffer';
import './styles/main.css';
import app from './ui/app.js';

// Polyfill Buffer for WebTorrent
window.Buffer = Buffer;
globalThis.Buffer = Buffer;

// Initialize the application
(async () => {
  try {
    await app.initialize();
    console.log('P2P Mesh Network initialized');
  } catch (error) {
    console.error('Failed to initialize application:', error);
    alert('Failed to initialize application. Please refresh the page.');
  }
})();
