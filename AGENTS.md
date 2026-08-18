# Reglas permanentes de BOT WHATSAP

Estas reglas aplican a todo el repositorio:

1. No crear archivos gigantes.
2. No concentrar toda la lógica en `app.ts`, `server.ts` o archivos equivalentes.
3. Cada dominio comercial debe vivir en su propio módulo.
4. Las rutas HTTP no contienen lógica de negocio.
5. Los controllers no acceden directamente a PostgreSQL.
6. Los services no contienen SQL directo.
7. Los repositories son responsables de la persistencia.
8. Las integraciones externas se implementan mediante adapters/providers independientes.
9. `orders` no conoce detalles internos de SMM Raja.
10. `payments` no depende directamente de Mercado Pago.
11. Ningún secreto puede quedar hardcodeado.
12. API keys y tokens provienen de variables de entorno o del sistema seguro que se implemente posteriormente.
13. Nunca incluir secretos en JSON de Typebot.
14. La lógica crítica de pagos y pedidos debe ser determinística.
15. La IA nunca decide por sí sola que un pago está aprobado.
16. Todas las entradas HTTP deben validarse.
17. Toda operación crítica debe manejar errores explícitamente.
18. Los cambios deben limitarse al alcance solicitado en cada tarea.
19. No implementar funcionalidades futuras sin solicitud explícita.
20. Antes de crear una nueva abstracción, comprobar que existe una necesidad real.
21. Mantener el proyecto preparado para múltiples negocios mediante `business_id`, sin construir todavía un SaaS complejo.
22. Mantener compatibilidad conceptual con clientes como Typebot mediante APIs HTTP.
23. Evitar dependencias innecesarias.
24. Cada etapa debe dejar el proyecto compilando y ejecutando sus pruebas.
25. No realizar refactors fuera del alcance de la tarea actual salvo que sean imprescindibles para compilar.
26. Nunca depender de paquetes globales.
27. Toda dependencia del proyecto debe declararse en `package.json`.
28. `pnpm-lock.yaml` debe mantenerse sincronizado.
29. No hacer llamadas externas dentro de transacciones de base de datos.
30. Los webhooks críticos deberán ser idempotentes cuando se implementen.

## Convenciones del backend

- `routes`: definición de endpoints y schemas HTTP.
- `controller`: traducción entre HTTP y casos de uso.
- `service`: lógica de negocio.
- `repository`: acceso a PostgreSQL.
- `schema`: validación de datos.
- `types`: tipos y contratos del dominio.
- No crear capas o archivos vacíos antes de que una funcionalidad los necesite.
