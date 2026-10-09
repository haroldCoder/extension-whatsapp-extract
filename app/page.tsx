'use client';

import { useState } from 'react';

interface SimulatedMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  isNew: boolean;
  type: 'incoming' | 'outgoing';
}

interface SimulatedChat {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  unreadCount: number;
  time: string;
  messages: SimulatedMessage[];
}

const INITIAL_CHATS: SimulatedChat[] = [
  {
    id: '1',
    name: 'Carlos Mendoza (Cliente)',
    avatar: '👨‍💼',
    lastMessage: 'Por favor envíame la cotización actualizada del proyecto.',
    unreadCount: 3,
    time: '14:25',
    messages: [
      { id: 'm1', sender: 'Carlos Mendoza', text: 'Hola, buenas tardes.', timestamp: '14:15', isNew: false, type: 'incoming' },
      { id: 'm2', sender: 'Tú', text: '¡Hola Carlos! ¿En qué te puedo ayudar hoy?', timestamp: '14:18', isNew: false, type: 'outgoing' },
      { id: 'm3', sender: 'Carlos Mendoza', text: 'Revisé los requerimientos con el equipo de finanzas.', timestamp: '14:22', isNew: true, type: 'incoming' },
      { id: 'm4', sender: 'Carlos Mendoza', text: 'Necesitamos incluir 2 licencias adicionales en la propuesta.', timestamp: '14:24', isNew: true, type: 'incoming' },
      { id: 'm5', sender: 'Carlos Mendoza', text: 'Por favor envíame la cotización actualizada del proyecto.', timestamp: '14:25', isNew: true, type: 'incoming' },
    ]
  },
  {
    id: '2',
    name: 'Equipo de Soporte & Devs',
    avatar: '🚀',
    lastMessage: 'El nuevo despliegue a producción fue exitoso.',
    unreadCount: 2,
    time: '13:50',
    messages: [
      { id: 'm6', sender: 'Laura Dev', text: 'Iniciando pipeline de testing...', timestamp: '13:40', isNew: false, type: 'incoming' },
      { id: 'm7', sender: 'Tú', text: 'Avisen en cuanto pasen los tests e2e.', timestamp: '13:42', isNew: false, type: 'outgoing' },
      { id: 'm8', sender: 'Laura Dev', text: 'Todos los tests pasaron en verde ✅', timestamp: '13:48', isNew: true, type: 'incoming' },
      { id: 'm9', sender: 'Andrés Lead', text: 'El nuevo despliegue a producción fue exitoso.', timestamp: '13:50', isNew: true, type: 'incoming' },
    ]
  },
  {
    id: '3',
    name: 'María Gómez (Ventas)',
    avatar: '👩‍💻',
    lastMessage: 'Agendé la demo para mañana a las 10 AM.',
    unreadCount: 0,
    time: '11:10',
    messages: [
      { id: 'm10', sender: 'María Gómez', text: 'El prospecto confirmó disponibilidad.', timestamp: '11:05', isNew: false, type: 'incoming' },
      { id: 'm11', sender: 'María Gómez', text: 'Agendé la demo para mañana a las 10 AM.', timestamp: '11:10', isNew: false, type: 'incoming' },
    ]
  }
];

