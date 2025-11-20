/**
 * Application entry point
 */
import './styles/main.css';
import app from './ui/app.js';

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
