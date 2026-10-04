import * as dotenv from 'dotenv';
import { DiscordNotificationChannel } from '../src/notifications/discord-notification.channel';
import { maskWebhookUrl } from '../src/notifications/discord-formatter';

dotenv.config();

async function runTestScript() {
  console.log('=== 🚀 Test complet du canal de notification Discord PAVOIS ===');

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('❌ DISCORD_WEBHOOK_URL n\'est pas configurée dans l\'environnement ou le fichier .env');
    process.exit(1);
  }

  console.log(`Salon Discord cible : ${maskWebhookUrl(webhookUrl)}`);

  const channel = new DiscordNotificationChannel();
  channel.onModuleInit();

  if (!channel.isEnabled()) {
    console.error('❌ Le canal Discord est désactivé (URL invalide ou DISCORD_ENABLED=false).');
    process.exit(1);
  }

  console.log('\n--- 1. Alerte : Caméra Masquée (CAM-1) ---');
  await channel.send({
    title: '🚨 CAMÉRA MASQUÉE',
    description: 'La caméra CAM-1 (jean) signale une chute brutale de luminance (obstruction ou masquage physique).',
    severity: 'CRITICAL',
    category: 'CAMERA_MASKED',
    timestamp: new Date(),
    cameraIds: ['jean'],
    cause: 'Luminance chute de 120.0 à 12.5 (Seuil 30.0)',
    reliability: 'ORANGE',
    alertId: 'ALT-CAM-MASK-001',
    isSimulation: true,
  });

  console.log('--- 2. Alerte : Caméra Hors Service (CAM-2) ---');
  await channel.send({
    title: '🚨 CAMÉRA HORS SERVICE',
    description: 'Aucune trame UDP reçue de la caméra CAM-2 (tanel) depuis plus de 3 secondes (coupure réseau).',
    severity: 'CRITICAL',
    category: 'CAMERA_DOWN',
    timestamp: new Date(),
    cameraIds: ['tanel'],
    cause: 'Silence réseau (UDP timeout > 3.0s)',
    reliability: 'ORANGE',
    alertId: 'ALT-CAM-DOWN-002',
    isSimulation: true,
  });

  console.log('--- 3. Alerte Majeure : SYSTÈME AVEUGLE (Mention Rôle) ---');
  await channel.send({
    title: '🚨 SYSTÈME AVEUGLE (Fiabilité <= 1/3)',
    description: 'Seule 1 caméra sur 3 reste opérationnelle. Le système PAVOIS bascule en mode Dégradé (Direction uniquement).',
    severity: 'CRITICAL',
    category: 'SYSTEM_BLIND',
    timestamp: new Date(),
    cameraIds: ['jean', 'tanel'],
    cause: 'Perte de parallaxe et triangulation impossible',
    reliability: 'RED',
    alertId: 'ALT-SYS-BLIND-003',
    isSimulation: true,
  });

  console.log('--- 4. Alerte Majeure : DRONE CONFIRMÉ (3D + Mention Rôle) ---');
  await channel.send({
    title: '🚨 DRONE CONFIRMÉ',
    description: 'Piste multi-caméras confirmée par triangulation 3D et filtre de Kalman.',
    severity: 'CRITICAL',
    category: 'DRONE_CONFIRMED',
    timestamp: new Date(),
    cameraIds: ['jean', 'walid'],
    cause: 'Triangulation valide (Résidu 0.45m < 3.0m)',
    confidence: 0.94,
    lat: 48.8566,
    lng: 2.3522,
    reliability: 'GREEN',
    alertId: 'ALT-DRONE-CONF-004',
    isSimulation: true,
  });

  console.log('--- 5. Rétablissement : Caméra Rétablie (CAM-1) ---');
  await channel.send({
    title: '✅ CAMÉRA RÉTABLIE',
    description: 'Le flux visuel et les diagnostics de la caméra CAM-1 (jean) sont redevenus nominaux.',
    severity: 'INFO',
    category: 'CAMERA_RECOVERED',
    timestamp: new Date(),
    cameraIds: ['jean'],
    cause: 'Fin du masquage optique',
    incidentDurationMs: 192000, // 3 min 12 s
    reliability: 'ORANGE',
    alertId: 'ALT-CAM-MASK-001',
    isSimulation: true,
  });

  console.log('--- 6. Rétablissement : Système Restauré (Nominal 3/3) ---');
  await channel.send({
    title: '✅ SYSTÈME RESTAURÉ (Fiabilité 3/3)',
    description: 'Toutes les caméras du parc PAVOIS sont de nouveau synchrones et opérationnelles.',
    severity: 'INFO',
    category: 'CAMERA_RECOVERED',
    timestamp: new Date(),
    cameraIds: ['jean', 'tanel', 'walid'],
    cause: 'Reconnexion réseau et synchronisation complètes',
    reliability: 'GREEN',
    alertId: 'ALT-SYS-RECOVERED-005',
    isSimulation: true,
  });

  console.log('\nAttente de la transmission des alertes (file d\'attente async & rate limiter)...');
  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log('=== ✅ Tous les scénarios d\'alertes ont été émis sur Discord avec succès ! ===');
}

runTestScript().catch((err) => {
  console.error('❌ Erreur lors de l\'exécution du script de test :', err);
  process.exit(1);
});
