# Balance Energético — piloto web

Aplicación web (PWA) que reemplaza la planilla *Seguimiento peso*. Registra composición corporal, balance energético, carbohidratos y entrenamiento, con historial completo de todos los datos. Es multiusuario y se instala en la pantalla de inicio del iPhone.

## Funciones (equivalencia con la planilla)

| Planilla | App |
|---|---|
| Hoja **Datos**: peso, % grasa, IMC, grasa kg, masa magra, variaciones | **Hoy** → Composición corporal · **Historial** → Registro diario |
| Calorías ingeridas, gasto basal, quemadas, gasto total, balance | **Hoy** → Balance del día |
| Balance de carbos (40 g/h de entrenamiento) | **Hoy** → Carbohidratos (g/h editable por vigencia) |
| Ciclismo / Trote / Natación (kcal, h, km) | **Entreno** y **Hoy** → Entrenamiento |
| Cal x km, Cal x h, estimación y error (AD–AQ) | **Entreno** → Modelo propio de gasto, por deporte |
| Resumen semanal (déficit vs variación real) | **Progreso** → Cierre semanal + autocalibración |
| **Alimentos Ingeridas** (desayuno, almuerzo, once/cena, meta 1.200) | **Hoy** → comidas, meta diaria, "repetir ayer" |
| **BD Alimento** | Catálogo personal / compartido + Open Food Facts + USDA + código de barras |
| **Gasto Basal** (Harris-Benedict y Katch-McArdle; edad 51 → 54) | Parámetros con vigencia por fecha; además Mifflin-St Jeor y ajuste personal en % |
| **Zonas Frec Cardiaca** (Karvonen) | **Entreno** → Zonas de FC |
| Gráficos | **Progreso** → Tendencia (media móvil 7 días) |

## Poblar el catálogo de alimentos (sin tocar código)

En **Más → Alimentos**:

- **+ Nuevo alimento**: carga individual (nombre, kcal y carbos por porción, porción, código de barras). Avisa si el nombre ya existe. "Guardar y agregar otro" permite cargar varios seguidos.
- **Carga masiva desde Excel**: acepta la hoja *BD Alimento* de la planilla (columnas Comida, Cal, Carbs; opcionales Porción y Código de barras) o la plantilla descargable. Muestra una vista previa con nuevos, ya existentes, diferencias y filas con error, y permite actualizar los valores de los existentes.
- **Destino**: el administrador publica en el catálogo compartido; los demás usuarios cargan en su catálogo personal o proponen al compartido.

## Registro histórico

- Toda alta, edición o eliminación queda en `historial_cambios`, con el valor anterior y el nuevo (**Historial → Cambios**).
- Los parámetros (estatura, fórmula, edad, carbos/h, meta, FC) tienen **vigencia por fecha**: cada día se calcula con los parámetros de ese día.
- Cada consumo guarda su copia de kcal y carbos: corregir el catálogo no altera días pasados.
- La hoja Datos importada queda **archivada íntegra** (todas las columnas) en `historico_planilla`, con banderas de calidad (**Historial → Planilla original**). Para esos días la app respeta el gasto basal registrado en la planilla.
- Exportación a CSV del registro diario y de la planilla original.

## Verificación contra la planilla

`npm test` con `PLANILLA=/ruta/archivo.xlsx` recalcula toda la hoja Datos: el IMC coincide (diferencia < 0,002) y el balance calórico coincide en 213 de 214 días. La excepción (03-05-2021) es una fila con tiempo y km de entrenamiento pero 0 kcal; la app lo estima con el modelo.

## Puesta en marcha

### 1. Supabase (base de datos y cuentas)

1. Crear un proyecto gratuito en [supabase.com](https://supabase.com).
2. **SQL Editor → New query**: pegar el contenido de `supabase/schema.sql` y ejecutar.
3. **Authentication → URL Configuration**: en *Site URL* poner la dirección de GitHub Pages (paso 2).
4. **Project Settings → API**: copiar *Project URL* y la clave pública *anon / publishable*.

### 2. GitHub Pages

1. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: crear `SUPABASE_URL` y `SUPABASE_ANON_KEY` (opcional `USDA_API_KEY`).
3. Cada `push` a `main` corre las pruebas, compila y publica en `https://<usuario>.github.io/<repositorio>/`.

Si no se definen las variables, la app pide la URL y la clave la primera vez que se abre en cada dispositivo.

### Migraciones (instalaciones existentes)

- `supabase/migracion-002.sql`: agrega la fórmula Mifflin-St Jeor y el ajuste personal del gasto basal. Ejecutar una vez en el SQL Editor (es segura de repetir). Las instalaciones nuevas ya lo incluyen en `schema.sql`.

### 3. Primer uso

1. Abrir la app, **crear cuenta** y confirmar el correo.
2. En Supabase SQL Editor, hacerse administrador del catálogo compartido:
   ```sql
   update public.perfiles set es_admin = true
   where id = (select id from auth.users where email = 'TU_CORREO');
   ```
3. **Más → Importar planilla**: cargar el .xlsx. Reimportar reemplaza solo lo importado.
4. En Safari del iPhone: **Compartir → Agregar a pantalla de inicio**.

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # completar URL y clave
npm run dev
npm test
```

## Estructura

```
src/lib/calc.ts         Motor de cálculo (funciones puras, probado contra la planilla)
src/lib/importador.ts   Lectura del .xlsx y etiquetado de calidad del dato
src/lib/datos.tsx       Carga de datos y derivados (días, semanas, calibración)
src/pages/              Hoy, Progreso, Historial, Entreno, Más
supabase/schema.sql     Tablas, seguridad por usuario y auditoría
```

## Pendiente para la versión iOS nativa

La web no puede leer Apple Health: peso y entrenamientos se registran a mano o se importan. El motor de cálculo y la base de datos se reutilizan tal cual en la app nativa (SwiftUI + HealthKit). La entidad *Actividad* ya tiene la estructura prevista para la integración con MetriKM.