export default function Home() {
  const [chats] = useState<SimulatedChat[]>(INITIAL_CHATS);
  const [selectedChat, setSelectedChat] = useState<SimulatedChat>(INITIAL_CHATS[0]);
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [extractedMessages, setExtractedMessages] = useState<SimulatedMessage[]>([]);
  const [lastExtractedChat, setLastExtractedChat] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'new' | 'incoming' | 'outgoing'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'simulator' | 'installGuide' | 'codeOverview'>('simulator');

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleExtract = (chat: SimulatedChat, onlyNew: boolean) => {
    setSelectedChat(chat);
    setLastExtractedChat(chat.name);
    const msgs = onlyNew ? chat.messages.filter(m => m.isNew) : [...chat.messages];
    setExtractedMessages(msgs);
    triggerToast(`¡${msgs.length} mensajes ${onlyNew ? 'nuevos ' : ''}extraídos de "${chat.name}"!`);
  };

  const filteredFeed = extractedMessages.filter(m => {
    if (filterMode === 'new' && !m.isNew) return false;
    if (filterMode === 'incoming' && m.type !== 'incoming') return false;
    if (filterMode === 'outgoing' && m.type !== 'outgoing') return false;
    if (searchQuery && !m.text.toLowerCase().includes(searchQuery.toLowerCase()) && !m.sender.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  const handleCopyAll = () => {
    if (extractedMessages.length === 0) return;
    const text = extractedMessages.map(m => `[${m.timestamp}] ${m.sender}: ${m.text}`).join('\n');
    navigator.clipboard.writeText(text);
    triggerToast('¡Mensajes copiados al portapapeles!');
  };

  const handleDownloadJSON = () => {
    if (extractedMessages.length === 0) return;
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(extractedMessages, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `whatsapp_${lastExtractedChat.replace(/\s+/g, '_')}.json`);
    dl.click();
    triggerToast('Descargando archivo JSON...');
  };

  return (
    <div className="min-h-screen bg-[#0c1317] text-[#e9edef] font-sans antialiased flex flex-col">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#202c33] border border-[#00a884] text-[#e9edef] px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-bounce">
          <span className="text-emerald-400 font-bold">✓</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navigation */}
      <header className="border-b border-[#222e35] bg-[#111b21] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#00a884] to-[#25d366] flex items-center justify-center text-white shadow-lg shadow-emerald-900/30">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              <path d="M8 10h8"></path>
              <path d="M8 14h4"></path>
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              WhatsApp Message Extractor
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Extensión Chrome MV3
              </span>
            </h1>
            <p className="text-xs text-[#8696a0]">
              Captura mensajes al posarte sobre cualquier chat o desde el panel de la extensión
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-[#202c33] p-1 rounded-xl border border-[#2a3942]">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'simulator' ? 'bg-[#00a884] text-white shadow-sm' : 'text-[#8696a0] hover:text-white'
            }`}
          >
            🎮 Simulador Interactivo
          </button>
          <button
            onClick={() => setActiveTab('installGuide')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'installGuide' ? 'bg-[#00a884] text-white shadow-sm' : 'text-[#8696a0] hover:text-white'
            }`}
          >
            📦 Cómo Instalar en Chrome
          </button>
          <button
            onClick={() => setActiveTab('codeOverview')}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'codeOverview' ? 'bg-[#00a884] text-white shadow-sm' : 'text-[#8696a0] hover:text-white'
            }`}
          >
            📂 Estructura de Archivos
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto flex flex-col gap-6">
        {activeTab === 'simulator' && (
          <div className="flex flex-col gap-6">
            {/* Instruction Banner */}
            <div className="bg-[#182229] border border-[#2a3942] rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">💡</span>
                <div>
                  <h3 className="text-sm font-semibold text-emerald-400">Pruébalo en tiempo real:</h3>
                  <p className="text-xs text-[#8696a0]">
                    Pasa el cursor sobre cualquiera de los chats en la columna izquierda. Verás aparecer los botones <strong>⚡ Nuevos</strong> y <strong>📥 Listar este chat</strong> tal como funciona en WhatsApp Web.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#8696a0]">Carpeta de la extensión:</span>
                <code className="text-xs font-mono bg-[#111b21] px-2.5 py-1 rounded-md text-emerald-300 border border-[#222e35]">
                  /extension
                </code>
              </div>
            </div>

            {/* Interactive WhatsApp Web Simulation Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[600px]">
              {/* WhatsApp Web Left Sidebar Simulation */}
              <div className="lg:col-span-4 bg-[#111b21] rounded-2xl border border-[#222e35] flex flex-col overflow-hidden shadow-xl">
                <div className="bg-[#202c33] p-3.5 border-b border-[#2a3942] flex items-center justify-between">
                  <span className="text-xs font-bold text-[#e9edef] uppercase tracking-wider">Chats de WhatsApp Web</span>
                  <span className="text-[11px] text-[#8696a0]">Simulación DOM</span>
                </div>

                <div className="divide-y divide-[#202c33]/40 flex-1 overflow-y-auto">
                  {chats.map(chat => {
                    const isSelected = selectedChat.id === chat.id;
                    const isHovered = hoveredChatId === chat.id;

                    return (
                      <div
                        key={chat.id}
                        onMouseEnter={() => setHoveredChatId(chat.id)}
                        onMouseLeave={() => setHoveredChatId(null)}
                        onClick={() => setSelectedChat(chat)}
                        className={`relative p-3.5 flex items-center gap-3 cursor-pointer transition-colors ${
                          isSelected ? 'bg-[#2a3942]/60' : 'hover:bg-[#202c33]/40'
                        }`}
                      >
                        <div className="w-11 h-11 rounded-full bg-[#202c33] flex items-center justify-center text-xl shrink-0 border border-[#2a3942]">
                          {chat.avatar}
                        </div>

                        <div className="flex-1 min-w-0 pr-12">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold truncate text-[#e9edef]">{chat.name}</span>
                            <span className="text-[10px] text-[#8696a0]">{chat.time}</span>
                          </div>
                          <p className="text-xs text-[#8696a0] truncate mt-0.5">{chat.lastMessage}</p>
                        </div>

                        {chat.unreadCount > 0 && !isHovered && (
                          <span className="w-5 h-5 rounded-full bg-[#25d366] text-[#111b21] font-bold text-[10px] flex items-center justify-center shrink-0">
                            {chat.unreadCount}
                          </span>
                        )}

                        {/* Hover Quick Action Buttons (Exact feature requested by user!) */}
                        {isHovered && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 z-10 bg-[#111b21]/95 backdrop-blur-md px-2 py-1.5 rounded-full border border-emerald-500/40 shadow-xl animate-fadeIn">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExtract(chat, true);
                              }}
                              className="px-2.5 py-1 rounded-full bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-black font-semibold text-[10px] transition-all flex items-center gap-1 border border-emerald-500/30"
                              title="Capturar mensajes nuevos"
                            >
                              <span>⚡</span>
                              <span>{chat.unreadCount > 0 ? `${chat.unreadCount} Nuevos` : 'Nuevos'}</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExtract(chat, false);
                              }}
                              className="px-2.5 py-1 rounded-full bg-[#202c33] hover:bg-[#00a884] text-white font-semibold text-[10px] transition-all flex items-center gap-1 border border-[#2a3942]"
                              title="Capturar todo el chat"
                            >
                              <span>📥</span>
                              <span>Todo</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 bg-[#182229] border-t border-[#222e35] text-center text-[11px] text-[#8696a0]">
                  💡 Pasa el ratón sobre un chat para ver los botones rápidos
                </div>
              </div>

              {/* Active Chat Conversation Panel */}
              <div className="lg:col-span-4 bg-[#0b141a] rounded-2xl border border-[#222e35] flex flex-col overflow-hidden shadow-xl">
                {/* Header */}
                <div className="bg-[#202c33] p-3.5 border-b border-[#2a3942] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">{selectedChat.avatar}</span>
                    <div>
                      <h4 className="text-sm font-semibold text-white">{selectedChat.name}</h4>
                      <span className="text-[10px] text-emerald-400">en línea</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleExtract(selectedChat, true)}
                      className="px-2.5 py-1 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded-lg font-medium transition-colors"
                    >
                      ⚡ Extraer Nuevos
                    </button>
                    <button
                      onClick={() => handleExtract(selectedChat, false)}
                      className="px-2.5 py-1 text-xs bg-[#00a884] hover:bg-[#008f6f] text-white rounded-lg font-medium transition-colors"
                    >
                      📥 Extraer Todo
                    </button>
                  </div>
                </div>

                {/* Messages Feed in WhatsApp */}
                <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 bg-[radial-gradient(#202c33_1px,transparent_1px)] [background-size:16px_16px]">
                  {selectedChat.messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-xs relative ${
                        msg.type === 'outgoing'
                          ? 'ml-auto bg-[#005c4b] text-white rounded-tr-none'
                          : 'mr-auto bg-[#202c33] text-[#e9edef] rounded-tl-none'
                      } ${msg.isNew ? 'ring-2 ring-emerald-400/60' : ''}`}
                    >
                      {msg.isNew && (
                        <div className="text-[9px] font-extrabold uppercase text-emerald-300 mb-0.5 tracking-wider">
                          ★ Mensaje Nuevo
                        </div>
                      )}
                      <p className="leading-relaxed">{msg.text}</p>
                      <div className="text-[9px] text-right mt-1 opacity-70 flex items-center justify-end gap-1">
                        <span>{msg.timestamp}</span>
                        {msg.type === 'outgoing' && <span>✓✓</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="p-3 bg-[#202c33] border-t border-[#2a3942] flex items-center justify-between text-xs text-[#8696a0]">
                  <span>Total en chat: {selectedChat.messages.length} mensajes</span>
                  <span>{selectedChat.messages.filter(m => m.isNew).length} sin leer</span>
                </div>
              </div>

              {/* Extension Result / Extractor Panel Simulation */}
              <div className="lg:col-span-4 bg-[#111b21] rounded-2xl border border-emerald-500/30 flex flex-col overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="bg-[#202c33] p-3.5 border-b border-[#2a3942] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">📋</span>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Panel de la Extensión
                    </span>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {extractedMessages.length} capturados
                  </span>
                </div>

                {/* Filters & Search */}
                <div className="p-3 bg-[#182229] border-b border-[#222e35] flex flex-col gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="🔍 Filtrar palabras clave..."
                    className="w-full bg-[#202c33] border border-[#2a3942] text-xs text-white rounded-lg px-3 py-1.5 outline-none focus:border-emerald-500"
                  />
                  <div className="flex gap-1.5">
                    {(['all', 'new', 'incoming', 'outgoing'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => setFilterMode(mode)}
                        className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                          filterMode === mode
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-[#202c33] text-[#8696a0] hover:text-white'
                        }`}
                      >
                        {mode === 'all' && 'Todos'}
                        {mode === 'new' && 'Nuevos'}
                        {mode === 'incoming' && 'Recibidos'}
                        {mode === 'outgoing' && 'Enviados'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Extracted Message Feed */}
                <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2.5">
                  {filteredFeed.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#8696a0]">
                      <span className="text-3xl mb-2">💬</span>
                      <p className="text-xs font-semibold text-white">Ningún mensaje listado aún</p>
                      <p className="text-[11px] mt-1">
                        Pasa el ratón sobre un chat en la lista o haz clic en <strong>Extraer</strong>.
                      </p>
                    </div>
                  ) : (
                    filteredFeed.map(msg => (
                      <div
                        key={msg.id}
                        className={`p-2.5 rounded-xl border text-xs flex flex-col gap-1 transition-all ${
                          msg.type === 'outgoing'
                            ? 'bg-[#005c4b]/30 border-emerald-500/30'
                            : 'bg-[#202c33]/70 border-[#2a3942]'
                        } ${msg.isNew ? 'ring-1 ring-emerald-400' : ''}`}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-emerald-400">{msg.sender}</span>
                          <div className="flex items-center gap-1.5">
                            {msg.isNew && (
                              <span className="bg-emerald-400 text-black text-[9px] font-extrabold px-1.5 rounded">
                                NUEVO
                              </span>
                            )}
                            <span className="text-[#8696a0] text-[10px]">{msg.timestamp}</span>
                          </div>
                        </div>
                        <p className="text-[#e9edef] text-xs leading-relaxed">{msg.text}</p>
                      </div>
                    ))
                  )}
                </div>

                {/* Action Buttons */}
                <div className="p-3 bg-[#182229] border-t border-[#222e35] flex items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopyAll}
                      disabled={extractedMessages.length === 0}
                      className="px-3 py-1.5 text-xs bg-[#202c33] hover:bg-[#2a3942] disabled:opacity-50 text-white rounded-lg border border-[#2a3942] transition-colors"
                    >
                      📋 Copiar
                    </button>
                    <button
                      onClick={handleDownloadJSON}
                      disabled={extractedMessages.length === 0}
                      className="px-3 py-1.5 text-xs bg-[#202c33] hover:bg-[#2a3942] disabled:opacity-50 text-white rounded-lg border border-[#2a3942] transition-colors"
                    >
                      💾 JSON
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setExtractedMessages([]);
                      triggerToast('Lista de mensajes limpiada');
                    }}
                    disabled={extractedMessages.length === 0}
                    className="px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg disabled:opacity-30"
                  >
                    🗑️ Limpiar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Installation Guide Tab */}
        {activeTab === 'installGuide' && (
          <div className="bg-[#111b21] border border-[#222e35] rounded-2xl p-8 max-w-4xl mx-auto shadow-xl">
            <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-4">
              <span>🚀</span> Cómo Cargar la Extensión en tu Navegador
            </h2>
            <p className="text-sm text-[#8696a0] mb-6">
              La extensión está programada bajo el estándar oficial <strong>Manifest V3</strong> y es 100% compatible con Google Chrome, Microsoft Edge, Brave, Opera y navegadores basados en Chromium.
            </p>

            <div className="space-y-6">
              <div className="flex gap-4 items-start bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-black font-extrabold flex items-center justify-center shrink-0">
                  1
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Abre la página de extensiones del navegador</h4>
                  <p className="text-xs text-[#8696a0] mt-1">
                    En la barra de direcciones de tu navegador escribe:
                  </p>
                  <code className="inline-block mt-2 bg-[#111b21] text-emerald-400 px-3 py-1 rounded border border-[#222e35] text-xs font-mono">
                    chrome://extensions
                  </code>
                </div>
              </div>

              <div className="flex gap-4 items-start bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-black font-extrabold flex items-center justify-center shrink-0">
                  2
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Activa el "Modo de desarrollador"</h4>
                  <p className="text-xs text-[#8696a0] mt-1">
                    En la esquina superior derecha de la pantalla de extensiones, enciende el interruptor que dice <strong>"Modo de desarrollador"</strong> (o <em>Developer mode</em>).
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-black font-extrabold flex items-center justify-center shrink-0">
                  3
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Haz clic en "Cargar descomprimida"</h4>
                  <p className="text-xs text-[#8696a0] mt-1">
                    Aparecerá un botón a la izquierda llamado <strong>"Cargar descomprimida"</strong> (o <em>Load unpacked</em>). Haz clic en él.
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-black font-extrabold flex items-center justify-center shrink-0">
                  4
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">Selecciona la carpeta de la extensión</h4>
                  <p className="text-xs text-[#8696a0] mt-1">
                    Navega a la carpeta de este proyecto y selecciona la subcarpeta:
                  </p>
                  <code className="inline-block mt-2 bg-[#111b21] text-emerald-400 px-3 py-1 rounded border border-[#222e35] text-xs font-mono">
                    c:\Users\User\Documents\extension-whatsapp-extract\extension
                  </code>
                </div>
              </div>

              <div className="flex gap-4 items-start bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-black font-extrabold flex items-center justify-center shrink-0">
                  5
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">¡Listo! Abre WhatsApp Web</h4>
                  <p className="text-xs text-[#8696a0] mt-1">
                    Dirígete a <a href="https://web.whatsapp.com" target="_blank" rel="noreferrer" className="text-emerald-400 underline">web.whatsapp.com</a>. Verás el botón flotante en la esquina inferior y cuando pases el cursor sobre cualquier chat de la lista izquierda verás los botones directos para listar todos los mensajes o únicamente los nuevos.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Code Overview Tab */}
        {activeTab === 'codeOverview' && (
          <div className="bg-[#111b21] border border-[#222e35] rounded-2xl p-8 max-w-4xl mx-auto shadow-xl">
            <h2 className="text-xl font-bold text-white mb-2">📁 Arquitectura de la Extensión</h2>
            <p className="text-xs text-[#8696a0] mb-6">
              Todos los archivos listos para usar se encuentran dentro del directorio <code className="text-emerald-400">/extension</code>.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <span className="text-emerald-400 font-mono text-xs font-bold block mb-1">extension/manifest.json</span>
                <p className="text-xs text-[#8696a0]">
                  Configuración de Manifest V3 con permisos para <code className="text-white">storage</code>, <code className="text-white">activeTab</code> y host permissions para <code className="text-white">web.whatsapp.com</code>.
                </p>
              </div>

              <div className="bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <span className="text-emerald-400 font-mono text-xs font-bold block mb-1">extension/content.js</span>
                <p className="text-xs text-[#8696a0]">
                  Script inyectado en WhatsApp Web. Detecta el hover sobre los chats de la lista, inyecta botones rápidos ("Listar nuevos", "Listar todo"), extrae los mensajes del DOM y proporciona el drawer lateral flotante.
                </p>
              </div>

              <div className="bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <span className="text-emerald-400 font-mono text-xs font-bold block mb-1">extension/content.css</span>
                <p className="text-xs text-[#8696a0]">
                  Estilos de interfaz inyectados: botones al pasar el ratón, botón flotante (FAB) y drawer lateral con tema oscuro de WhatsApp.
                </p>
              </div>

              <div className="bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <span className="text-emerald-400 font-mono text-xs font-bold block mb-1">extension/popup.html / js / css</span>
                <p className="text-xs text-[#8696a0]">
                  Ventana emergente que se abre al hacer clic en el icono de la extensión en la barra de herramientas del navegador. Lista chats guardados, búsqueda, filtros y exportación a JSON/TXT.
                </p>
              </div>

              <div className="bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <span className="text-emerald-400 font-mono text-xs font-bold block mb-1">extension/background.js</span>
                <p className="text-xs text-[#8696a0]">
                  Service worker en segundo plano para inicialización de almacenamiento, comunicación de mensajes y actualización del badge del contador.
                </p>
              </div>

              <div className="bg-[#182229] p-4 rounded-xl border border-[#2a3942]">
                <span className="text-emerald-400 font-mono text-xs font-bold block mb-1">extension/icons/</span>
                <p className="text-xs text-[#8696a0]">
                  Iconos en resoluciones estándar 16x16, 48x48 y 128x128 con diseño WhatsApp para la barra de herramientas del navegador.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
