import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/plus-jakarta-sans';
import './index.css';

const guardado = localStorage.getItem('infocrm_tema');
if (guardado) document.documentElement.setAttribute('data-theme', guardado);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
