import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ClienteProvider, restaurarSesion } from '@viaticos/client-app';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { crearDependencias } from './app/dependencias';
import { crearRouter } from './app/router';
import './styles.css';

const dependencias = crearDependencias();
const router = crearRouter(dependencias);

// Si hay cookie de sesión válida, se recupera antes de pintar (evita parpadeo al login).
await restaurarSesion(dependencias.api, dependencias.sesion);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={dependencias.queryClient}>
      <ClienteProvider api={dependencias.api} sesion={dependencias.sesion}>
        <RouterProvider router={router} />
      </ClienteProvider>
    </QueryClientProvider>
  </StrictMode>,
);
