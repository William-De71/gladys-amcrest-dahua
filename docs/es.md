# Amcrest / Dahua

## Presentación

Esta integración lleva a Gladys las cámaras, timbres y grabadores con **firmware Dahua**: Dahua, Amcrest, Lorex, Imou, EmpireTech y los numerosos modelos con otra marca que comparten la misma interfaz web. Todo ocurre **en su red local**: sin cuenta en la nube, ningún dato sale de su casa.

Cada cámara se convierte en un dispositivo de Gladys (un grabador da un dispositivo por cada cámara que graba):

| Función                 | Cuándo                                       | Tipo Gladys                 |
| ----------------------- | -------------------------------------------- | --------------------------- |
| Imagen                  | siempre                                      | `camera` / `image`          |
| Vídeo en directo        | siempre (RTSP, flujo principal o secundario) | widget de cámara            |
| Movimiento              | siempre                                      | `motion-sensor` / `binary`  |
| Persona, Vehículo       | detección de movimiento inteligente (SMD)    | `motion-sensor` / `binary`  |
| Cruce de línea          | existe una regla IVS «cruce de línea»        | `motion-sensor` / `binary`  |
| Intrusión               | existe una regla IVS «intrusión»             | `motion-sensor` / `binary`  |
| Timbre                  | VTO, Amcrest AD110 / AD410, Imou DB61i…      | `doorbell` / `ring`         |
| Detección de movimiento | la cámara puede activarla o desactivarla     | `switch` / `binary`         |
| Cámara activada         | modo privado (Amcrest, Imou)                 | `camera` / `enabled`        |
| Mover, Posición         | cámaras PTZ                                  | `camera` / `move`, `preset` |

Las detecciones son **instantáneas**: la integración mantiene abierto el flujo de eventos de cada dispositivo, como hacen las aplicaciones oficiales.

**Transporte**: solo local. Las cámaras se alcanzan por su API HTTP (`/cgi-bin`) y por RTSP; nada pasa por la nube de la marca, y el catálogo muestra la insignia «local».

## Requisitos

- Gladys **5.3.0** o posterior (palabras clave y países del catálogo, widgets del panel, activadores y acciones de escena).
- Una cámara, un timbre o un grabador con firmware Dahua, accesible desde Gladys, con **HTTP** activado (lo está por defecto) y **RTSP** activado para el vídeo en directo.
- La cuenta que usa en su interfaz web (`admin` en la mayoría de las instalaciones).
- Para la detección de personas y vehículos: una cámara con **detección de movimiento inteligente (SMD)** o reglas **IVS**, activadas en su interfaz web (Evento → Smart Motion Detection, o Evento → IVS).

## Configuración

1. Instale la integración desde la tienda.
2. Introduzca el **usuario** y la **contraseña** de sus cámaras y guarde.
3. Abra la pestaña **Descubrir** y lance una búsqueda: los dispositivos de su red responden por sí mismos (descubrimiento DHIP, el protocolo de la herramienta ConfigTool de Dahua). Añada las cámaras que desee.
4. Pulse **Probar la conexión** para ver, para cada dispositivo, su modelo, sus cámaras y lo que saben hacer.

| Campo                           | Por defecto | Uso                                                                                                        |
| ------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| Usuario                         | `admin`     | La cuenta de la interfaz web                                                                               |
| Contraseña                      | —           | Su contraseña. Cinco contraseñas erróneas bloquean la cuenta 30 minutos en la cámara                       |
| Actualización de imágenes       | 60          | Una nueva imagen del panel cada N segundos (10 a 3600, 0 = solo a petición y en las detecciones)           |
| Imagen en cada detección        | sí          | Una imagen cuando empieza un movimiento, una persona, un vehículo o una pulsación del timbre               |
| Flujo del vídeo en directo      | principal   | Flujo principal (resolución completa) o secundario (más ligero)                                            |
| Direcciones de los dispositivos | —           | Para un dispositivo que la búsqueda no encuentra: `192.168.1.108, 192.168.1.20:8080, https://192.168.1.30` |
| Cuentas por dispositivo         | —           | Para un dispositivo con otra cuenta: `dirección\|usuario\|contraseña`, separadas por comas                 |

