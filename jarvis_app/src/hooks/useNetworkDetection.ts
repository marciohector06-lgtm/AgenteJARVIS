import { useCallback } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import * as Network from 'expo-network';
import WifiManager from 'react-native-wifi-reborn';

export type NetworkContext = {
  ssid: string | null;
  subnet: string | null;
};

function deriveSubnet(ip: string | null): string | null {
  if (!ip) return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

async function readSsid(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;

  try {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) return null;

    const ssid = await WifiManager.getCurrentWifiSSID();
    return ssid || null;
  } catch (error) {
    console.warn('Erro ao ler SSID do Wi-Fi:', error);
    return null;
  }
}

export function useNetworkDetection() {
  const detectNetwork = useCallback(async (): Promise<NetworkContext> => {
    const [ssid, ip] = await Promise.all([
      readSsid(),
      Network.getIpAddressAsync().catch(() => null),
    ]);

    return { ssid, subnet: deriveSubnet(ip) };
  }, []);

  return { detectNetwork };
}
