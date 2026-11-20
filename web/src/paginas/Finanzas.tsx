import { useCallback, useState } from 'react';
import { api } from '../api';
import Cabecera from '../componentes/Cabecera';
import { DialogoVenta } from '../componentes/pipeline/Dialogos';
import Cobros from '../componentes/finanzas/Cobros';
import Cursos from '../componentes/finanzas/Cursos';
import { DetalleVenta } from '../componentes/finanzas/DetalleVenta';
import Equipo from '../componentes/finanzas/Equipo';
import Gastos from '../componentes/finanzas/Gastos';
import Metodos from '../componentes/finanzas/Metodos';
import Resumen from '../componentes/finanzas/Resumen';
import Ventas from '../componentes/finanzas/Ventas';
import { useSubvista } from '../componentes/finanzas/comun';
import type { PropsPestana, Tab } from '../componentes/finanzas/tipos';
import { ContenidoDeslizable, Pestanas, useAviso, useCarga, useParamUrl, type Pestana } from '../ui';

// Finanzas: lo que vendiste, lo que cobraste y lo que te queda.
// Pestañas en la URL (?tab=cobros: sobreviven a recargar y se pueden
// compartir) que en el celular se deslizan; una venta abierta también vive en
// la URL (?venta=<id>), así el Atrás del celular la cierra.

const TABS: Tab[] = ['resumen', 'ventas', 'cobros', 'gastos', 'cursos', 'metodos', 'equipo'];

export default function Finanzas() {
  const aviso = useAviso();
  const [tabUrl, setTabUrl] = useParamUrl<Tab>('tab', 'resumen');
  const tab: Tab = TABS.includes(tabUrl) ? tabUrl : 'resumen';
  const [version, setVersion] = useState(0);
  const [registrando, setRegistrando] = useState(false);
  const [nuevoEn, setNuevoEn] = useState<Tab | null>(null);
  const venta = useSubvista('venta');
  const contadores = useCarga(() => api<{ atrasadas: number }>('/ux/finanzas/contadores'), [version]);
  const atrasadas = contadores.datos?.atrasadas ?? 0;

  const onCambio = useCallback(() => setVersion((v) => v + 1), []);
  const irA = useCallback((t: Tab, nuevo?: boolean) => { setNuevoEn(nuevo ? t : null); setTabUrl(t); }, [setTabUrl]);
  const cambiarTab = useCallback((t: Tab) => { setNuevoEn(null); setTabUrl(t); }, [setTabUrl]);

  const pestanas: Array<Pestana<Tab>> = [
    { id: 'resumen', etiqueta: 'Resumen' },
    { id: 'ventas', etiqueta: 'Ventas' },
    {
      id: 'cobros',
      etiqueta: (
        <span className="inline-flex items-center gap-1.5">
          Cobros
          {atrasadas > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
              style={{ background: 'var(--status-critical)' }} aria-label={`${atrasadas} atrasadas`}>{atrasadas}</span>
          )}
        </span>
      ),
    },
    { id: 'gastos', etiqueta: 'Gastos' },
    { id: 'cursos', etiqueta: 'Cursos' },
    { id: 'metodos', etiqueta: 'Cómo te pagan' },
    { id: 'equipo', etiqueta: 'Equipo' },
  ];

  const props: PropsPestana = {
    version, onCambio, irA, abrirVenta: venta.abrir, onRegistrarVenta: () => setRegistrando(true),
    nuevo: nuevoEn === tab,
  };

  return (
    <div className="px-4 py-5 lg:px-8">
      <Cabecera titulo="Finanzas" subtitulo="Lo que vendiste, lo que cobraste y lo que te queda" />
      <Pestanas className="mt-3" pestanas={pestanas} actual={tab} onCambiar={cambiarTab} />
      <ContenidoDeslizable pestanas={pestanas} actual={tab} onCambiar={cambiarTab} className="pt-4">
        {tab === 'resumen' && <Resumen {...props} />}
        {tab === 'ventas' && <Ventas {...props} />}
        {tab === 'cobros' && <Cobros {...props} />}
        {tab === 'gastos' && <Gastos {...props} />}
        {tab === 'cursos' && <Cursos {...props} />}
        {tab === 'metodos' && <Metodos {...props} />}
        {tab === 'equipo' && <Equipo version={version} nuevo={props.nuevo} />}
      </ContenidoDeslizable>

      {registrando && (
        <DialogoVenta tarjeta={null} titulo="Registrar venta" onCerrar={() => setRegistrando(false)}
          onListo={(_registrada, texto, v) => {
            setRegistrando(false);
            onCambio();
            const debe = Number(v?.por_cobrar ?? 0) > 0;
            aviso.exito(texto, debe
              ? { texto: 'Ver cobros', onClick: () => cambiarTab('cobros') }
              : v?.id ? { texto: 'Ver venta', onClick: () => venta.abrir(v.id) } : undefined);
          }} />
      )}
      {venta.valor && <DetalleVenta id={venta.valor} onCerrar={venta.cerrar} onCambio={onCambio} onFicha={venta.cambiarPorFicha} />}
    </div>
  );
}
