import { createFileRoute } from '@tanstack/react-router';
import { Auditoria } from '../../../features/administracion/auditoria';

export const Route = createFileRoute('/_app/administracion/auditoria')({ component: Auditoria });
