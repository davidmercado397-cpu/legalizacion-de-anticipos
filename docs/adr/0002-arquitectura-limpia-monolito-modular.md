# ADR-0002: Arquitectura limpia en un monolito modular

- Estado: Aceptada

## Contexto
Volumen moderado (≈1.500 facturas/mes) y un equipo pequeño. Necesitamos aislar el dominio de proveedores cambiantes (OCR, Siesa, WhatsApp, autenticación).

## Decisión
- Monolito modular: un módulo por bounded context, cada uno con capas `domain / application / infrastructure / presentation`.
- Los módulos se comunican por casos de uso, puertos o eventos de dominio; nunca acceden a la infraestructura de otro módulo.
- Una prueba de arquitectura verifica la regla de dependencia.

## Consecuencias
- Un solo despliegue, transacciones locales, operación simple.
- Un módulo se puede extraer como servicio más adelante si el volumen lo exige.
