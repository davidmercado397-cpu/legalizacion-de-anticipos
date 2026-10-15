export interface HasherContrasenas {
  hash(contrasena: string): Promise<string>;
  verificar(hash: string, contrasena: string): Promise<boolean>;
}

export interface ClaimsAcceso {
  usuarioId: string;
  roles: string[];
}

export interface EmisorTokensAcceso {
  emitir(claims: ClaimsAcceso): Promise<{ token: string; expiraEn: Date }>;
  /** Lanza DomainError NO_AUTENTICADO si el token es inválido o venció. */
  verificar(token: string): Promise<ClaimsAcceso>;
}

/** Refresh tokens opacos: se entrega el token y solo se guarda su hash. */
export interface TokensOpacos {
  generar(): string;
  hash(token: string): string;
}

export interface UsuarioIdentidad {
  id: string;
  nombre: string;
  email: string;
  roles: string[];
}

/** Acceso al directorio de usuarios (lo implementa un adaptador al módulo de organización). */
export interface DirectorioUsuarios {
  porEmail(email: string): Promise<UsuarioIdentidad | null>;
  porId(id: string): Promise<UsuarioIdentidad | null>;
}
