"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const discord_notification_channel_1 = require("../src/discord-notification.channel");
const discord_formatter_1 = require("../src/discord-formatter");
dotenv.config();
async function runTestScript() {
    console.log('--- Test du canal de notification Discord PAVOIS ---');
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl) {
        console.error('❌ DISCORD_WEBHOOK_URL n\'est pas configurée dans l\'environnement ou le fichier .env');
        console.log('Usage : DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." npm run discord:test');
        process.exit(1);
    }
    console.log(`URL du Webhook : ${(0, discord_formatter_1.maskWebhookUrl)(webhookUrl)}`);
    const channel = new discord_notification_channel_1.DiscordNotificationChannel();
    channel.onModuleInit();
    if (!channel.isEnabled()) {
        console.error('❌ Le canal Discord est désactivé (URL invalide ou DISCORD_ENABLED=false).');
        process.exit(1);
    }
    console.log('\n1. Envoi d\'une alerte de test (Caméra Masquée)...');
    const alertSent = await channel.send({
        title: '🚨 CAMÉRA MASQUÉE (TEST CLI)',
        description: 'La caméra CAM-NORTH signale une obstruction visuelle complète (test CLI).',
        severity: 'CRITICAL',
        category: 'CAMERA_MASKED',
        timestamp: new Date(),
        cameraIds: ['CAM-NORTH'],
        cause: 'Test manuel CLI PAVOIS',
        lat: 48.8566,
        lng: 2.3522,
        reliability: 'ORANGE',
        alertId: 'TEST-CLI-001',
        isSimulation: true,
    });
    if (alertSent) {
        console.log('✅ Alerte de test transmise à la file d\'attente Discord avec succès !');
    }
    else {
        console.error('❌ Échec de l\'envoi de l\'alerte de test.');
    }
    console.log('\n2. Envoi d\'une alerte de rétablissement (Caméra Rétablie)...');
    const recoverySent = await channel.send({
        title: '✅ CAMÉRA RÉTABLIE (TEST CLI)',
        description: 'Le flux de la caméra CAM-NORTH est de nouveau opérationnel.',
        severity: 'INFO',
        category: 'CAMERA_RECOVERED',
        timestamp: new Date(),
        cameraIds: ['CAM-NORTH'],
        cause: 'Fin du test manuel CLI PAVOIS',
        incidentDurationMs: 145000,
        alertId: 'TEST-CLI-001',
        isSimulation: true,
    });
    if (recoverySent) {
        console.log('✅ Alerte de rétablissement transmise à la file d\'attente Discord avec succès !');
    }
    else {
        console.error('❌ Échec de l\'envoi de l\'alerte de rétablissement.');
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log('\n--- Fin du test CLI Discord ---');
}
runTestScript().catch((err) => {
    console.error('❌ Erreur lors de l\'exécution du script de test :', err);
    process.exit(1);
});
//# sourceMappingURL=test-discord.js.map