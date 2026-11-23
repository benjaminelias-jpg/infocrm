import { Component, Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boton, Esqueleto, Vacio } from '../../ui';
import Icono from '../Iconos';

// Pestaña "Equipo" de Configuración. El equipo (quién entra al CRM, su rol y
// su comisión) lo arma la zona de Finanzas en componentes/finanzas/Equipo.tsx
// (export default, sin props). Se carga solo si ese archivo existe (glob de
// Vite: si todavía no está, no rompe el build) y, si falla, queda un acceso a
// Finanzas → Equipo.

// El Equipo ya existe: import directo (funciona igual en Vite y en Next).
const EquipoDeFinanzas = lazy(() => import('../finanzas/Equipo') as Promise<{ default: ComponentType }>);

class SiFalla extends Component<{ children: ReactNode; respaldo: ReactNode }, { roto: boolean }> {
  state = { roto: false };
  static getDerivedStateFromError() { return { roto: true }; }
  componentDidCatch(e: unknown) { console.warn('[Equipo] no se pudo mostrar', e); }
  render() { return this.state.roto ? this.props.respaldo : this.props.children; }
}

function IrAFinanzas() {
  const navegar = useNavigate();
  return (
    <div className="tarjeta">
      <Vacio icono={<Icono nombre="leads" tam={24} />} titulo="Tu equipo"
        texto="Sumá a tu setter o closer, con su comisión y si puede entrar al CRM. Por ahora se arma en Finanzas → Equipo."
        accion={<Boton variante="primario" onClick={() => navegar('/finanzas?tab=equipo')}>Ir a Equipo</Boton>} />
    </div>
  );
}

export default function PestanaEquipo() {
  if (!EquipoDeFinanzas) return <IrAFinanzas />;
  return (
    <SiFalla respaldo={<IrAFinanzas />}>
      <Suspense fallback={<div className="space-y-2"><Esqueleto alto={56} className="rounded-lg" /><Esqueleto alto={56} className="rounded-lg" /><Esqueleto alto={56} className="rounded-lg" /></div>}>
        <EquipoDeFinanzas />
      </Suspense>
    </SiFalla>
  );
}
