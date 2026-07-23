import React, { useState, useRef } from 'react'
import {
  Power,
  Settings,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Trash2,
  Pencil,
  ScrollText,
  Sun,
  Moon,
  AlertTriangle,
  X,
  Plus,
  Globe,
  Focus,
  RotateCw,
  Loader2,
} from 'lucide-react'

/* ============================================================
   HelloWeb — rework visual (v3)
   ============================================================ */

const THEMES = {
  dark: {
    bg: '#15171b',
    sidebar: '#101216',
    panel: '#1d2026',
    panelSoft: '#23262d',
    border: '#2c3038',
    text: '#e7e9ec',
    muted: '#9298a2',
    accent: '#4cc38a',
    accentSoft: 'rgba(76,195,138,0.14)',
    warn: '#d9b13b',
    danger: '#e5484d',
    dangerSoft: 'rgba(229,72,77,0.12)',
    screenOff: '#0b0c0f',
    screenHint: '#4a515c',
    overlay: 'rgba(0,0,0,0.6)',
    knob: '#ffffff',
  },
  light: {
    bg: '#e3e1db',
    sidebar: '#d9d7d0',
    panel: '#efeee9',
    panelSoft: '#e7e5df',
    border: '#cfccc4',
    text: '#41444a',
    muted: '#7d8188',
    accent: '#2f8f63',
    accentSoft: 'rgba(47,143,99,0.13)',
    warn: '#a8862c',
    danger: '#bf4046',
    dangerSoft: 'rgba(191,64,70,0.10)',
    screenOff: '#191b1f',
    screenHint: '#5b6470',
    overlay: 'rgba(52,54,58,0.38)',
    knob: '#fbfaf7',
  },
}

/* status: "off" | "loading" | "on" | "error" */
const defaultScreen = (n) => ({
  id: n,
  name: `Tela ${n}`,
  status: 'off',
  volume: 70,
  muted: false,
  keepSession: true,
  source: 'poke',
  customUrl: '',
})

const iconBtn = (t, extra = {}) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: 10,
  border: `1px solid ${t.border}`,
  background: t.panelSoft,
  color: t.muted,
  cursor: 'pointer',
  transition: 'all .15s ease',
  ...extra,
})

const ledColor = (t, status) =>
  status === 'on'
    ? t.accent
    : status === 'loading'
      ? t.warn
      : status === 'error'
        ? t.danger
        : t.border

/* ---------- componentes estáveis ---------- */

function Modal({ t, title, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: t.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: t.panel,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          width: 'min(440px, 92vw)',
          padding: 22,
          boxShadow: '0 24px 60px rgba(0,0,0,.3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.text }}>{title}</h2>
          <button onClick={onClose} style={iconBtn(t, { width: 32, height: 32, borderRadius: 8 })}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Toggle({ t, value, onChange, label, desc }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        width: '100%',
        textAlign: 'left',
        background: value ? t.accentSoft : t.panelSoft,
        border: `1px solid ${value ? t.accent : t.border}`,
        borderRadius: 12,
        padding: '12px 14px',
        cursor: 'pointer',
        color: t.text,
        transition: 'all .18s ease',
        fontFamily: 'inherit',
      }}
    >
      <span>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{label}</span>
        {desc && (
          <span style={{ display: 'block', fontSize: 12, color: t.muted, marginTop: 2 }}>
            {desc}
          </span>
        )}
      </span>
      <span
        style={{
          flexShrink: 0,
          width: 42,
          height: 24,
          borderRadius: 99,
          background: value ? t.accent : t.border,
          position: 'relative',
          transition: 'background .18s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: value ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: t.knob,
            boxShadow: '0 1px 3px rgba(0,0,0,.3)',
            transition: 'left .18s ease',
          }}
        />
      </span>
    </button>
  )
}

function DangerBtn({ t, label, desc, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        background: t.dangerSoft,
        border: `1px solid ${t.danger}55`,
        borderRadius: 12,
        padding: '12px 14px',
        cursor: 'pointer',
        color: t.danger,
        textAlign: 'left',
        transition: 'all .15s ease',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = t.danger)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = t.danger + '55')}
    >
      <AlertTriangle size={18} style={{ flexShrink: 0 }} />
      <span>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 12, opacity: 0.8, marginTop: 2 }}>{desc}</span>
      </span>
    </button>
  )
}

