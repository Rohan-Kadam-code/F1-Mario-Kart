import { createRoot } from 'react-dom/client';
import { App } from './components/App.jsx';

// StrictMode intentionally disabled — Three.js SceneManager cannot survive
// the double-mount that StrictMode introduces in development.
createRoot(document.getElementById('root')).render(<App />);
