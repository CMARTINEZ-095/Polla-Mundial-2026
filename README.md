# Polla Mundial 2026

App web en Node.js + Express para registrar pronosticos de marcadores del Mundial FIFA 2026.

## Que incluye

- Registro e inicio de sesion de participantes.
- Pronostico de marcador para cada partido.
- Bloqueo automatico del pronostico cuando inicia el partido.
- Panel de administrador para crear, editar y eliminar partidos.
- Registro de resultados oficiales por el administrador.
- Tabla de posiciones automatica.
- Exportacion CSV de la tabla para el administrador.
- Calendario inicial precargado desde las imagenes compartidas, editable desde el panel admin.
- Soporte para PostgreSQL en produccion y archivo JSON para desarrollo local.

## Regla de puntos

- Marcador exacto: **3 puntos**.
- Cualquier otro marcador: **0 puntos**.

La tabla se recalcula automaticamente cada vez que el administrador guarda un resultado.

## Requisitos locales

- Node.js 20 o superior.
- npm.

## Ejecutar en VS Code

1. Descomprime el ZIP.
2. Abre la carpeta `polla-mundial-2026` en VS Code.
3. Abre una terminal dentro de la carpeta.
4. Instala dependencias:

```bash
npm install
```

5. Crea tu archivo `.env`:

```bash
cp .env.example .env
```

En Windows PowerShell puedes usar:

```powershell
copy .env.example .env
```

6. Inicia la app:

```bash
npm run dev
```

7. Abre en el navegador:

```text
http://localhost:3000
```

## Usuario administrador local

Por defecto se crea este administrador si no existe:

```text
Correo: admin@demo.com
Clave: admin123
```

Entra con ese usuario, ve a **Mi cuenta** y cambia la clave. Tambien puedes cambiar `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `.env` antes del primer inicio.

## Base de datos

### Desarrollo local

Si no configuras `DATABASE_URL`, la app usa un archivo JSON en:

```text
data/db.json
```

Esto es suficiente para probar en tu computador.

### Produccion recomendada

Para Render se recomienda PostgreSQL usando `DATABASE_URL`. El archivo `render.yaml` ya crea un servicio web y una base de datos Postgres, y le pasa la variable `DATABASE_URL` a la app.

## Subir a Render con GitHub

1. Sube esta carpeta a un repositorio de GitHub.
2. En Render, crea un **Blueprint** desde el repositorio.
3. Render leera `render.yaml`.
4. Cuando pregunte `ADMIN_PASSWORD`, escribe una clave segura para el administrador inicial.
5. Espera el deploy.
6. Abre la URL `onrender.com` que te entregue Render.

El archivo `render.yaml` usa:

```yaml
buildCommand: npm install
startCommand: npm start
```

## Subir a Render manualmente

Si no usas Blueprint:

1. Crea un Web Service en Render conectado a tu repositorio.
2. Configura:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
```

3. Crea una base de datos PostgreSQL en Render.
4. Copia su Internal Database URL y agrega una variable de entorno en el Web Service:

```text
DATABASE_URL=postgresql://...
```

5. Agrega tambien:

```text
NODE_ENV=production
SESSION_SECRET=un_texto_largo_y_secreto
APP_NAME=Polla Mundial 2026
TIMEZONE=America/Bogota
ADMIN_EMAIL=tu_correo_admin@dominio.com
ADMIN_PASSWORD=una_clave_segura
```

6. Despliega.

## Importante sobre Render gratis

Render puede cambiar sus planes. Si usas una base de datos gratuita, revisa sus limitaciones actuales. En los planes gratuitos de Render, la base de datos puede tener limites de capacidad, respaldo y tiempo de vida. Para una polla real con dinero o muchos usuarios, usa un plan con persistencia y backups.

## Editar partidos y resultados

1. Ingresa como administrador.
2. Entra a **Admin**.
3. Usa **Editar** en un partido.
4. Corrige fecha/equipos si hace falta.
5. Cuando termine el partido, escribe goles local y visitante.
6. Guarda. La tabla se actualiza sola.

## Estructura del proyecto

```text
polla-mundial-2026/
  public/css/styles.css        Estilos
  src/server.js                Rutas y servidor Express
  src/db.js                    Base de datos JSON/Postgres
  src/fixtures.js              Calendario inicial editable
  src/utils.js                 Utilidades de fechas, puntaje y validacion
  src/views/                   Plantillas EJS
  render.yaml                  Blueprint para Render
  .env.example                 Variables de entorno ejemplo
  package.json                 Dependencias y scripts
```

## Personalizar puntaje

La regla actual esta implementada como marcador exacto = 3 puntos. Si mas adelante quieres dar puntos por acertar ganador o empate, se puede modificar en `src/db.js` y `src/utils.js`.
