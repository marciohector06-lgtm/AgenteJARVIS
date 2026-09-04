// EXPO_PUBLIC_* é lido automaticamente pelo Expo (SDK 49+) a partir do .env
// na raiz de jarvis_app — sem isso configurado, cai no IP de desenvolvimento
// local como fallback (mas emite um aviso, já que esse IP muda por rede).
const serverUrl = process.env.EXPO_PUBLIC_SERVER_URL;

if (!serverUrl) {
  console.warn(
    'EXPO_PUBLIC_SERVER_URL não definida — usando IP de fallback. Crie um .env em jarvis_app (veja .env.example).'
  );
}

export const CONFIG = {
  SERVER_URL: serverUrl || 'http://192.168.1.25:4000',
} as const;
