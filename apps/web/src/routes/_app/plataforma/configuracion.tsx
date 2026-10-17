import { createFileRoute } from '@tanstack/react-router';
import { ConfiguracionSistema } from '../../../features/plataforma/configuracion';

export const Route = createFileRoute('/_app/plataforma/configuracion')({ component: ConfiguracionSistema });
