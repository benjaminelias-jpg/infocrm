import '../../web/src/index.css';

export const metadata = { title: 'InfoCRM' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('infocrm_tema');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
      </head>
      <body><div id="root">{children}</div></body>
    </html>
  );
}
