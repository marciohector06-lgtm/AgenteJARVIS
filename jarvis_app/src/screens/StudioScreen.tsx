import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CONFIG } from '../constants/config';
import type { StudioVideo } from '../hooks/useSocket';

type Props = {
  token: string;
  onBack: () => void;
};

export function StudioScreen({ token, onBack }: Props) {
  const [queue, setQueue] = useState<StudioVideo[]>([]);
  const [index, setIndex] = useState(0);
  const [postedUrl, setPostedUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token]
  );

  const onRefresh = useCallback(async () => {
    try {
      const res = await fetch(`${CONFIG.SERVER_URL}/api/v1/studio/pending`, { headers: authHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setQueue(body.videos || []);
    } catch (error) {
      Alert.alert('Sem conexão com o JARVIS', String((error as Error).message));
    }
  }, [authHeaders]);

  const act = useCallback(
    async (path: string, body?: unknown) => {
      setBusy(true);
      try {
        const res = await fetch(`${CONFIG.SERVER_URL}/api/v1/studio/video/${path}`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(body ?? {}),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
        await onRefresh();
      } catch (error) {
        Alert.alert('Não deu certo', String((error as Error).message));
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, onRefresh]
  );

  useEffect(() => {
    onRefresh();
  }, [onRefresh]);

  useEffect(() => {
    if (index >= queue.length) setIndex(0);
  }, [queue.length, index]);

  const current = queue[index];

  const source = useMemo(
    () =>
      current
        ? {
            uri: `${CONFIG.SERVER_URL}/api/v1/studio/video/${current.id}/file`,
            headers: { Authorization: `Bearer ${token}` },
          }
        : null,
    [current, token]
  );

  const player = useVideoPlayer(source, (instance) => {
    instance.loop = true;
    instance.play();
  });

  if (!current) {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.link}>{'< VOLTAR'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onRefresh}>
            <Text style={styles.link}>ATUALIZAR</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>FILA VAZIA</Text>
          <Text style={styles.emptyText}>Nenhum vídeo aguardando aprovação.</Text>
        </View>
      </View>
    );
  }

  const confirmReject = () => {
    Alert.alert('Descartar vídeo', 'O vídeo vai para rejeitado e sai da fila. Confirma?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => act(`${current.id}/decision`, { decision: 'reject' }) },
    ]);
  };

  const submitPosted = () => {
    const url = postedUrl.trim();
    if (!url.startsWith('http')) {
      Alert.alert('Link inválido', 'Cole o link do post no TikTok, começando com http.');
      return;
    }
    act(`${current.id}/posted`, { url });
    setPostedUrl('');
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.link}>{'< VOLTAR'}</Text>
        </TouchableOpacity>
        <Text style={styles.counter}>
          {index + 1} / {queue.length}
        </Text>
        <TouchableOpacity onPress={onRefresh}>
          <Text style={styles.link}>ATUALIZAR</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />

        <View style={styles.block}>
          <Text style={styles.label}>GANCHO</Text>
          <Text style={styles.hook}>{current.hook || '(sem gancho)'}</Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>LEGENDA</Text>
          <Text style={styles.body}>{current.caption || '(sem legenda)'}</Text>
        </View>

        {current.hookFormula ? (
          <View style={styles.block}>
            <Text style={styles.label}>FÓRMULA USADA</Text>
            <Text style={styles.meta}>{current.hookFormula}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <TouchableOpacity disabled={busy} style={[styles.button, styles.approve, busy && styles.busy]} onPress={() => act(`${current.id}/decision`, { decision: 'approve' })}>
            <Text style={[styles.buttonText, styles.approveText]}>APROVAR</Text>
          </TouchableOpacity>

          <TouchableOpacity disabled={busy} style={[styles.button, styles.regenerate, busy && styles.busy]} onPress={() => act(`${current.id}/regenerate`)}>
            <Text style={[styles.buttonText, styles.regenerateText]}>REFAZER</Text>
          </TouchableOpacity>

          <TouchableOpacity disabled={busy} style={[styles.button, styles.reject, busy && styles.busy]} onPress={confirmReject}>
            <Text style={[styles.buttonText, styles.rejectText]}>DESCARTAR</Text>
          </TouchableOpacity>
        </View>

        {queue.length > 1 ? (
          <View style={styles.nav}>
            <TouchableOpacity onPress={() => setIndex((i) => (i - 1 + queue.length) % queue.length)}>
              <Text style={styles.link}>{'< ANTERIOR'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIndex((i) => (i + 1) % queue.length)}>
              <Text style={styles.link}>{'PRÓXIMO >'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.label}>JÁ POSTOU? COLE O LINK</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              value={postedUrl}
              onChangeText={setPostedUrl}
              placeholder="https://www.tiktok.com/@..."
              placeholderTextColor="#555555"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.sendButton} onPress={submitPosted}>
              <Text style={styles.sendButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>O link deixa o JARVIS medir o desempenho depois.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  link: { color: '#00FFFF', fontFamily: 'monospace', fontSize: 12, letterSpacing: 1 },
  counter: { color: '#666666', fontFamily: 'monospace', fontSize: 12 },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  video: { width: '100%', height: 420, backgroundColor: '#111111', borderRadius: 8 },
  block: { marginTop: 16 },
  label: { color: '#00FFFF88', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  hook: { color: '#FFFFFF', fontFamily: 'monospace', fontSize: 16, lineHeight: 22 },
  body: { color: '#CCCCCC', fontFamily: 'monospace', fontSize: 13, lineHeight: 18 },
  meta: { color: '#666666', fontFamily: 'monospace', fontSize: 11 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24 },
  button: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginHorizontal: 4 },
  buttonText: { fontFamily: 'monospace', fontSize: 12, letterSpacing: 1 },
  approve: { borderColor: '#00FF88' },
  approveText: { color: '#00FF88' },
  regenerate: { borderColor: '#FFAA00' },
  regenerateText: { color: '#FFAA00' },
  reject: { borderColor: '#FF4444' },
  busy: { opacity: 0.4 },
  rejectText: { color: '#FF4444' },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    borderColor: '#00FFFF66',
    borderWidth: 1,
    borderRadius: 8,
    color: '#FFFFFF',
    fontFamily: 'monospace',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  sendButton: { borderColor: '#00FFFF', borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  sendButtonText: { color: '#00FFFF', fontFamily: 'monospace', fontSize: 11 },
  hint: { color: '#555555', fontFamily: 'monospace', fontSize: 10, marginTop: 6 },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { color: '#00FFFF', fontFamily: 'monospace', fontSize: 16, letterSpacing: 2 },
  emptyText: { color: '#666666', fontFamily: 'monospace', fontSize: 12, marginTop: 8 },
});
