import asyncio
import socket
import json
import websockets

UDP_IP = "0.0.0.0"
UDP_PORT = 5000  # Port d'écoute pour les paquets UDP
WS_PORT = 3000   # Port d'écoute pour les clients WebSocket (le front)

# Ensemble des clients WebSocket actuellement connectés
CONNECTED_CLIENTS = set()

# Gestionnaire des connexions WebSocket
async def ws_handler(websocket):
    print(f"[WS] Tanel connecté")
    CONNECTED_CLIENTS.add(websocket)
    try:
        async for message in websocket:
            # On ignore les messages entrants du client, on maintient juste la connexion
            pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        CONNECTED_CLIENTS.remove(websocket)
        print(f"[WS] Tanel déconnecté")

# Diffuse les données à tous les clients WebSocket connectés
async def broadcast(event_name, data):
    if CONNECTED_CLIENTS:
        payload = json.dumps({
            "event": event_name,
            "data": data
        })
        # Envoi asynchrone à tous les clients
        await asyncio.gather(*[client.send(payload) for client in CONNECTED_CLIENTS], return_exceptions=True)

# Parse le message UDP et le diffuse au WebSocket
def parse_and_broadcast(message_str, addr):
    message_str = message_str.strip()
    parts = message_str.split(',')
    
    # 1. Format 2D : raw,cam0,275,19128667926,551.93,638.21,2619,0.986
    if parts[0] == 'raw' and len(parts) >= 8:
        detection = {
            "type": "raw_detection",
            "cameraId": parts[1],
            "frameIndex": int(parts[2]),
            "timestamp": float(parts[3]),
            "x": float(parts[4]),
            "y": float(parts[5]),
            "size": float(parts[6]),
            "confidence": float(parts[7])
        }
        print(f"[UDP 2D] {detection['cameraId']} (frame {detection['frameIndex']}) -> x:{detection['x']}, y:{detection['y']}")
        asyncio.create_task(broadcast("raw_detection", detection))
        
    # 2. Format 3D GPS : obj2,48.8260444,2.3659956,34.78,1782465675417840[,drone]
    elif parts[0].startswith('obj') and len(parts) >= 5:
        track_update = {
            "type": "track_update",
            "trackId": parts[0],
            "lat": float(parts[1]),
            "lng": float(parts[2]),
            "alt": float(parts[3]),
            "timestamp": float(parts[4])
        }
        if len(parts) >= 6:
            track_update["classification"] = parts[5].strip()
        print(f"[UDP 3D] {track_update['trackId']} -> Lat:{track_update['lat']}, Lng:{track_update['lng']}, Alt:{track_update['alt']} (class: {track_update.get('classification', 'N/A')})")
        asyncio.create_task(broadcast("track_update", track_update))
        
    # 3. Format générique ou JSON brut
    else:
        parsed_json = None
        try:
            parsed_json = json.loads(message_str)
        except Exception:
            pass
            
        generic_payload = {
            "type": "generic_udp",
            "raw": message_str,
            "data": parsed_json,
            "sender": {"address": addr[0], "port": addr[1]}
        }
        print(f"[UDP Générique] Reçu : {message_str}")
        asyncio.create_task(broadcast("generic_udp", generic_payload))

# Protocole asynchrone pour la réception UDP
class UdpServerProtocol(asyncio.DatagramProtocol):
    def connection_made(self, transport):
        self.transport = transport
        print(f"Écoute des paquets UDP sur {UDP_IP}:{UDP_PORT}...")

    def datagram_received(self, data, addr):
        try:
            message_str = data.decode('utf-8')
            parse_and_broadcast(message_str, addr)
        except Exception as e:
            print(f"Erreur de décodage/traitement : {e}")
            try:
                raw_str = data.decode('utf-8', errors='replace')
                asyncio.create_task(broadcast("generic_udp", {
                    "type": "generic_udp",
                    "raw": raw_str,
                    "error": str(e)
                }))
            except Exception:
                pass

async def main():
    # Démarre le serveur WebSocket sur le port 3000
    async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
        print(f"Serveur WebSocket démarré sur ws://localhost:{WS_PORT}")
        
        # Démarre le récepteur UDP sur le port 5000
        loop = asyncio.get_running_loop()
        transport, protocol = await loop.create_datagram_endpoint(
            lambda: UdpServerProtocol(),
            local_addr=(UDP_IP, UDP_PORT)
        )
        
        # Maintient le script en exécution
        try:
            await asyncio.Future()  # run forever
        finally:
            transport.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nArrêt du script.")
