'use client';
import dynamic from 'next/dynamic';

// La app del CRM es una SPA (React Router): se muestra solo en el navegador.
const App = dynamic(() => import('../../../web/src/App'), { ssr: false });

export default function Pagina() {
  return <App />;
}
