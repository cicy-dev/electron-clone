import { useState, useEffect, useRef } from 'react'
import './App.css'

const API = 'https://g-8835.cicy.de5.net'

function App() {
  const [srcUrl, setSrcUrl] = useState('https://www.bet365.com/')
  const [status, setStatus] = useState('就绪')
  const [syncing, setSyncing] = useState(false)
  const [wvASrc, setWvASrc] = useState('about:blank')
  const [wvBSrc] = useState('about:blank')
  const wvBRef = useRef<any>(null)

  const doSync = async () => {
    if (!srcUrl.trim() || syncing) return
    setSyncing(true)
    setStatus('克隆中...')

    try {
      // 获取 A 的 HTML
      const res = await fetch(`${API}/api/clone?url=${encodeURIComponent(srcUrl)}`)
      const data = await res.json()

      if (data.ok && data.html) {
        setStatus(`✓ HTML 已获取 (${(data.html.length / 1024).toFixed(1)}KB)`)
        setWvASrc(srcUrl)
        
        // 直接设置 srcdoc
        if (wvBRef.current) {
          wvBRef.current.srcdoc = data.html
          setStatus(`✓ 克隆完成`)
        }
        
        localStorage.setItem('cs-src', srcUrl)
      } else {
        setStatus(`失败: ${data.error || 'Unknown'}`)
      }
    } catch (e: any) {
      setStatus(`错误: ${e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('cs-src')
    if (saved) setSrcUrl(saved)
    
    const setupListeners = () => {
      const wvA = document.querySelectorAll('webview')[0] as any
      const wvB = document.querySelectorAll('webview')[1] as any
      
      if (!wvA || !wvB) {
        setTimeout(setupListeners, 500)
        return
      }
      
      const updateStatus = () => {
        const urlA = wvA.getURL?.() || wvA.src || ''
        const urlB = wvB.getURL?.() || wvB.src || ''
        setStatus(`A: ${urlA.slice(0, 60)} | B: ${urlB.slice(0, 60)}`)
      }
      
      wvA.addEventListener('did-navigate', updateStatus)
      wvA.addEventListener('did-navigate-in-page', updateStatus)
      wvB.addEventListener('did-navigate', updateStatus)
      wvB.addEventListener('did-navigate-in-page', updateStatus)
      
      setTimeout(updateStatus, 1000)
    }
    
    setTimeout(setupListeners, 500)
    setTimeout(doSync, 800)
  }, [])

  return (
    <div className="app">
      <div className="header">
        <div className="logo">Clone Studio</div>
        <div className="controls">
          <input 
            className="url-input" 
            value={srcUrl} 
            onChange={e => setSrcUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSync()}
            placeholder="输入源站 URL"
          />
          <button 
            className={`sync-btn ${syncing ? 'syncing' : ''}`}
            onClick={doSync}
            disabled={syncing}
          >
            {syncing ? '⏳' : '⟳'} 同步
          </button>
        </div>
        <div className="status">{status}</div>
      </div>

      <div className="workspace">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">源站</span>
            <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
              <button className="dev-btn" onClick={() => {
                const wv = document.querySelector('webview') as any
                wv?.openDevTools()
              }}>🔧</button>
              <span className="badge badge-blue">A</span>
            </div>
          </div>
          <webview src={wvASrc} style={{flex: 1}} partition="persist:main" allowpopups />
        </div>
        
        <div className="divider" />
        
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">克隆</span>
            <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
              <button className="dev-btn" onClick={() => {
                const wv = document.querySelectorAll('webview')[1] as any
                wv?.openDevTools()
              }}>🔧</button>
              <span className="badge badge-green">B</span>
            </div>
          </div>
          <webview ref={wvBRef} src={wvBSrc} style={{flex: 1}} partition="persist:main" allowpopups />
        </div>
      </div>
    </div>
  )
}

export default App
