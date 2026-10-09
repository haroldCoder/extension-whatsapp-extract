# 💬 WhatsApp Web Message Extractor (Extensión de Navegador)

Extensión de navegador moderna (Google Chrome, Microsoft Edge, Brave, Opera) construida bajo el estándar **Manifest V3** para capturar, filtrar y listar mensajes de **WhatsApp Web** con un solo clic o pasando el cursor sobre cualquier conversación.

---

## ⚡ Características Principales

1. **🌐 Extracción Automática de TODOS los Chats de Hoy (Sin seleccionar ningún chat)**:
   - Con un solo clic en **"🌐 Escanear Todos los Chats de Hoy"**, la extensión escanea de forma autónoma la lista de contactos en WhatsApp Web, detecta todas las conversaciones con actividad del día actual, abre y extrae los mensajes de hoy de cada una, y los agrupa en una vista global unificada.
   - Cada mensaje incluye la etiqueta con el nombre del contacto remitente.

2. **Acción al pasar el cursor (Hover en chats)**:
   - Al posarte sobre cualquier chat de la lista izquierda de WhatsApp Web, aparecen automáticamente botones rápidos:
     - ⚡ **Nuevos**: Lista únicamente los mensajes nuevos / no leídos.
     - 📅 **De Hoy**: Lista todos los mensajes intercambiados en el día actual de este chat.
     - 📥 **Todo**: Abre la conversación y extrae todos los mensajes visibles.

3. **Drawer / Panel flotante dentro de WhatsApp Web**:
   - Botón flotante (*FAB*) integrado directamente en la interfaz de WhatsApp Web con contador de mensajes.
   - Panel lateral desplegable con tema oscuro fiel a WhatsApp.
   - Botón directo: **"🌐 Escanear Todos los Chats de Hoy"** y selector para alternar entre la vista global y el chat actual.
   - Botones rápidos: **Todos**, **De Hoy** y **Nuevos**.
   - Buscador por texto en tiempo real y filtros (`Todos`, `De Hoy`, `Nuevos`, `Recibidos`, `Enviados`).
   - Copiado individual o masivo al portapapeles y exportación a JSON o TXT.

4. **Popup de la Extensión**:
   - Accesible desde la barra de herramientas del navegador haciendo clic en el icono de la extensión.
   - Botón superior: **"🌐 Escanear Todos los Chats de Hoy"**.
   - Selector que incluye la opción principal **"🌟 Todos los chats de hoy (Global)"**.
   - Exportación global o por chat a **JSON** y **TXT / CSV**.

---

## 🚀 Instalación Rápida en el Navegador

La extensión ya está completamente lista en la carpeta [`extension/`](file:///c:/Users/User/Documents/extension-whatsapp-extract/extension).

### Pasos:

1. Abre tu navegador (Chrome, Edge o Brave) y ve a:
   ```text
   chrome://extensions
   ```
   *(En Microsoft Edge es `edge://extensions`)*.

2. Activa el interruptor **"Modo de desarrollador"** (ubicado en la esquina superior derecha).

3. Haz clic en el botón **"Cargar descomprimida"** (o *Load unpacked*).

4. Selecciona la carpeta del proyecto:
   ```text
   c:\Users\User\Documents\extension-whatsapp-extract\extension
   ```

5. ¡Listo! Abre [web.whatsapp.com](https://web.whatsapp.com) y verás la extensión funcionando activamente.

---

## 📁 Estructura del Proyecto

```text
extension-whatsapp-extract/
├── extension/                       <-- Carpeta lista para cargar en Chrome
│   ├── manifest.json                # Configuración Manifest V3 y permisos
│   ├── background.js                # Service Worker en segundo plano
│   ├── content.js                   # Inyección en WhatsApp Web y extracción DOM
│   ├── content.css                  # Estilos del botón flotante y drawer lateral
│   ├── popup.html                   # Interfaz de la ventana emergente de la extensión
│   ├── popup.css                    # Estilos modernos para el popup
│   ├── popup.js                     # Lógica y comunicación de la extensión
│   └── icons/                       # Iconos de 16px, 48px y 128px
├── app/                             # Dashboard web interactivo y simulador (Next.js)
│   ├── page.tsx                     # Simulador interactivo en tiempo real
│   └── globals.css
└── README.md
```

---

## 🎮 Simulador Web Interactivo

Si deseas probar la experiencia y ver cómo funciona el comportamiento de hover y extracción antes de abrir WhatsApp:

Ejecuta el servidor local:
```bash
npm run dev
```
Y abre [http://localhost:3000](http://localhost:3000) en tu navegador.
