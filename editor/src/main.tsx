import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('index.html has no #root element for the editor to mount into');
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
