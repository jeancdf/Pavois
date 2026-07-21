import { useEffect, useRef } from 'react'
import { useSimStore } from '../store/simStore'

export function useWebSocket() {
  const addLiveTrackUpdate = useSimStore((s) => s.addLiveTrackUpdate)
  const clearOfflineLiveTracks = useSimStore((s) => s.clearOfflineLiveTracks)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    // URL par défaut pointant vers NestJS (port 3002) avec le token par défaut
    // Permet d'être configuré via variables d'environnement Vite si nécessaire
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:3002?token=dev-pavois-token'
    let reconnectTimeout: ReturnType<typeof setTimeout>
    let isMounted = true

    function connect() {
      console.log(`[WS Client] Tentative de connexion à ${wsUrl}...`)
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[WS Client] Connecté avec succès au serveur WebSocket')
      }

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          const { event: eventName, data } = payload

          if (eventName === 'track_update') {
            console.log('[WS Client] Réception mise à jour de piste 3D :', data)
            addLiveTrackUpdate({
              trackId: data.trackId,
              lat: data.lat,
              lng: data.lng,
              alt: data.alt,
              timestamp: data.timestamp,
              classification: data.classification,
            })
          } else if (eventName === 'raw_detection') {
            console.log('[WS Client] Réception détection brute 2D :', data)
            // Possibilité d'intégrer une alerte ici pour les détections de caméras
          } else if (eventName === 'generic_udp') {
            console.log('[WS Client] Message UDP générique :', data)
          }
        } catch (err) {
          console.error('[WS Client] Erreur lors du traitement du message :', err)
        }
      }

      ws.onerror = (err) => {
        console.error('[WS Client] Erreur de socket :', err)
      }

      ws.onclose = (event) => {
        console.warn(`[WS Client] Connexion fermée. Code: ${event.code}, Raison: ${event.reason || 'aucune'}`)
        if (isMounted) {
          // Tentative de reconnexion après 3 secondes
          reconnectTimeout = setTimeout(() => {
            connect()
          }, 3000)
        }
      }
    }

    connect()

    // Intervalle régulier pour marquer comme perdues ou supprimer les pistes hors ligne
    const cleanupInterval = setInterval(() => {
      clearOfflineLiveTracks()
    }, 5000)

    return () => {
      isMounted = false
      clearTimeout(reconnectTimeout)
      clearInterval(cleanupInterval)
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [addLiveTrackUpdate, clearOfflineLiveTracks])

  return wsRef.current
}
