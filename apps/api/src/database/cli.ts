import { USUARIOS_DESARROLLO } from '../modules/organizacion/infrastructure/usuario.repository.memoria';
import { migrar } from './migrar';
import { CONTRASENA_DESARROLLO, sembrar } from './sembrar';

/**
 * Tareas de base de datos:
 *   tsx src/database/cli.ts migrar | sembrar      (desarrollo)
 *   node dist/cli.js migrar | sembrar             (imagen de producción)
 */
async function principal(comando: string | undefined): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL');

  switch (comando) {
    case 'migrar':
      await migrar(url);
      console.log('Migraciones aplicadas');
      return;
    case 'sembrar':
      await sembrar(url);
      console.log(`Datos de desarrollo cargados. Usuarios: ${USUARIOS_DESARROLLO.map((u) => u.email).join(', ')}`);
      console.log(`Contraseña: ${CONTRASENA_DESARROLLO}`);
      return;
    default:
      throw new Error(`Comando desconocido: "${comando ?? ''}". Use: migrar | sembrar`);
  }
}

principal(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
