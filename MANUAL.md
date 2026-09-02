# Manual de Party Rentals

Guía para administrar el negocio desde la aplicación: catálogo, pedidos, entregas, cobros y
documentos.

**Cómo leer este manual.** Cada sección empieza con lo esencial —lo suficiente para operar si ya
conoce el flujo— y guarda el detalle dentro de bloques desplegables (`▸ Ver detalle`). Si va de
prisa, lea solo lo de arriba. Si algo no cuadra, abra el detalle: ahí están las reglas, los límites y
el porqué de cada campo.

> **Quién usa esto.** Hoy la aplicación tiene un solo tipo de usuario operativo: el **Administrador**.
> Todo lo que se describe aquí lo hace esa cuenta. Existen los roles Cliente y Repartidor en el
> sistema, pero aún no tienen pantallas propias.

---

## Índice

1. [Primeros pasos](#1-primeros-pasos)
2. [El panel de un vistazo](#2-el-panel-de-un-vistazo)
3. [Inicio: el tablero](#3-inicio-el-tablero)
4. [Productos](#4-productos)
5. [Clientes](#5-clientes)
6. [Pedidos](#6-pedidos) ← el corazón del sistema
7. [El ciclo de vida de un pedido](#7-el-ciclo-de-vida-de-un-pedido)
8. [Cobros](#8-cobros)
9. [Documentos: cotización y comprobante](#9-documentos-cotización-y-comprobante)
10. [Calendarios](#10-calendarios)
11. [Preferencias: cómo se comporta el sistema](#11-preferencias-cómo-se-comporta-el-sistema)
12. [Ajustes de su cuenta](#12-ajustes-de-su-cuenta)
13. [Cuando algo sale mal](#13-cuando-algo-sale-mal)

---

## 1. Primeros pasos

**Entrar:** correo y contraseña. Si activó la verificación en dos pasos, la aplicación pide además el
código de seis dígitos.

**La sesión dura.** No hay que volver a entrar cada día: la sesión se mantiene hasta 30 días sin uso.
Cerrar la pestaña no cierra la sesión; para eso está **Cerrar sesión** en el menú de su nombre.

<details>
<summary><b>▸ Ver detalle: contraseñas, dispositivos y recuperación</b></summary>

- **La contraseña** debe tener al menos 12 caracteres, con mayúscula, minúscula, número y un símbolo.
  Se permiten todos los símbolos del teclado; no se permiten espacios ni letras acentuadas.
- **¿Olvidó su contraseña?** En la pantalla de inicio, use *¿Olvidaste tu contraseña?*. Llega un
  correo con un enlace válido por **30 minutos** y de **un solo uso**. Por seguridad, la pantalla
  responde lo mismo exista o no el correo — si no llega nada, revise que la dirección sea la correcta
  y la carpeta de spam.
- **Al restablecer la contraseña se cierran todas las sesiones**, en todos los dispositivos. Es
  intencional: si alguien más tenía acceso, lo pierde.
- **Al cambiar la contraseña** desde Ajustes se cierran las sesiones de los *otros* dispositivos, pero
  no la suya.
- Cada intento fallido de inicio de sesión cuenta: **cinco fallos bloquean esa cuenta 15 minutos**.
  El bloqueo es por cuenta, no por dispositivo, y se limpia solo al entrar correctamente.

</details>

---

## 2. El panel de un vistazo

| Sección | Para qué |
|---|---|
| **Inicio** | El tablero: qué sigue hoy, cómo va el mes. |
| **Productos** | El catálogo y el inventario. |
| **Pedidos** | Crear, seguir, cobrar y documentar cada evento. |
| **Preferencias** | Cómo se comporta el sistema (reglas del negocio). |
| **Ajustes** | Su cuenta, su dispositivo, sus calendarios. |

**La diferencia entre Preferencias y Ajustes** vale la pena entenderla una vez: **Preferencias es cómo
opera el negocio** (tiempos entre entregas, textos de los documentos, zonas y precios de envío);
**Ajustes es suyo** (su contraseña, su calendario, la app de mapas de *este* teléfono).

En el celular, el menú se abre con el botón ☰ de la esquina superior izquierda.

---

## 3. Inicio: el tablero

Tres bloques, de arriba abajo:

- **Lo que sigue** — los próximos tres pedidos que requieren acción, con su hora y un botón para
  avanzarlos sin entrar al detalle.
- **Hoy** — el trabajo del día.
- **Este mes** — seis indicadores del mes en curso.

<details>
<summary><b>▸ Ver detalle: qué significa cada número</b></summary>

**Lo que sigue** muestra **pedidos, no eventos**: cada pedido aparece una sola vez, representado por
lo único que le falta hacer. Si confirma la entrega, ese mismo pedido vuelve a la lista más tarde
—ahora con su recolección— reordenado contra los demás.

Un pedido marcado **Atrasado** pasó su hora sin confirmarse. El cálculo lo hace el servidor, así que
un teléfono con la hora mal configurada no puede alterarlo.

**Los seis indicadores del mes:**

| Indicador | Qué mide |
|---|---|
| Pedidos | Cuántos pedidos tienen entrega este mes. |
| Ingresos | Cuánto vale el trabajo del mes. |
| Cobrado | Cuánto dinero entró de verdad (por fecha de pago). |
| Pendiente de cobro | La diferencia entre lo anterior: lo que falta cobrar. |
| Ticket promedio | Ingresos ÷ pedidos. |
| Cancelados | Pedidos cancelados del mes. |

**Ingresos** y **Cobrado** son distintos a propósito: el primero es lo que el mes vale, el segundo lo
que ya está en la cuenta. Si los dos se separan mucho, hay cobros pendientes.

El porcentaje verde o rojo compara con el mes anterior. Si el mes anterior fue cero, no se muestra
comparación —un "+100%" partiendo de nada no informa nada.

El tablero se actualiza solo cada minuto, y al volver a la pestaña.

</details>

---

## 4. Productos

El catálogo. Cada producto es algo que **se alquila** o algo que **se vende**, y esa elección cambia
qué precios se piden.

**Crear:** Productos → **Agregar producto**. **Editar o eliminar:** abra el producto y use los
botones de la ficha.

**Lo mínimo:** nombre, tipo de negocio (Alquiler o Venta), categoría, moneda, cantidad y el precio que
corresponda.

<details>
<summary><b>▸ Ver detalle: los campos, uno por uno</b></summary>

**Información**
- **Nombre** y **Descripción** — lo que verá en las listas y en los documentos.
- **Tipo de negocio** — *Alquiler* o *Venta*. Determina qué precios se exigen (ver abajo).
- **Categoría** — Mesas, Sillas, Mantelería… Se administran en Preferencias → Productos.

**Fotos**
- Hasta **8 fotos**, de **5 MB** cada una, en JPG, PNG, WebP o AVIF.
- Una de ellas es la **Principal** —la que aparece en las listas—. Se elige con *Marcar como
  principal*; no es necesariamente la primera.
- El orden se cambia **arrastrando** las fotos.
- Se suben al agregarlas, pero solo quedan guardadas al guardar el producto: si cancela, se descartan.

**Precios e inventario**
- **Alquiler** exige **Precio de renta** + **Unidad de tiempo** (por día, por evento…).
- **Venta** exige **Precio de venta**. No pide unidad de tiempo.
- **Precio de reposición** — cuánto cuesta reponer la pieza si se pierde o se daña. Es informativo:
  el sistema no lo cobra automáticamente.
- **Cantidad** — **cuántas unidades tiene en total**, no cuántas están libres hoy. La disponibilidad
  se calcula sola restando lo que los pedidos tienen tomado.

**Detalles** — pares tipo/valor (Color: Blanco, Capacidad: 8 personas). Aparecen en la ficha del
producto. Los tipos se administran en Preferencias → Productos.

**Al eliminar:** si el producto nunca se usó en un pedido, se borra de verdad. Si ya aparece en el
historial de algún pedido, se **desactiva** —desaparece de las listas pero el historial sigue siendo
legible. El sistema decide solo; usted solo confirma.

</details>

---

## 5. Clientes

Los clientes se crean **desde el pedido**, no en una sección aparte: al crear un pedido, el botón
**Nuevo cliente** abre la ficha; si ya eligió uno, el mismo botón dice **Editar cliente**.

Una ficha guarda: nombre, contactos (WhatsApp, teléfono, correo), direcciones y notas.

<details>
<summary><b>▸ Ver detalle: contactos, direcciones y por qué el pedido "copia" los datos</b></summary>

- **Contactos** — uno a diez. Exactamente uno es el **principal**: es el que el pedido usa por
  defecto. El tipo (WhatsApp, Teléfono, Correo) cambia el teclado del celular y valida el formato.
- **Direcciones** — ninguna, una o varias. Exactamente una es la **favorita**. Cada dirección puede
  llevar:
  - **Zona** — sugiere el costo de envío.
  - **Cómo llegar o entrar** — lo que un mapa no dice: *"portón negro, preguntar por el guardia"*.
  - **Ubicación en el mapa** — un pin, opcional. Puede buscarlo, moverlo en el mapa o pegar un enlace
    de Google Maps o Waze.
- **Notas del cliente** — datos permanentes ("cliente frecuente", "cobrar al terminar"). **Se copian
  al comentario del pedido** cada vez que elige ese cliente, y ahí puede editarlas para ese pedido.

**Por qué el pedido copia y no enlaza:** al crear un pedido, los datos del cliente se **copian** al
pedido. Si mañana el cliente cambia de teléfono, los pedidos viejos conservan el teléfono con el que
se hicieron. Eso es intencional: un pedido es un registro de lo que se acordó ese día.

**Al editar un cliente**, la ficha guarda lo que se ve en pantalla. Complete siempre todos los campos
que le importen, incluidas las notas — lo que quede vacío se guarda vacío.

</details>

---

## 6. Pedidos

**Crear:** Pedidos → **Nuevo pedido**. El formulario tiene cinco bloques: **Cliente**, **Evento y
fechas**, **Productos**, **Entrega** y **Cobro**.

**Lo mínimo para guardar:** un cliente, un tipo de evento, la fecha de entrega, un producto con
cantidad, quién recibe, un contacto, una dirección y **a quién se le asigna**.

**Dos listas:** *Agenda* (lo que falta hacer) e *Historial* (terminados y cancelados). El selector
está arriba de la lista.

<details>
<summary><b>▸ Ver detalle: bloque por bloque</b></summary>

**Cliente**
Elija uno de la lista o créelo con **Nuevo cliente**. Al elegirlo, el sistema llena solo: nombre de
quien recibe, contacto, dirección, indicaciones, pin, zona, costo de envío y comentario. **Todo eso es
editable** — son un punto de partida, no una obligación.

**Evento y fechas**
- **Tipo de evento** — Boda, Cumpleaños… Se administran en Preferencias → Pedidos. Cada tipo puede
  exigir un **tiempo mínimo de anticipación**: si intenta agendar demasiado justo, el formulario lo
  avisa.
- **Entrega** — fecha y hora. Al crear, no puede estar en el pasado.
- **Recolección** — fecha y hora. **Déjela vacía en un pedido de solo venta**: no hay nada que
  recoger. Si la pone, debe ser posterior a la entrega.
  *(Ojo: lo que decide si el pedido lleva recolección en su ciclo son los **productos**, no este
  campo — ver §7.)*

**Productos**
Agregue líneas con **Agregar producto**. Bajo cada línea aparece el subtotal y, en alquileres, los
días facturados.

⚠️ **Los días se cobran por día empezado.** De sábado 8:00 a domingo 10:00 son **dos días**, no uno y
medio. El documento lo dice explícitamente para que el cliente lo vea igual que usted.

Si no hay unidades suficientes para esas fechas, el sistema lo dice **en la línea del producto**, con
el número disponible. No es un error del formulario: es que otro pedido ya las tiene tomadas.

**Entrega**
- **Asignar a** — quién realiza el trabajo. **Obligatorio.** De esto dependen dos cosas: que el
  sistema no agende dos trabajos encima y que los eventos lleguen al calendario de esa persona (y
  solo a esa).
- **Nombre de quien recibe**, **Tipo de contacto** y **Contacto** — quién abre la puerta.
- **Dirección de entrega** y **Cómo llegar o entrar**.
- **Ubicación en el mapa** — opcional. Si la pone, aparece el botón para abrir Waze o Google Maps
  desde el pedido; si no, no aparece, y esa ausencia es información: significa que no hay pin
  confiable.
- **Zona de entrega** — solo sugiere el costo. No viaja al pedido.

**Cobro**
- **Costo de envío** — puede ser 0. En cero, el documento imprime la nota de envío gratis.
- **Anticipo** — lo que el cliente deja adelantado. Resta del saldo.
- **Comentario** — notas del pedido (viene precargado con las notas del cliente).

⚠️ **Aquí no se registra el pago.** El pago se registra cuando el dinero llega de verdad, con el
botón **Registrar pago** (ver §8).

**Editar un pedido** rehace todos los cálculos: precios, días, disponibilidad. Un pedido ya terminado
o cancelado se puede corregir sin que el sistema reclame inventario —a esas alturas ya no reserva
nada.

**Borrador automático:** mientras llena un pedido nuevo, lo escrito se guarda en este navegador. Si se
va y vuelve, aparece un aviso con la opción de descartarlo. Puede apagarlo en Preferencias →
Operación → Formularios.

</details>

<details>
<summary><b>▸ Ver detalle: "no se puede agendar" — los dos motivos</b></summary>

El sistema rechaza un pedido por dos razones distintas, y conviene no confundirlas:

**1. No hay producto.** Otro pedido tiene esas unidades tomadas en esas fechas. El aviso sale en la
línea del producto, con la cantidad disponible. Soluciones: bajar la cantidad, cambiar las fechas o
usar otro producto.

**2. No hay quién.** La persona asignada ya tiene otro trabajo a esa hora. Cada entrega y cada
recolección **ocupa un bloque de tiempo** de quien la realiza (por defecto una hora, configurable en
Preferencias → Operación), y dos bloques de la misma persona no se pueden encimar. El aviso sale en
las fechas y dice con qué pedido choca. Soluciones: mover la hora o asignar a otra persona.

También se avisa si **la entrega y la recolección del mismo pedido** quedan demasiado juntas.

Las unidades se liberan cuando el pedido llega a **Listo**, no antes — porque entre la recolección y
el siguiente evento hay limpieza.

</details>

---

## 7. El ciclo de vida de un pedido

```
ALQUILER   Pendiente → En ruta → Entregado → Recolectado → Listo
SOLO VENTA Pendiente → En ruta → Entregado ✔ (termina aquí)

Cancelado ← se puede llegar desde cualquier paso
```

**El sistema decide solo cuál de los dos recorridos aplica**, mirando los productos del pedido: si
hay **al menos un producto de alquiler**, el pedido hace el ciclo completo; si **todos** son de venta,
termina en *Entregado*. No hay nada que marcar.

Se avanza con **un botón**, desde el tablero, desde la agenda o desde el pedido. El botón siempre dice
el siguiente paso: *Marcar En ruta*, *Marcar Entregado*…

| Estado | Qué significa |
|---|---|
| **Pendiente** | Confirmado, aún no sale. |
| **En ruta** | Va en camino. |
| **Entregado** | Ya está con el cliente. |
| **Recolectado** | Recogido, en limpieza. **Las unidades siguen ocupadas.** |
| **Listo** | Limpio y disponible otra vez. |
| **Cancelado** | No se realiza. |

<details>
<summary><b>▸ Ver detalle: fotos, retroceder, cancelar y eliminar</b></summary>

**Fotos de evidencia.** Algunos pasos las piden (cuántas, mínimo y máximo, se configura en
Preferencias → Operación → Evidencia). Se toman o se suben en el momento de confirmar el paso.

**Retroceder.** Si marcó un paso por error, puede regresar al anterior. El sistema deshace lo que
corresponde —incluida la hora registrada— y el pedido vuelve a aparecer donde debe.

**Cancelar** pide un motivo y **el aviso le dice exactamente qué va a pasar** con el inventario: si
cancela un pedido que aún no salió, las unidades vuelven a estar libres; si cancela uno ya terminado,
no se libera nada porque ya no tenía nada tomado. Lea esa línea: cambia según el estado.

**Un pedido de solo venta termina solo.** Al confirmar *Entregado*, el sistema ve que ya no queda
nada por hacer, lo da por cerrado y **pasa a Historial automáticamente** — no aparece un botón de
"finalizar" ni hay que moverlo a mano. (Si retrocede ese paso, vuelve a la Agenda.)

**Eliminar** está en **Zona de riesgo**, al final del pedido, y **está disponible en cualquier
momento, sin importar el estado** —incluido un pedido pendiente o ya entregado—. Borra el pedido y
todo lo que existe por él: historial, evidencia y su registro de cobro, para siempre.
Cancelar conserva el registro; eliminar no. **Para cerrar un pedido que sí ocurrió, cancélelo.**
Eliminar es para lo que nunca debió existir: una prueba, un duplicado, un error de captura.

**Todo queda registrado.** Cada cambio de estado guarda quién, cuándo y —si la hubo— la evidencia. El
historial se ve al final del pedido.

</details>

---

## 8. Cobros

El cobro **no es un paso del pedido**: un cliente puede pagar días antes, en la puerta o una semana
después. Por eso tiene su propio botón, **Registrar pago**, disponible desde el tablero, la agenda y
el pedido.

Registrar pago pide **cómo pagó** y marca el pedido como pagado con la fecha de ese momento.

<details>
<summary><b>▸ Ver detalle: deshacer un pago, y por qué "pagado" no es un estado del pedido</b></summary>

- Un pedido **entregado y no pagado** es un estado normal y visible — de hecho es el que más importa
  vigilar. Por eso el cobro y la entrega son dos ejes distintos.
- **Si intenta registrar el pago dos veces**, el sistema lo rechaza. Es a propósito: volver a
  registrarlo cambiaría la fecha real del pago por la de hoy.
- **Deshacer un pago** existe solo en el detalle del pedido (no en las listas, para no tocarlo por
  error). Borra el registro: el pedido vuelve a pendiente de cobro y se olvida el método.
  ⚠️ **Deshacer no devuelve dinero al cliente.** Es un registro que se elimina, nada más. Si el
  dinero se regresó de verdad, eso es un movimiento aparte que el sistema no realiza.
- Los **métodos de pago** se administran en Preferencias → Pedidos. El método preferido del cliente
  es solo información: nunca se asume que pagó así.

</details>

---

## 9. Documentos: cotización y comprobante

Dos documentos PDF, mismo diseño, momentos distintos:

- **Cotización** — desde el formulario de un pedido **nuevo**, antes de guardarlo. Sirve para pasar
  precio por teléfono.
- **Comprobante** — desde un pedido **ya creado**. Lleva el número de pedido y lo realmente acordado.

<details>
<summary><b>▸ Ver detalle</b></summary>

- La cotización exige que el formulario esté completo: al pedirla, se marcan los campos que falten.
- Un pedido **cancelado no genera comprobante**.
- El encabezado, las condiciones impresas, los términos, la validez de la cotización y las cuentas
  bancarias salen de **Preferencias → Documentos**. El documento nunca inventa esos textos.
- **La nota de envío gratis se imprime sola** cuando el costo de envío es exactamente 0. No la
  escriba en las condiciones: ahí saldría también en pedidos con envío cobrado.
- Se imprimen hasta **cuatro condiciones**; el resto vive en los términos, a los que el documento hace
  referencia.
- Un pedido normal cabe en una hoja. Con muchas líneas, el documento pagina solo y repite los
  encabezados.

</details>

---

## 10. Calendarios

Las entregas y recolecciones **de los pedidos asignados a usted** llegan a su calendario, con
recordatorio. Se configura en **Ajustes → Calendarios**, y cada persona conecta el suyo.

Dos formas, según el calendario que use:

| | **Google Calendar** | **Apple Calendar y otros** |
|---|---|---|
| Cómo | Conectar la cuenta | Copiar un enlace y suscribirse |
| Rapidez | Inmediato | El calendario consulta cada pocos minutos |

<details>
<summary><b>▸ Ver detalle: qué se crea, qué se borra, y el enlace privado</b></summary>

**Qué aparece:** un evento por cada entrega y cada recolección **pendiente**. Al confirmar un paso, su
evento desaparece; si retrocede, vuelve. Un pedido cancelado no deja eventos.

**Solo lo suyo.** Un pedido llega únicamente al calendario de la persona **asignada**. Si reasigna el
pedido, los eventos se van del calendario anterior y aparecen en el nuevo.

**El recordatorio** se configura una sola vez, en Preferencias → Operación → Calendario, y aplica a
los dos métodos. Si crea un pedido con menos anticipación que el aviso configurado (por ejemplo, un
pedido para dentro de 12 horas con aviso de un día), el recordatorio **suena unos minutos después de
crearlo** — es lo único honesto que se puede hacer: no se puede avisar con un día de anticipación de
algo que ocurre en 12 horas.

**El enlace de suscripción es privado.** Quien lo tenga ve su agenda. Si se filtró, use **Generar de
nuevo**: el anterior deja de funcionar de inmediato —y con él, los dispositivos que ya lo tenían, que
habrá que volver a suscribir.

**Al desconectar Google**, los eventos que ya están en su calendario **se quedan ahí**: son citas que
usted sigue teniendo. Lo que se detiene es la actualización.

**Editar un evento desde el calendario no cambia nada** en la aplicación, y se sobrescribe en la
siguiente sincronización. El pedido manda.

</details>

---

## 11. Preferencias: cómo se comporta el sistema

Cuatro pestañas: **Operación**, **Pedidos**, **Productos** y **Documentos**. Cada cambio se guarda por
tarjeta con su propio botón.

| Pestaña | Qué se controla |
|---|---|
| **Operación** | Tiempo entre trabajos, limpieza, evidencia, recordatorio del calendario, borradores. |
| **Pedidos** | Tipos de evento, zonas de envío, métodos de pago, tipos de contacto. |
| **Productos** | Categorías y tipos de detalle. |
| **Documentos** | Encabezado, condiciones, términos y cuentas bancarias. |

<details>
<summary><b>▸ Ver detalle: qué hace exactamente cada preferencia</b></summary>

**Operación → Logística**
- **Tiempo entre trabajos** — cuánto ocupa cada entrega o recolección en la agenda de quien la
  realiza. Es lo que impide agendar dos cosas encima, y es también la duración del evento en el
  calendario.
- **Tiempo de limpieza** — cuánto tardan las unidades en volver a estar disponibles después de una
  recolección.

**Operación → Evidencia** — mínimo y máximo de fotos, y cuántos meses se conservan.

**Operación → Calendario** — con cuánta anticipación avisa el calendario. 1440 minutos = un día.

**Operación → Formularios** — activar o desactivar el borrador automático, por separado para pedidos
y para productos.

**Los catálogos (Pedidos y Productos)** se administran igual: agregar, editar, eliminar.
- Si nada usa el registro, se **elimina**. Si algún pedido ya lo usa, se **oculta**: desaparece de los
  formularios pero el historial sigue completo. El aviso le dice cuál de las dos cosas va a pasar.
- Los catálogos que los formularios necesitan (tipos de evento, tipos de contacto, categorías) **no se
  pueden dejar vacíos**: el botón de eliminar se desactiva en el último activo.
- Los **tipos de evento** llevan anticipación mínima; las **zonas**, su costo de envío.

**Documentos** — nombre y teléfono del negocio, condiciones impresas (hasta cuatro), términos
completos, nota de envío gratis, validez de la cotización y las cuentas bancarias. **Las cuentas
empiezan vacías**: si en el documento solo aparece un banco, es que el segundo no se ha agregado.

</details>

---

## 12. Ajustes de su cuenta

| Sección | Qué hay |
|---|---|
| **Cuenta** | Su nombre, correo y rol. |
| **Seguridad** | Cambiar contraseña y verificación en dos pasos. |
| **Este dispositivo** | Con qué app de mapas se abren las direcciones. |
| **Calendarios** | Conectar Google o generar el enlace de suscripción (§10). |

<details>
<summary><b>▸ Ver detalle: verificación en dos pasos</b></summary>

Al activarla, la aplicación muestra un código QR para escanear con Google Authenticator, Authy o
similar, y luego pide un código para confirmar.

⚠️ **Los códigos de recuperación se muestran una sola vez.** Guárdelos fuera del teléfono. Son la
única forma de entrar si pierde el dispositivo con la aplicación de códigos. Cada uno sirve una vez.

Para desactivarla se pide su contraseña. **Este dispositivo** guarda su preferencia de mapas solo
aquí: si entra desde otro teléfono, vuelve a preguntar.

</details>

---

## 13. Cuando algo sale mal

| Lo que ve | Qué significa | Qué hacer |
|---|---|---|
| Pantalla de "estamos volviendo" | El servidor no responde. | Se reintenta solo. No pierde lo escrito. |
| "Sin conexión" | Su internet se cayó. | Al volver la conexión, sigue solo. |
| "Demasiadas solicitudes" | Demasiadas acciones muy rápido. | Espere un minuto. |
| Sesión expirada | Su sesión terminó. | Vuelva a entrar. |
| Aviso rojo bajo un campo | Ese dato no es válido. | El texto dice qué corrige. |
| Aviso en la línea de un producto | No hay unidades para esas fechas. | §6, "no se puede agendar". |
| Aviso en las fechas | La persona asignada ya tiene otro trabajo. | §6, "no se puede agendar". |

<details>
<summary><b>▸ Ver detalle: situaciones que confunden</b></summary>

- **"No aparece el botón de mapas."** El pedido no tiene pin, o el siguiente paso no es un viaje. El
  botón solo sale cuando de verdad hay a dónde llevarlo.
- **"El calendario dejó de actualizarse."** Si usa la suscripción, revise que el enlace no se haya
  regenerado. Si usa Google, reconéctelo desde Ajustes → Calendarios.
- **"No me llegan los eventos de un pedido."** Revise a quién está **asignado**: los eventos van solo
  al calendario de esa persona.
- **"Un producto no aparece al crear un pedido."** Puede estar desactivado (se eliminó estando en uso)
  o sin unidades libres en esas fechas.
- **"Falta configuración."** Un catálogo necesario está vacío. El aviso lleva directo a Preferencias.
- **"El documento no imprime mi segunda cuenta."** No se ha agregado en Preferencias → Documentos.

</details>

---

<sub>Este manual describe la aplicación tal como funciona hoy. Si algo en pantalla no coincide con lo
aquí descrito, la pantalla manda — y el manual necesita corrección.</sub>