Un grabador (NVR, DVR, XVR) da un dispositivo por cada cámara activada en él; los timbres y las cámaras, un dispositivo cada uno.

## Uso

### Panel

Añada un bloque **Cámara** para la imagen y el vídeo en directo, y los widgets de la integración:

![Los widgets Cámaras, Detecciones y Almacenamiento de grabación (ilustración generada, no es una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-amcrest-dahua/main/docs/assets/widgets.es.png)

- **Cámaras**: cuántas cámaras envían sus eventos, las detecciones de las últimas 24 horas, el estado y la última detección de cada cámara, y un botón para refrescar todas las imágenes.
- **Detecciones**: las últimas detecciones, de la más reciente a la más antigua, con la imagen tomada en ese momento (todas las cámaras, o una).
- **Almacenamiento de grabación**: la tarjeta SD o los discos de una cámara o un grabador: usado, libre, capacidad, estado.

### Escenas

Activadores:

- **Detección**: movimiento, persona, vehículo, línea cruzada, intrusión, sonido, sabotaje o timbre pulsado, filtrados por cámara y tipo. Variables: nombre de la cámara, tipo, nombre de la regla IVS, tipo de objeto.
- **Alarma**: vídeo perdido, entrada de alarma, fallo de almacenamiento, almacenamiento casi lleno, sin almacenamiento.
- **Cámara inaccesible** y **Cámara recuperada**.

Acciones:

- **Tomar una imagen**: una imagen reciente, lista para la acción «enviar la imagen de la cámara» que sigue.
- **Modo de grabación**: grabar siempre, seguir el horario de la cámara o no grabar.
- **Abrir la puerta**: la cerradura conectada a un videoportero Dahua (VTO).
- **Reiniciar**.

Ejemplos:

- Cuando se pulsa el timbre → tomar una imagen de la puerta principal → enviarla a la familia y encender la luz de la entrada.
- Cuando se detecta una persona en el jardín de noche y no hay nadie en casa → encender las luces del jardín y enviar la imagen.
- Cuando la última persona sale de casa → modo de grabación «grabar siempre»; cuando alguien llega → «horario de la cámara».

## Solución de problemas

- **«Contraseña rechazada»**: compruebe la cuenta en la interfaz web de la cámara. Tras un rechazo, la integración espera diez minutos antes de volver a preguntar (la cámara bloquea la cuenta 30 minutos tras cinco fallos); corrija la contraseña y pulse **Probar la conexión**.
- **La búsqueda no encuentra un dispositivo**: el descubrimiento usa un broadcast UDP en el puerto 37810, que no atraviesa las VLAN ni algunos aislamientos Wi-Fi. Introduzca su dirección en **Direcciones de los dispositivos**.
- **Una dirección no responde**: quizá HTTP está desactivado o en otro puerto (Red → Puerto en la interfaz web); añada `:puerto`, o `https://` si solo está activado HTTPS.
- **Sin vídeo en directo**: RTSP debe estar activado (Red → Puerto → RTSP, puerto 554 por defecto); tras cambiar el flujo o la contraseña, lance de nuevo una búsqueda para actualizar la dirección del vídeo.
- **Sin sensor de persona o vehículo**: active la detección de movimiento inteligente o una regla IVS en la cámara y lance de nuevo una búsqueda (una función solo se añade con una búsqueda).
- **No se ven las pulsaciones del timbre**: algunos firmwares VTO solo envían la pulsación por su propio protocolo DHIP, no por HTTP; abra una incidencia con el modelo y el firmware.
- Registros: la pestaña **Supervisión** de la integración. Informe de los problemas en GitHub con las versiones de Gladys y de la integración, el modelo y el firmware del dispositivo, y el resultado de **Probar la conexión**.