/* Favicon do endereço da tela (como o ícone da aba do navegador) */
function Favicon({ t, url, title }) {
  const [err, setErr] = useState(false)
  let domain = ''
  try {
    domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname
  } catch {}
  const src = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : ''
  if (err || !src) {
    return <Globe size={20} style={{ color: t.muted, flexShrink: 0 }} title={title} />
  }
  return (
    <img
      src={src}
      onError={() => setErr(true)}
      width={22}
      height={22}
      style={{ borderRadius: 5, flexShrink: 0 }}
      title={title}
      alt={title}
    />
  )
}

/* Slider vertical estilo player de vídeo: clique define, segurar arrasta */
function VolumePopover({ t, volume, muted, onVolume, onToggleMute }) {
  const trackRef = useRef(null)
  const shown = muted ? 0 : volume

  const setFromY = (clientY) => {
    const r = trackRef.current.getBoundingClientRect()
    let v = Math.round((1 - (clientY - r.top) / r.height) * 100)
    v = Math.max(0, Math.min(100, v))
    onVolume(v)
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 10px)',
        left: '50%',
        transform: 'translateX(-50%)',
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 9,
        padding: '7px 6px 6px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        boxShadow: '0 10px 30px rgba(0,0,0,.3)',
        zIndex: 30,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        style={{ fontSize: 10, fontWeight: 700, color: t.text, fontVariantNumeric: 'tabular-nums' }}
      >
        {shown}%
      </span>
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setFromY(e.clientY)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) setFromY(e.clientY)
        }}
        style={{
          width: 13,
          height: 77,
          borderRadius: 99,
          background: t.panelSoft,
          border: `1px solid ${t.border}`,
          position: 'relative',
          cursor: 'pointer',
          touchAction: 'none',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
        title="Clique ou arraste para ajustar"
      >
        <div
          style={{
            width: '100%',
            height: `${shown}%`,
            background: `linear-gradient(180deg, ${t.accent}, ${t.accent}bb)`,
            transition: 'height .06s linear',
            pointerEvents: 'none',
          }}
        />
      </div>
      <button
        onClick={onToggleMute}
        title={muted ? 'Ativar som' : 'Silenciar'}
        style={iconBtn(t, {
          width: 26,
          height: 26,
          borderRadius: 7,
          color: muted ? t.danger : t.muted,
          borderColor: muted ? t.danger + '66' : t.border,
        })}
      >
        {muted || volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
    </div>
  )
}

/* ============================================================ */

export default function HelloWeb() {
  const [theme, setTheme] = useState('dark')
  const t = THEMES[theme]

  const [screens, setScreens] = useState([1, 2, 3, 4].map(defaultScreen))
  const [fullscreenId, setFullscreenId] = useState(null)
  const [focusId, setFocusId] = useState(null)
  const [audioFocus, setAudioFocus] = useState(false)
  const [volumeOpenId, setVolumeOpenId] = useState(null)
  const [thumbHeight, setThumbHeight] = useState(100)
  const dragRef = useRef({ startY: 0, startH: 100 })

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)

  const allOn = screens.length > 0 && screens.every((s) => s.status !== 'off')
  const canAdd = screens.length < 4

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }

  const update = (id, patch) =>
    setScreens((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  /* liga a tela: carregando -> em execução (ou erro).
     No protótipo o resultado é simulado; no app real vem dos eventos do webview. */
  const powerOn = (id) => {
    update(id, { status: 'loading' })
    setTimeout(() => {
      setScreens((prev) =>
        prev.map((s) => {
          if (s.id !== id || s.status !== 'loading') return s
          const badUrl = s.source === 'custom' && !s.customUrl.trim()
          const fail = badUrl || Math.random() < 0.15 // simulação de falha p/ demonstrar o estado
          return { ...s, status: fail ? 'error' : 'on' }
        }),
      )
    }, 1100)
  }

  const powerOff = (id) => update(id, { status: 'off' })

  const reload = (id) => {
    const s = screens.find((x) => x.id === id)
    if (!s || s.status === 'off') return
    powerOn(id)
  }

  const togglePowerAll = () => {
    if (allOn) {
      setScreens((prev) => prev.map((s) => ({ ...s, status: 'off' })))
      showToast('Todas as telas desligadas')
    } else {
      screens.filter((s) => s.status === 'off').forEach((s) => powerOn(s.id))
      showToast('Ligando todas as telas…')
    }
  }

  const removeScreen = (id) => {
    setConfirm({
      title: 'Apagar tela',
      desc: 'O perfil deste slot será arquivado: o cache, os cookies e as senhas salvas nele deixam de ser usados. Use "Limpar arquivados" para apagá-los de vez.',
      danger: false,
      onYes: () => {
        setScreens((prev) => prev.filter((s) => s.id !== id))
        if (fullscreenId === id) setFullscreenId(null)
        if (focusId === id) setFocusId(null)
        if (volumeOpenId === id) setVolumeOpenId(null)
        showToast('Tela removida')
      },
    })
  }

  const addScreen = () => {
    if (!canAdd) return
    const used = screens.map((s) => s.id)
    let n = 1
    while (used.includes(n)) n++
    setScreens((prev) => [...prev, defaultScreen(n)].sort((a, b) => a.id - b.id))
    showToast(`Tela ${n} adicionada`)
  }

  const editing = screens.find((s) => s.id === editId) || null
  const fsScreen = screens.find((s) => s.id === fullscreenId) || null
  const focusScreen = screens.find((s) => s.id === focusId) || null
  const thumbs = focusScreen ? screens.filter((s) => s.id !== focusId) : []

  const count = screens.length
  const gridCols = count <= 1 ? '1fr' : '1fr 1fr'
  const gridRows = count <= 2 ? '1fr' : '1fr 1fr'

  const renderViewport = (s) => {
    if (s.status === 'off') {
      return (
        <button
          onClick={() => powerOn(s.id)}
          title="Ligar tela"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.screenHint,
            transition: 'color .15s ease',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.screenHint)}
        >
          <Power size={30} />
          <span style={{ fontSize: 12 }}>Ligar</span>
        </button>
      )
    }
    if (s.status === 'loading') {
      return (
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            color: t.screenHint,
          }}
        >
          <Loader2 size={26} style={{ animation: 'hw-spin 1s linear infinite', color: t.warn }} />
          <span style={{ fontSize: 12 }}>Carregando…</span>
        </span>
      )
    }
    if (s.status === 'error') {
      return (
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            color: t.screenHint,
            padding: 10,
            textAlign: 'center',
          }}
        >
          <AlertTriangle size={26} style={{ color: t.danger }} />
          <span style={{ fontSize: 12 }}>
            {s.source === 'custom' && !s.customUrl.trim()
              ? 'Endereço não configurado. Edite a tela e informe um endereço.'
              : 'Não foi possível carregar a página.'}
          </span>
          <button
            onClick={() => powerOn(s.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: `1px solid ${t.border}`,
              borderRadius: 8,
              padding: '7px 14px',
              cursor: 'pointer',
              color: t.text,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              transition: 'all .15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = t.accent)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = t.border)}
          >
            <RotateCw size={13} />
            Tentar novamente
          </button>
        </span>
      )
    }
    return (
      <span style={{ color: t.screenHint, fontSize: 12, letterSpacing: 1 }}>
        ▶ conteúdo da tela em execução
      </span>
    )
  }

  const renderTile = (s, expanded) => {
    const active = s.status !== 'off'
    return (
      <div
        key={s.id}
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: t.panel,
          border: expanded ? 'none' : `1px solid ${s.status === 'on' ? t.accent + '66' : t.border}`,
          borderRadius: expanded ? 0 : 6,
          overflow: 'hidden',
          height: '100%',
          transition: 'border-color .2s ease',
          boxShadow:
            s.status === 'on'
              ? `0 0 0 1px ${t.accent}22, 0 8px 24px rgba(0,0,0,.15)`
              : '0 4px 14px rgba(0,0,0,.08)',
        }}
      >
        {/* cabeçalho */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <span
            title={
              s.status === 'on'
                ? 'Ligada'
                : s.status === 'loading'
                  ? 'Carregando'
                  : s.status === 'error'
                    ? 'Erro'
                    : 'Desligada'
            }
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: ledColor(t, s.status),
              boxShadow: active ? `0 0 8px ${ledColor(t, s.status)}` : 'none',
              transition: 'all .25s ease',
              flexShrink: 0,
            }}
          />
          <span
            onClick={() => setFocusId(focusId === s.id ? null : s.id)}
            title={focusId === s.id ? 'Sair do foco' : 'Focar nesta tela'}
            style={{
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              transition: 'color .15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = t.accent)}
            onMouseLeave={(e) => (e.currentTarget.style.color = t.text)}
          >
            {s.name}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
            <Favicon
              t={t}
              url={s.source === 'poke' ? 'https://pokeidleworld.com' : s.customUrl}
              title={
                s.source === 'poke' ? 'Poke IdleWorld' : s.customUrl || 'Endereço personalizado'
              }
            />
          </span>
        </div>

        {/* viewport */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            background: t.screenOff,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 100,
          }}
        >
          {renderViewport(s)}
        </div>

        {/* barra de controles */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            borderTop: `1px solid ${t.border}`,
            background: t.panelSoft,
          }}
        >
          <button
            title={active ? 'Desligar' : 'Ligar'}
            onClick={() => (active ? powerOff(s.id) : powerOn(s.id))}
            style={iconBtn(t, {
              width: 34,
              height: 34,
              color: active ? t.accent : t.muted,
              borderColor: active ? t.accent : t.border,
              background: active ? t.accentSoft : t.panel,
            })}
          >
            <Power size={16} />
          </button>

          <button
            title="Recarregar"
            onClick={() => reload(s.id)}
            disabled={s.status === 'off'}
            style={iconBtn(t, {
              width: 34,
              height: 34,
              background: t.panel,
              cursor: s.status === 'off' ? 'not-allowed' : 'pointer',
              opacity: s.status === 'off' ? 0.45 : 1,
            })}
          >
            <RotateCw
              size={15}
              style={
                s.status === 'loading' ? { animation: 'hw-spin 1s linear infinite' } : undefined
              }
            />
          </button>

          {/* volume */}
          <div style={{ position: 'relative' }}>
            <button
              title="Volume"
              onClick={(e) => {
                e.stopPropagation()
                setVolumeOpenId(volumeOpenId === s.id ? null : s.id)
              }}
              style={iconBtn(t, {
                width: 34,
                height: 34,
                background: volumeOpenId === s.id ? t.accentSoft : t.panel,
                color: volumeOpenId === s.id ? t.accent : s.muted ? t.danger : t.muted,
                borderColor: volumeOpenId === s.id ? t.accent : t.border,
              })}
            >
              {s.muted || s.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            {volumeOpenId === s.id && (
              <VolumePopover
                t={t}
                volume={s.volume}
                muted={s.muted}
                onVolume={(v) => update(s.id, { volume: v, muted: v === 0 })}
                onToggleMute={() => update(s.id, { muted: !s.muted })}
              />
            )}
          </div>

          <div style={{ flex: 1 }} />

          <button
            title={focusId === s.id ? 'Sair do foco' : 'Focar nesta tela'}
            onClick={() => setFocusId(focusId === s.id ? null : s.id)}
            style={iconBtn(t, {
              width: 34,
              height: 34,
              background: focusId === s.id ? t.accentSoft : t.panel,
              color: focusId === s.id ? t.accent : t.muted,
              borderColor: focusId === s.id ? t.accent : t.border,
            })}
          >
            <Focus size={16} />
          </button>
          <button
            title={expanded ? 'Sair da tela cheia' : 'Tela cheia'}
            onClick={() => setFullscreenId(expanded ? null : s.id)}
            style={iconBtn(t, { width: 34, height: 34, background: t.panel })}
          >
            {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            title="Editar tela"
            onClick={() => setEditId(s.id)}
            style={iconBtn(t, { width: 34, height: 34, background: t.panel })}
          >
            <Pencil size={16} />
          </button>
          <button
            title="Apagar tela"
            onClick={() => removeScreen(s.id)}
            style={iconBtn(t, {
              width: 34,
              height: 34,
              background: t.panel,
              color: t.danger,
              borderColor: t.danger + '44',
            })}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    )
  }

  /* miniatura discreta: clique para trazer ao foco */
  const renderThumb = (s) => (
    <button
      key={s.id}
      onClick={() => setFocusId(s.id)}
      title={`Focar na ${s.name}`}
      style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        background: t.panel,
        cursor: 'pointer',
        border: `1px solid ${s.status === 'on' ? t.accent + '55' : t.border}`,
        borderRadius: 6,
        overflow: 'hidden',
        textAlign: 'left',
        opacity: 0.85,
        transition: 'all .15s ease',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = 1
        e.currentTarget.style.borderColor = t.accent
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = 0.85
        e.currentTarget.style.borderColor = s.status === 'on' ? t.accent + '55' : t.border
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderBottom: `1px solid ${t.border}`,
          color: t.text,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: ledColor(t, s.status),
            boxShadow: s.status !== 'off' ? `0 0 5px ${ledColor(t, s.status)}` : 'none',
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 600 }}>{s.name}</span>
      </span>
      <span
        style={{
          flex: 1,
          background: t.screenOff,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: t.screenHint,
          fontSize: 10,
          letterSpacing: 0.5,
        }}
      >
        {s.status === 'on'
          ? '▶ em execução'
          : s.status === 'loading'
            ? 'carregando…'
            : s.status === 'error'
              ? 'erro ao carregar'
              : 'desligada'}
      </span>
    </button>
  )

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100vh',
        background: t.bg,
        color: t.text,
        fontFamily: "'Sora', 'Segoe UI', system-ui, sans-serif",
        transition: 'background .25s ease, color .25s ease',
        overflow: 'hidden',
      }}
      onClick={() => volumeOpenId !== null && setVolumeOpenId(null)}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&display=swap');
        @keyframes hw-spin { to { transform: rotate(360deg); } }
        button:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; }
      `}</style>

      {/* ===== barra lateral ===== */}
      <aside
        style={{
          width: 50,
          background: t.sidebar,
          border: `1px solid ${t.border}`,
          borderLeft: 'none',
          borderRadius: '0 12px 12px 0',
          margin: '4px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0',
          gap: 10,
          flexShrink: 0,
        }}
      >
        <div
          title="HelloWeb"
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            marginBottom: 6,
            background: `linear-gradient(135deg, ${t.accent}, ${t.accent}88)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#0c1310',
            fontWeight: 800,
            fontSize: 15,
          }}
        >
          H
        </div>

        <button
          title={allOn ? 'Desligar todas as telas' : 'Ligar todas as telas'}
          onClick={togglePowerAll}
          style={iconBtn(t, {
            width: 36,
            height: 36,
            color: allOn ? t.danger : t.accent,
            borderColor: allOn ? t.danger : t.accent,
            background: allOn ? t.dangerSoft : t.accentSoft,
          })}
        >
          <Power size={19} />
        </button>

        <button
          title={canAdd ? 'Adicionar tela' : 'Limite de 4 telas atingido'}
          onClick={addScreen}
          disabled={!canAdd}
          style={iconBtn(t, {
            width: 36,
            height: 36,
            color: t.muted,
            cursor: canAdd ? 'pointer' : 'not-allowed',
            opacity: canAdd ? 1 : 0.45,
          })}
          onMouseEnter={(e) => {
            if (canAdd) {
              e.currentTarget.style.color = t.accent
              e.currentTarget.style.borderColor = t.accent
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = t.muted
            e.currentTarget.style.borderColor = t.border
          }}
        >
          <Plus size={19} />
        </button>

        <div style={{ marginTop: 'auto' }} />

        <button
          title="Configurações"
          onClick={() => setSettingsOpen(true)}
          style={iconBtn(t, { width: 36, height: 36 })}
          onMouseEnter={(e) => (e.currentTarget.style.color = t.text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = t.muted)}
        >
          <Settings size={19} />
        </button>
      </aside>

      {/* ===== área principal ===== */}
      <main style={{ flex: 1, padding: 4, position: 'relative', minWidth: 0 }}>
        {fsScreen ? (
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: t.screenOff }}>
            {renderTile(fsScreen, true)}
          </div>
        ) : count === 0 ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              color: t.muted,
              fontSize: 14,
            }}
          >
            <Plus size={30} />
            Nenhuma tela na grade. Use o botão + na lateral para adicionar.
          </div>
        ) : focusScreen ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, minHeight: 0 }}>{renderTile(focusScreen, false)}</div>
            {thumbs.length > 0 && (
              <>
                {/* divisor arrastável */}
                <div
                  title="Arraste para ajustar o tamanho das miniaturas"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    dragRef.current = { startY: e.clientY, startH: thumbHeight }
                  }}
                  onPointerMove={(e) => {
                    if (!(e.buttons & 1)) return
                    const delta = dragRef.current.startY - e.clientY
                    const max = Math.round(window.innerHeight * 0.45)
                    setThumbHeight(Math.max(56, Math.min(max, dragRef.current.startH + delta)))
                  }}
                  onDoubleClick={() => setThumbHeight(100)}
                  style={{
                    height: 10,
                    flexShrink: 0,
                    cursor: 'ns-resize',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    touchAction: 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.firstChild.style.background = t.accent)}
                  onMouseLeave={(e) => (e.currentTarget.firstChild.style.background = t.border)}
                >
                  <span
                    style={{
                      width: 44,
                      height: 4,
                      borderRadius: 99,
                      background: t.border,
                      transition: 'background .15s ease',
                      pointerEvents: 'none',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, height: thumbHeight }}>
                  {thumbs.map(renderThumb)}
                </div>
              </>
            )}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridCols,
              gridTemplateRows: gridRows,
              gap: 4,
              height: '100%',
            }}
          >
            {screens.map((s) => renderTile(s, false))}
          </div>
        )}

        {/* toast */}
        {toast && (
          <div
            style={{
              position: 'absolute',
              bottom: 22,
              left: '50%',
              transform: 'translateX(-50%)',
              background: t.panel,
              border: `1px solid ${t.border}`,
              color: t.text,
              padding: '10px 18px',
              borderRadius: 99,
              fontSize: 13,
              boxShadow: '0 8px 24px rgba(0,0,0,.25)',
              zIndex: 40,
            }}
          >
            {toast}
          </div>
        )}
      </main>

      {/* ===== modal de configurações ===== */}
      {settingsOpen && (
        <Modal t={t} title="Configurações" onClose={() => setSettingsOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Toggle
              t={t}
              value={audioFocus}
              onChange={setAudioFocus}
              label="Áudio apenas na tela em foco"
              desc="Silencia automaticamente as telas fora de foco"
            />

            <button
              onClick={() => showToast('Abrindo logs…')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                background: t.panelSoft,
                border: `1px solid ${t.border}`,
                borderRadius: 12,
                padding: '12px 14px',
                cursor: 'pointer',
                color: t.text,
                textAlign: 'left',
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              <ScrollText size={18} style={{ color: t.muted }} />
              Abrir logs
            </button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: t.panelSoft,
                border: `1px solid ${t.border}`,
                borderRadius: 12,
                padding: '10px 14px',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>Tema</span>
              <div
                style={{
                  display: 'flex',
                  background: t.panel,
                  borderRadius: 9,
                  border: `1px solid ${t.border}`,
                  overflow: 'hidden',
                }}
              >
                {[
                  { k: 'light', icon: <Sun size={15} />, label: 'Claro' },
                  { k: 'dark', icon: <Moon size={15} />, label: 'Escuro' },
                ].map((o) => (
                  <button
                    key={o.k}
                    onClick={() => setTheme(o.k)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 12px',
                      fontSize: 13,
                      cursor: 'pointer',
                      border: 'none',
                      fontFamily: 'inherit',
                      background: theme === o.k ? t.accentSoft : 'transparent',
                      color: theme === o.k ? t.accent : t.muted,
                      fontWeight: theme === o.k ? 700 : 500,
                    }}
                  >
                    {o.icon}
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ height: 1, background: t.border, margin: '6px 0' }} />
            <span
              style={{
                fontSize: 11,
                color: t.danger,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              Zona de risco
            </span>

            <DangerBtn
              t={t}
              label="Limpar cache das telas"
              desc="Remove o cache de todas as telas. Pode exigir novo login."
              onClick={() =>
                setConfirm({
                  title: 'Limpar cache das telas?',
                  desc: 'O cache de todas as telas será apagado. Sessões salvas podem precisar de novo login.',
                  danger: true,
                  onYes: () => showToast('Cache das telas limpo'),
                })
              }
            />
            <DangerBtn
              t={t}
              label="Limpar dados arquivados"
              desc="Exclui permanentemente os arquivos arquivados. Sem volta."
              onClick={() =>
                setConfirm({
                  title: 'Excluir dados arquivados?',
                  desc: 'Esta ação é permanente e não pode ser desfeita. Os dados arquivados serão perdidos para sempre.',
                  danger: true,
                  onYes: () => showToast('Dados arquivados excluídos'),
                })
              }
            />
          </div>
        </Modal>
      )}

      {/* ===== modal de edição ===== */}
      {editing && (
        <Modal t={t} title={`Editar ${editing.name}`} onClose={() => setEditId(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* renomear */}
            <div
              style={{
                background: t.panelSoft,
                border: `1px solid ${t.border}`,
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>Nome da tela</span>
              <input
                type="text"
                value={editing.name}
                maxLength={24}
                placeholder={`Tela ${editing.id}`}
                onChange={(e) => update(editing.id, { name: e.target.value })}
                onBlur={(e) => {
                  if (!e.target.value.trim()) update(editing.id, { name: `Tela ${editing.id}` })
                }}
                style={{
                  background: t.panel,
                  color: t.text,
                  border: `1px solid ${t.border}`,
                  borderRadius: 9,
                  padding: '9px 10px',
                  fontSize: 14,
                  fontFamily: 'inherit',
                }}
              />
            </div>

            <Toggle
              t={t}
              value={editing.keepSession}
              onChange={(v) => update(editing.id, { keepSession: v })}
              label="Manter sessão salva"
              desc="Guarda o login desta tela entre reinícios"
            />

            <div
              style={{
                background: t.panelSoft,
                border: `1px solid ${t.border}`,
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>Endereço da tela</span>
              <select
                value={editing.source}
                onChange={(e) => update(editing.id, { source: e.target.value })}
                style={{
                  background: t.panel,
                  color: t.text,
                  border: `1px solid ${t.border}`,
                  borderRadius: 9,
                  padding: '9px 10px',
                  fontSize: 14,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <option value="poke">Poke IdleWorld (padrão)</option>
                <option value="custom">Endereço personalizado</option>
              </select>

              {editing.source === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Globe size={16} style={{ color: t.muted, flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder="https://exemplo.com"
                    value={editing.customUrl}
                    onChange={(e) => update(editing.id, { customUrl: e.target.value })}
                    style={{
                      flex: 1,
                      background: t.panel,
                      color: t.text,
                      border: `1px solid ${t.border}`,
                      borderRadius: 9,
                      padding: '9px 10px',
                      fontSize: 14,
                      fontFamily: 'inherit',
                    }}
                  />
                </div>
              )}
            </div>

            <DangerBtn
              t={t}
              label="Limpar cache desta tela"
              desc={`Apaga somente o cache da ${editing.name}.`}
              onClick={() =>
                setConfirm({
                  title: `Limpar cache da ${editing.name}?`,
                  desc: 'O cache desta tela será apagado. A sessão salva pode exigir novo login.',
                  danger: true,
                  onYes: () => showToast(`Cache da ${editing.name} limpo`),
                })
              }
            />
          </div>
        </Modal>
      )}

      {/* ===== confirmação ===== */}
      {confirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: t.overlay,
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            style={{
              background: t.panel,
              borderRadius: 16,
              padding: 22,
              width: 'min(380px, 92vw)',
              border: `1px solid ${confirm.danger ? t.danger + '66' : t.border}`,
              boxShadow: '0 24px 60px rgba(0,0,0,.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              {confirm.danger && <AlertTriangle size={20} style={{ color: t.danger }} />}
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{confirm.title}</h3>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: t.muted, lineHeight: 1.5 }}>
              {confirm.desc}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirm(null)}
                style={{
                  padding: '9px 16px',
                  borderRadius: 10,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  background: t.panelSoft,
                  color: t.text,
                  border: `1px solid ${t.border}`,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  confirm.onYes()
                  setConfirm(null)
                }}
                style={{
                  padding: '9px 16px',
                  borderRadius: 10,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  background: confirm.danger ? t.danger : t.accent,
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontFamily: 'inherit',
                }}
              >
                {confirm.danger ? 'Sim, apagar' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
